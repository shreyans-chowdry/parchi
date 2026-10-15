import React, { useMemo, useState } from 'react';
import { reorderList, unitLabel } from '../engine';
import { type Action, type Bill, catalogOf, type State } from './store';
import { InvoiceSheet } from './InvoiceSheet';
import { cash, shortDate } from './format';
import { CURRENT } from './seller';
import type { Product } from '../engine';
import { ChannelIcon } from './Desk';
import { IconClose, IconPlus, IconShip } from './icons';

type D = React.Dispatch<Action>;
const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ------------------------------------------------------------------ Orders */

export function Orders({ state, dispatch }: { state: State; dispatch: D }) {
  const [open, setOpen] = useState<Bill>();
  const today = new Date().toISOString().slice(0, 10);
  const bills = [...state.bills].sort((a, b) => b.createdAt - a.createdAt);
  const unpaid = bills.filter((b) => !b.paid);
  const outstanding = unpaid.reduce((a, b) => a + b.invoice.grandTotal, 0);
  const overdue = unpaid.filter((b) => b.invoice.dueDate < today);
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Bills</h1>
          <p>Every order Parchi turned into an invoice, with what is still to be collected.</p>
        </div>
        <span className="grow" />
      </div>
      <div className="kpis">
        <div className="panel kpi"><small>Bills this week</small><b>{bills.filter((b) => b.createdAt > Date.now() - 7 * DAY).length}</b><span>{cash(bills.filter((b) => b.createdAt > Date.now() - 7 * DAY).reduce((a, b) => a + b.invoice.grandTotal, 0))} billed</span></div>
        <div className="panel kpi"><small>To collect</small><b className="num">{cash(outstanding)}</b><span>{unpaid.length} unpaid bills</span></div>
        <div className="panel kpi"><small>Overdue</small><b className="num" style={{ color: overdue.length ? 'var(--alert)' : undefined }}>{overdue.length}</b><span>{overdue.length ? cash(overdue.reduce((a, b) => a + b.invoice.grandTotal, 0)) + ' past due date' : 'Nothing past due'}</span></div>
      </div>
      <div className="panel table-panel">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr><th>Bill</th><th>Customer</th><th>Came in as</th><th className="r">Items</th><th className="r">Amount</th><th>Due</th><th>Status</th></tr>
            </thead>
            <tbody>
              {bills.length === 0 && (
                <tr><td colSpan={7}><div className="empty"><h3>No invoices yet</h3><p>Confirm an order on the Desk and its invoice appears here.</p></div></td></tr>
              )}
              {bills.map((b) => {
                const late = !b.paid && b.invoice.dueDate < today;
                return (
                  <tr key={b.invoice.number} className="click" onClick={() => setOpen(b)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(b); }}>
                    <td className="num"><b>{b.invoice.number}</b><span className="sub">{shortDate(b.invoice.date)}</span></td>
                    <td>{b.invoice.party.name}<span className="sub">{[b.invoice.party.city, b.invoice.party.country].filter(Boolean).join(', ')}{b.invoice.export ? ' · export' : ''}</span></td>
                    <td><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--muted)' }}><span style={{ width: 16, height: 16, display: 'inline-grid' }}><ChannelIcon c={b.channel} /></span>{b.channel === 'text' ? 'Text' : b.channel === 'voice' ? 'Voice note' : 'Photo'}</span></td>
                    <td className="r">{b.invoice.lines.length}</td>
                    <td className="r"><b>{cash(b.invoice.grandTotal)}</b></td>
                    <td>{shortDate(b.invoice.dueDate)}</td>
                    <td><span className={`st ${b.paid ? 'paid' : late ? 'overdue' : 'unpaid'}`}>{b.paid ? 'Paid' : late ? 'Overdue' : 'Unpaid'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(undefined)} />
          <aside className="drawer" role="dialog" aria-label={`Bill ${open.invoice.number}`}>
            <div className="drawer-head">
              <strong>{open.invoice.number}</strong>
              <button className="btn ghost" onClick={() => setOpen(undefined)} aria-label="Close"><IconClose /></button>
            </div>
            <InvoiceSheet invoice={open.invoice} stamped />
            <button className="btn block" onClick={() => { dispatch({ type: 'markPaid', number: open.invoice.number, paid: !open.paid }); setOpen({ ...open, paid: !open.paid }); }}>
              {open.paid ? 'Mark as unpaid' : 'Mark as paid'}
            </button>
          </aside>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Stock */

const UNITS = [['pc', 'Piece'], ['pkt', 'Packet'], ['box', 'Box'], ['set', 'Set'], ['roll', 'Roll'], ['pair', 'Pair']] as const;

function AddProduct({ state, dispatch, onClose, toast }: { state: State; dispatch: D; onClose: () => void; toast: (s: string) => void }) {
  const cats = [...new Set(state.products.map((p) => p.category))];
  const [f, setF] = useState({ name: '', aliases: '', category: cats[0] ?? 'General', unit: 'pc', box: '', rate: '', tax: '0', stock: '', reorder: '', specs: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const ok = f.name.trim() && Number(f.rate) >= 0 && f.rate !== '';
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    const prefix = (f.category.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'ITM').toUpperCase();
    const n = state.products.filter((p) => p.sku.startsWith(prefix + '-')).length + 1;
    let sku = `${prefix}-${String(n).padStart(3, '0')}`;
    while (state.products.some((p) => p.sku === sku)) sku = `${prefix}-${String(Math.floor(Math.random() * 900) + 100)}`;
    const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
    const product: Product = {
      sku, name: f.name.trim(), category: f.category.trim() || 'General', unit: f.unit as Product['unit'],
      box: Number(f.box) > 0 ? Number(f.box) : undefined, rate: Number(f.rate), hs: '', tax: Number(f.tax) || 0,
      stock: Math.max(0, Number(f.stock) || 0), reorderAt: Math.max(0, Number(f.reorder) || 0), leadDays: 30,
      aliases: list(f.aliases), specs: list(f.specs),
    };
    dispatch({ type: 'addProduct', product });
    toast(`Added ${product.name} (${sku})`);
    onClose();
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Add a product">
        <div className="drawer-head"><strong>Add a product</strong><button className="btn ghost" onClick={onClose} aria-label="Close"><IconClose /></button></div>
        <form className="form" onSubmit={save}>
          <label htmlFor="ap-name">Name<input id="ap-name" autoFocus required value={f.name} onChange={set('name')} placeholder="e.g. Heavy stapler 24/6" /></label>
          <label htmlFor="ap-aliases">Other names customers use<input id="ap-aliases" value={f.aliases} onChange={set('aliases')} placeholder="comma separated, any language: grapadora, دباسة, stepler" /></label>
          <div className="two-col">
            <label htmlFor="ap-cat">Category<input id="ap-cat" list="ap-cats" value={f.category} onChange={set('category')} /></label>
            <datalist id="ap-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            <label htmlFor="ap-unit">Sold per<select id="ap-unit" value={f.unit} onChange={set('unit')}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <div className="two-col">
            <label htmlFor="ap-rate">Price per unit ({CURRENT.currencySymbol.trim()})<input id="ap-rate" type="number" min="0" step="any" required value={f.rate} onChange={set('rate')} /></label>
            <label htmlFor="ap-tax">Tax %<input id="ap-tax" type="number" min="0" step="any" value={f.tax} onChange={set('tax')} /></label>
          </div>
          <div className="two-col">
            <label htmlFor="ap-stock">Opening stock<input id="ap-stock" type="number" min="0" step="any" value={f.stock} onChange={set('stock')} /></label>
            <label htmlFor="ap-reorder">Reorder when below<input id="ap-reorder" type="number" min="0" step="any" value={f.reorder} onChange={set('reorder')} /></label>
          </div>
          <div className="two-col">
            <label htmlFor="ap-box">Units per box<input id="ap-box" type="number" min="0" step="1" value={f.box} onChange={set('box')} placeholder="optional" /></label>
            <label htmlFor="ap-specs">Sizes / specs<input id="ap-specs" value={f.specs} onChange={set('specs')} placeholder="optional: 24/6, 9W, 6x8" /></label>
          </div>
          <p className="hint">Orders already in the inbox are re-read as soon as you save, so this product is matched straight away.</p>
          <button className="btn primary block" disabled={!ok}>Add product</button>
        </form>
      </aside>
    </>
  );
}

function Receive({ sku, unit, dispatch, toast }: { sku: string; unit: string; dispatch: D; toast: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('');
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Receive</button>;
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (n > 0) { dispatch({ type: 'receiveStock', sku, qty: n }); toast(`Received ${n} ${unitLabel(unit, n)}`); }
    setOpen(false); setQty('');
  };
  return (
    <form className="receive" onSubmit={go}>
      <label htmlFor={`rcv-${sku}`} className="sr">Quantity received</label>
      <input id={`rcv-${sku}`} autoFocus type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
      <button className="btn small primary" disabled={!(Number(qty) > 0)}>Add</button>
    </form>
  );
}

export function Stock({ state, dispatch, toast }: { state: State; dispatch: D; toast: (s: string) => void }) {
  const [cat, setCat] = useState('All');
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const products = useMemo(() => [...catalogOf(state).values()], [state.products, state.stock]);
  const reorder = reorderList(products);
  const backorders = state.bills.flatMap((b) => b.backorder);
  const list = products
    .filter((p) => cat === 'All' || p.category === cat)
    .filter((p) => !q || (p.name + ' ' + p.aliases.join(' ') + ' ' + p.sku).toLowerCase().includes(q.toLowerCase()));
  const value = products.reduce((a, p) => a + p.stock * p.rate, 0);
  const arrives = reorder[0]?.arrives;
  const CATS = ['All', ...new Set(products.map((p) => p.category))];
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Stock</h1>
          <p>Live stock after every bill. Items at or below their reorder point go on the list for the next supplier order.</p>
        </div>
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}><IconPlus />Add product</button>
      </div>
      {adding && <AddProduct state={state} dispatch={dispatch} toast={toast} onClose={() => setAdding(false)} />}
      <div className="kpis">
        <div className="panel kpi"><small>Items in catalog</small><b>{products.length}</b><span>{new Set(products.map((p) => p.category)).size} categories</span></div>
        <div className="panel kpi"><small>Stock value at cost</small><b className="num">{cash(value)}</b><span>wholesale rate, before tax</span></div>
        <div className="panel kpi"><small>Need reorder</small><b style={{ color: reorder.length ? 'var(--haldi)' : undefined }}>{reorder.length}</b><span>{products.filter((p) => p.stock === 0).length} out of stock</span></div>
      </div>

      <section className="panel container-card" aria-labelledby="next-order">
        <header>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--carbon-soft)', color: 'var(--carbon)', display: 'grid', placeItems: 'center' }}><IconShip className="" /></span>
          <div style={{ minWidth: 0 }}>
            <h2 id="next-order">Next supplier order</h2>
            <p>{reorder.length ? `${reorder.length} items to reorder, rounded to full cartons. If ordered today, it lands around ${arrives ? shortDate(arrives) : '—'}.` : 'Nothing needs reordering right now.'}{backorders.length ? ` Includes ${backorders.length} backorder line${backorders.length > 1 ? 's' : ''} from recent bills.` : ''}</p>
          </div>
        </header>
        <div className="reorders">
          {reorder.map((r) => (
            <div className="reorder" key={r.product.sku}>
              <b>{r.product.name}</b>
              <span className="big num">{r.suggest} {unitLabel(r.product.unit, r.suggest)}</span>
              <small>{r.cover} · reorder point {r.product.reorderAt} · {r.product.sku}</small>
            </div>
          ))}
        </div>
      </section>

      <div className="filters" role="group" aria-label="Filter by category">
        {CATS.map((c) => <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        <label className="sr" htmlFor="stock-q">Search stock</label>
        <input id="stock-q" placeholder="Search, e.g. stapler, grapadora, 24/6" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="panel table-panel">
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Item</th><th>Category</th><th className="r">Rate</th><th>Tax</th><th>Stock</th><th className="r">On hand</th><th aria-label="Receive stock" /></tr></thead>
            <tbody>
              {list.map((p) => {
                const full = p.reorderAt * 3;
                const pct = Math.min(100, (p.stock / full) * 100);
                const cls = p.stock === 0 ? 'out' : p.stock <= p.reorderAt ? 'low' : '';
                return (
                  <tr key={p.sku}>
                    <td><b>{p.name}</b><span className="sub">{p.sku}{p.aliases.length ? ` · also “${p.aliases.slice(0, 3).join('”, “')}”` : ''}</span></td>
                    <td>{p.category}</td>
                    <td className="r num">{cash(p.rate, 2)}/{p.unit}</td>
                    <td className="num">{p.tax}%{p.hs ? ` · HS ${p.hs}` : ''}</td>
                    <td><span className={`meter ${cls}`} title={`Reorder point ${p.reorderAt}`}><b style={{ width: `${pct}%` }} /><i style={{ left: `${(p.reorderAt / full) * 100}%` }} /></span></td>
                    <td className="r num">{p.stock} {unitLabel(p.unit, p.stock)}{cls && <span className={`st ${cls === 'out' ? 'short' : 'review'}`} style={{ marginLeft: 8 }}>{cls === 'out' ? 'Out' : 'Low'}</span>}</td>
                    <td className="r"><Receive sku={p.sku} unit={p.unit} dispatch={dispatch} toast={toast} /></td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr><td colSpan={7}><div className="empty">
                  <h3>{products.length ? 'Nothing matches that search' : 'No products yet'}</h3>
                  <p>{products.length ? 'Try another name or category.' : 'Add the products you sell, with the names your customers use for them.'}</p>
                  {!products.length && <button className="btn primary" onClick={() => setAdding(true)}><IconPlus />Add your first product</button>}
                </div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Insights */

export function Insights({ state }: { state: State }) {
  const now = Date.now();
  const days = Array.from({ length: 7 }, (_, i) => startOfDay(now - (6 - i) * DAY));
  const byDay = days.map((d) => state.bills.filter((b) => b.createdAt >= d && b.createdAt < d + DAY));
  const values = byDay.map((bs) => bs.reduce((a, b) => a + b.invoice.grandTotal, 0));
  const max = Math.max(1, ...values);
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = Math.ceil(max / (mag / 2)) * (mag / 2);
  const short$ = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
  const week = state.bills.filter((b) => b.createdAt >= days[0]);
  const lines = week.reduce((a, b) => a + b.auto + b.checked + b.ai, 0);
  const auto = week.reduce((a, b) => a + b.auto, 0);
  const autoPct = lines ? Math.round((auto / lines) * 100) : 0;
  const manualMin = 6;     // assumption: reading a message and typing it into billing software by hand
  const parchiMin = 0.75;  // reviewing a parsed order in Parchi
  const saved = Math.round(week.length * (manualMin - parchiMin));
  const channels = (['text', 'voice', 'photo'] as const).map((c) => ({ c, n: week.filter((b) => b.channel === c).length }));
  const chanColor = { text: 'var(--carbon)', voice: 'var(--leaf)', photo: 'var(--haldi)' } as const;
  const langs = new Map<string, number>();
  week.forEach((b) => b.languages.forEach((l) => langs.set(l, (langs.get(l) ?? 0) + 1)));
  const items = new Map<string, number>();
  week.forEach((b) => b.invoice.lines.forEach((l) => items.set(l.name, (items.get(l.name) ?? 0) + l.taxable)));
  const top = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topMax = top[0]?.[1] ?? 1;
  const today = byDay[6];

  const W = 640, H = 220, padL = 52, padB = 28, padT = 16;
  const bw = (W - padL - 10) / 7;
  const y = (v: number) => H - padB - (v / nice) * (H - padB - padT);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>This week</h1>
          <p>What came in, how it came in, and how much of it Parchi read without help.</p>
        </div>
      </div>
      <div className="kpis">
        <div className="panel kpi"><small>Billed today</small><b className="num">{cash(values[6])}</b><span>{today.length} bill{today.length === 1 ? '' : 's'}</span></div>
        <div className="panel kpi"><small>Billed this week</small><b className="num">{cash(values.reduce((a, b) => a + b, 0))}</b><span>{week.length} bills from {new Set(week.map((b) => b.invoice.party.id)).size} customers</span></div>
        <div className="panel kpi"><small>Lines read without help</small><b>{autoPct}%</b><span>{auto} of {lines} order lines</span></div>
        <div className="panel kpi"><small>Time saved this week</small><b>{Math.floor(saved / 60)} h {saved % 60} m</b><span>at {manualMin} min per order typed by hand</span></div>
      </div>

      <div className="two">
        <section className="panel chart-card" aria-labelledby="c1">
          <h2 id="c1">Order value by day</h2>
          <div className="chart">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart of billed value for the last 7 days">
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={padL} x2={W - 4} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--rule)" strokeDasharray={f ? '3 4' : undefined} />
                  <text x={padL - 8} y={y(nice * f) + 4} textAnchor="end">{short$(nice * f)}</text>
                </g>
              ))}
              {values.map((v, i) => {
                const x = padL + i * bw + bw * 0.18;
                const w = bw * 0.64;
                const isToday = i === 6;
                return (
                  <g key={i}>
                    <rect x={x} y={y(v)} width={w} height={Math.max(0, H - padB - y(v))} rx={4} fill={isToday ? 'var(--brand)' : 'var(--carbon)'} opacity={isToday ? 1 : 0.85} />
                    {v > 0 && <text className="val" x={x + w / 2} y={y(v) - 6} textAnchor="middle">{short$(v)}</text>}
                    <text x={x + w / 2} y={H - 8} textAnchor="middle">{isToday ? 'Today' : new Date(days[i]).toLocaleDateString('en-US', { weekday: 'short' })}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </section>
        <section className="panel chart-card" aria-labelledby="c2">
          <h2 id="c2">How orders arrive</h2>
          <div className="stack" role="img" aria-label="Share of orders by channel">
            {channels.map(({ c, n }) => <b key={c} style={{ width: `${(n / Math.max(1, week.length)) * 100}%`, background: chanColor[c] }} />)}
          </div>
          <div className="legend-row">
            {channels.map(({ c, n }) => <span key={c}><i style={{ background: chanColor[c] }} />{c === 'text' ? 'Text' : c === 'voice' ? 'Voice notes' : 'Photos of slips'} {n}</span>)}
          </div>
          <h2 style={{ marginTop: 8 }}>Languages in orders</h2>
          <div className="legend-row">
            {[...langs.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => <span key={l}><b style={{ color: 'var(--ink)' }}>{l}</b> in {n} orders</span>)}
          </div>
          <h2 style={{ marginTop: 8 }}>Time per order</h2>
          <div className="compare">
            <div className="row"><span>Typed by hand</span><span className="bar old" style={{ width: '100%' }}>{manualMin} min</span></div>
            <div className="row"><span>Checked in Parchi</span><span className="bar new" style={{ width: `${(parchiMin / manualMin) * 100 + 8}%` }}>45 s</span></div>
          </div>
          <p>Hand-typing time is an estimate; measure it in your own shop before trusting it.</p>
        </section>
      </div>

      <section className="panel chart-card" aria-labelledby="c3">
        <h2 id="c3">Top items this week, by billed value</h2>
        <div className="hbar">
          {top.map(([name, v]) => (
            <div className="row" key={name}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</span>
              <span className="track"><b style={{ width: `${(v / topMax) * 100}%` }} /></span>
              <span>{cash(v)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Plans */

export function Plans() {
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>Plans</h1>
          <p>Priced per shop, not per user, because a wholesale counter is three people sharing one phone.</p>
        </div>
      </div>
      <div className="tiers">
        <div className="panel tier">
          <h2>Starter</h2>
          <p className="who">For a trader trying it out</p>
          <p className="price">$0 <small>/ month</small></p>
          <ul>
            <li>40 orders a month</li>
            <li>Text orders in 8 languages</li>
            <li>Invoices with tax summary</li>
            <li>One login</li>
          </ul>
        </div>
        <div className="panel tier pick">
          <span className="flag">Most shops</span>
          <h2>Shop</h2>
          <p className="who">For a counter billing every day</p>
          <p className="price">$19 <small>/ month</small></p>
          <ul>
            <li>Unlimited text orders</li>
            <li>300 photo and voice-note reads a month</li>
            <li>Live stock and reorder list</li>
            <li>Collections: who owes what, and since when</li>
            <li>Three logins</li>
          </ul>
        </div>
        <div className="panel tier">
          <h2>Warehouse</h2>
          <p className="who">For importers and distributors</p>
          <p className="price">$59 <small>/ month</small></p>
          <ul>
            <li>WhatsApp Business inbox: orders arrive in Parchi directly</li>
            <li>Unlimited photo and voice reads</li>
            <li>Several warehouses and price lists</li>
            <li>Export to QuickBooks, Xero and Zoho Books</li>
            <li>Ten logins</li>
          </ul>
        </div>
      </div>

      <section className="panel econ" aria-labelledby="econ">
        <h2 id="econ">How Parchi makes money and stays cheap to run</h2>
        <div className="econ-grid">
          <div><h3>Rules first, model on doubt</h3><b>~$0</b><span>for the typical order line: read on the device by the rules engine in a few milliseconds. Only unclear lines and photos go to a model.</span></div>
          <div><h3>Revenue per paying shop</h3><b>$19–59</b><span>a month, plus WhatsApp message charges passed through at cost on the Warehouse plan.</span></div>
          <div><h3>The wedge</h3><b>One market at a time</b><span>Start with wholesale districts where orders already run on WhatsApp, then spread through each distributor's retailers.</span></div>
          <div><h3>Why it spreads</h3><b>Every bill</b><span>goes back to a retailer on WhatsApp. Retailers who see clean bills ask their other suppliers for the same.</span></div>
        </div>
      </section>

      <section className="prose" aria-labelledby="why">
        <h2 id="why" style={{ fontSize: 'var(--t-xl)' }}>Who it is for</h2>
        <p>Small retailers everywhere order from wholesalers the same way: chat messages, voice notes and photos of handwritten slips, in their own language and full of local trade words. Someone at the wholesaler retypes every one into billing software. Parchi reads the order the way the customer wrote it and hands back a ready invoice.</p>
      </section>
    </div>
  );
}

