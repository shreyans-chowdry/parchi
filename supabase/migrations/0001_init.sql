-- Parchi production schema (Supabase / Postgres 15+).
-- Multi-tenant: every row belongs to a business; row-level security keeps each
-- wholesaler's catalog, customers and bills private to its own staff.

create extension if not exists pg_trgm;
create extension if not exists vector;
create extension if not exists pgmq;

-- Parse queue: the webhook enqueues, a worker drains it, so bursts never block WhatsApp.
select pgmq.create('parse');
create or replace function pgmq_send(queue_name text, msg jsonb) returns bigint
language sql security definer as $$ select pgmq.send(queue_name, msg) $$;

-- ---------------------------------------------------------------- tenants
create table businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  tax_id        text,
  currency      char(3) not null default 'USD',
  invoice_prefix text not null default 'INV',
  plan          text not null default 'starter' check (plan in ('starter', 'shop', 'warehouse')),
  wa_phone_id   text unique,              -- WhatsApp Cloud API phone number id (Warehouse plan)
  created_at    timestamptz not null default now()
);

create table members (
  business_id uuid references businesses on delete cascade,
  user_id     uuid references auth.users on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  primary key (business_id, user_id)
);

create or replace function is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.business_id = b and m.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------- catalog
create table products (
  business_id uuid not null references businesses on delete cascade,
  sku         text not null,
  name        text not null,
  category    text not null,
  unit        text not null check (unit in ('pc', 'pkt', 'box', 'set', 'roll', 'pair')),
  box_qty     int,
  carton_qty  int,
  rate        numeric(12, 2) not null,
  hs_code     text not null,
  tax_rate    numeric(5, 2) not null default 0,
  stock       numeric(12, 2) not null default 0,
  reorder_at  numeric(12, 2) not null default 0,
  lead_days   int not null default 45,
  aliases     text[] not null default '{}',
  specs       text[] not null default '{}',
  color       text,
  size        text,
  -- search_text = name + aliases, folded the same way the engine folds tokens
  search_text text generated always as (lower(name || ' ' || array_to_string(aliases, ' '))) stored,
  embedding   vector(384),             -- optional semantic fallback for very large catalogs
  primary key (business_id, sku)
);
create index products_trgm on products using gin (search_text gin_trgm_ops);
create index products_embedding on products using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------- customers
create table parties (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses on delete cascade,
  name          text not null,
  phone         text,                   -- WhatsApp number, E.164
  city          text,
  country       text,
  tax_id        text,
  export        boolean not null default false,  -- cross-border: zero-rated
  discount_pct  numeric(5, 2) not null default 0,
  credit_days   int not null default 0,
  unique (business_id, phone)
);

-- ---------------------------------------------------------------- inbox
create table messages (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses on delete cascade,
  party_id     uuid references parties,
  channel      text not null check (channel in ('text', 'voice', 'photo')),
  body         text,                    -- text, voice transcript or photo transcription
  media_path   text,                    -- storage object for voice / photo
  wa_message_id text unique,            -- idempotency key from the WhatsApp webhook
  status       text not null default 'new' check (status in ('new', 'read', 'billed', 'ignored')),
  received_at  timestamptz not null default now()
);
create index messages_inbox on messages (business_id, status, received_at desc);

-- ---------------------------------------------------------------- orders and bills
create table orders (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses on delete cascade,
  message_id  uuid references messages,
  party_id    uuid references parties,
  parsed      jsonb not null,           -- ParsedOrder from the engine (lines, spans, confidence)
  model_calls int not null default 0,   -- how many lines needed the model
  created_at  timestamptz not null default now()
);

create table invoice_counters (
  business_id uuid references businesses on delete cascade,
  year        int not null,
  last_no     int not null default 0,
  primary key (business_id, year)
);

create table invoices (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses on delete cascade,
  order_id      uuid references orders,
  party_id      uuid references parties,
  number        text not null,
  invoice_date  date not null default current_date,
  currency      char(3) not null,
  export        boolean not null,
  taxable       numeric(14, 2) not null,
  tax           numeric(14, 2) not null,
  grand_total   numeric(14, 2) not null,
  due_date      date,
  paid_at       timestamptz,
  lines         jsonb not null,
  unique (business_id, number)
);

create table stock_moves (
  id          bigint generated always as identity primary key,
  business_id uuid not null references businesses on delete cascade,
  sku         text not null,
  qty         numeric(12, 2) not null,  -- negative = out
  reason      text not null check (reason in ('invoice', 'receipt', 'adjust', 'backorder')),
  ref_id      uuid,
  at          timestamptz not null default now()
);

-- Next invoice number for the year, gap-free and safe under concurrency.
create or replace function next_invoice_no(b uuid, y int) returns int
language plpgsql as $$
declare n int;
begin
  insert into invoice_counters (business_id, year, last_no) values (b, y, 1)
  on conflict (business_id, year) do update set last_no = invoice_counters.last_no + 1
  returning last_no into n;
  return n;
end $$;

-- Confirming a bill decrements stock in the same transaction as the invoice insert.
create or replace function apply_invoice_stock() returns trigger
language plpgsql as $$
declare l jsonb;
begin
  for l in select * from jsonb_array_elements(new.lines) loop
    update products set stock = stock - (l->>'qty')::numeric
      where business_id = new.business_id and sku = l->>'sku';
    insert into stock_moves (business_id, sku, qty, reason, ref_id)
      values (new.business_id, l->>'sku', -(l->>'qty')::numeric, 'invoice', new.id);
  end loop;
  return new;
end $$;
create trigger invoices_stock after insert on invoices for each row execute function apply_invoice_stock();

-- Fast candidate lookup used by the matcher before fine scoring in the engine.
create or replace function match_candidates(b uuid, q text, k int default 12)
returns table (sku text, sim real)
language sql stable as $$
  select sku, similarity(search_text, lower(q)) as sim
  from products
  where business_id = b and search_text % lower(q)
  order by sim desc
  limit k;
$$;

-- ---------------------------------------------------------------- row-level security
alter table businesses enable row level security;
alter table members enable row level security;
alter table products enable row level security;
alter table parties enable row level security;
alter table messages enable row level security;
alter table orders enable row level security;
alter table invoices enable row level security;
alter table invoice_counters enable row level security;
alter table stock_moves enable row level security;

create policy own_business on businesses for all using (is_member(id));
create policy own_membership on members for select using (user_id = auth.uid());
create policy tenant_products on products for all using (is_member(business_id)) with check (is_member(business_id));
create policy tenant_parties on parties for all using (is_member(business_id)) with check (is_member(business_id));
create policy tenant_messages on messages for all using (is_member(business_id)) with check (is_member(business_id));
create policy tenant_orders on orders for all using (is_member(business_id)) with check (is_member(business_id));
create policy tenant_invoices on invoices for all using (is_member(business_id)) with check (is_member(business_id));
create policy tenant_counters on invoice_counters for all using (is_member(business_id)) with check (is_member(business_id));
create policy tenant_moves on stock_moves for select using (is_member(business_id));
