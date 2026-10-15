// Supabase Edge Function: parse one inbox message into a draft order.
// The same engine that runs in the browser runs here (copied into _shared by
// `npm run sync:engine`). Rules handle most lines; only doubtful lines are sent
// to Claude, in one batched call per order.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  buildIndex, chooseSku, parseBatch, parseOrder, resolveBatchPrompt, type Product,
} from '../_shared/engine/index.ts';

const MODEL = Deno.env.get('PARCHI_MODEL') ?? 'claude-haiku-5-5';

async function askClaude(prompt: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`model ${res.status}`);
  const body = await res.json();
  const text: string = body.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? '';
  const start = text.indexOf('[');
  return start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf(']') + 1)) : [];
}

Deno.serve(async (req) => {
  const { message_id } = await req.json();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }, // RLS applies as the caller
  );

  const { data: msg, error } = await supabase.from('messages').select('*').eq('id', message_id).single();
  if (error || !msg) return new Response('message not found', { status: 404 });

  const [{ data: rows }, { data: past }] = await Promise.all([
    supabase.from('products').select('*').eq('business_id', msg.business_id),
    supabase.from('invoices').select('lines').eq('party_id', msg.party_id).order('invoice_date', { ascending: false }).limit(10),
  ]);
  const products: Product[] = (rows ?? []).map((r) => ({
    sku: r.sku, name: r.name, category: r.category, unit: r.unit, box: r.box_qty ?? undefined, carton: r.carton_qty ?? undefined,
    rate: Number(r.rate), hs: r.hs_code, tax: Number(r.tax_rate) as Product['tax'], stock: Number(r.stock), reorderAt: Number(r.reorder_at),
    leadDays: r.lead_days, aliases: r.aliases, specs: r.specs, color: r.color ?? undefined, size: r.size ?? undefined,
  }));
  const catalog = new Map(products.map((p) => [p.sku, p]));
  const history = [...new Set((past ?? []).flatMap((i) => (i.lines as { sku: string }[]).map((l) => l.sku)))];

  // An index per request is fine for catalogs of a few thousand SKUs (~5 ms);
  // larger tenants pre-filter with match_candidates() (pg_trgm) first.
  const parsed = parseOrder(msg.body ?? '', { index: buildIndex(products), catalog, sentAt: new Date(msg.received_at), history });

  const doubtful = parsed.lines.filter((l) => l.status !== 'matched' && l.candidates.length);
  let modelCalls = 0;
  if (doubtful.length && Deno.env.get('ANTHROPIC_API_KEY')) {
    modelCalls = 1;
    const answers = parseBatch(await askClaude(resolveBatchPrompt(doubtful, catalog)), doubtful);
    for (const a of answers) {
      const i = parsed.lines.findIndex((l) => l.id === a.line);
      if (i >= 0 && a.sku) parsed.lines[i] = { ...chooseSku(parsed.lines[i], a.sku, catalog, 'ai'), why: a.reason };
    }
  }

  const { data: order } = await supabase.from('orders')
    .insert({ business_id: msg.business_id, message_id, party_id: msg.party_id, parsed, model_calls: modelCalls })
    .select('id').single();
  await supabase.from('messages').update({ status: 'read' }).eq('id', message_id);

  return Response.json({ order_id: order?.id, lines: parsed.lines.length, model_calls: modelCalls, ms: parsed.stats.ms });
});
