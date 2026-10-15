// App state: inbox, parsed drafts, bills and live stock. Pure reducer + seed data.

import {
  buildIndex, buildInvoice, chooseSku, fillPlan, parseOrder, type CatalogIndex, type Invoice, type OrderLine, type ParsedOrder,
  type Party, type Product, type Seller,
} from '../engine';
import { CATALOG } from '../data/catalog';
import { HISTORY, PARTIES, SELLER } from '../data/parties';
import { INBOX, type Channel } from '../data/inbox';

export type View = 'desk' | 'orders' | 'stock' | 'insights' | 'plans';

export interface Msg {
  id: string;
  partyId: string;
  channel: Channel;
  sentAt: number;
  text: string;
  durationSec?: number;
  photo?: string;          // 'sample-parchi' or a data URL for an uploaded photo
  status: 'new' | 'read' | 'billed';
  invoiceNo?: string;
  custom?: boolean;
}

export interface Draft extends ParsedOrder {
  parsedAt: number;
  shipAvailable: boolean;
  aiAsked: boolean;
}

export interface Bill {
  invoice: Invoice;
  msgId?: string;
  channel: Channel;
  createdAt: number;
  paid: boolean;
  backorder: { sku: string; qty: number }[];
  auto: number;
  checked: number;
  ai: number;
  languages: string[];
}

export type Mode = 'demo' | 'fresh';

export interface State {
  mode: Mode | null;         // null: show the welcome screen
  seller: Seller;
  products: Product[];       // catalog definitions; live quantities are in `stock`
  parties: Party[];
  view: View;
  selected?: string;
  messages: Msg[];
  drafts: Record<string, Draft>;
  bills: Bill[];
  stock: Record<string, number>;
  seq: number;
  theme: 'light' | 'dark' | null;
}

const indexCache = new WeakMap<Product[], CatalogIndex>();
export function indexFor(products: Product[]): CatalogIndex {
  let ix = indexCache.get(products);
  if (!ix) { ix = buildIndex(products); indexCache.set(products, ix); }
  return ix;
}

export function catalogOf(state: Pick<State, 'products' | 'stock'>): Map<string, Product> {
  return new Map(state.products.map((p) => [p.sku, { ...p, stock: state.stock[p.sku] ?? p.stock }]));
}

export const WALK_IN: Party = PARTIES.find((p) => p.id === 'P08')!;

export function partyOf(state: Pick<State, 'parties'>, id: string): Party {
  return state.parties.find((p) => p.id === id) ?? WALK_IN;
}

/** Products this customer bought before, most recent first (from real invoices, plus demo history). */
export function historyFor(state: Pick<State, 'bills' | 'mode'>, partyId: string): string[] {
  const seen: string[] = [];
  for (const b of [...state.bills].sort((x, y) => y.createdAt - x.createdAt)) {
    if (b.invoice.party.id !== partyId) continue;
    for (const l of b.invoice.lines) if (!seen.includes(l.sku)) seen.push(l.sku);
  }
  if (state.mode === 'demo') for (const sku of HISTORY[partyId] ?? []) if (!seen.includes(sku)) seen.push(sku);
  return seen;
}

export function parseFor(msg: Msg, state: Pick<State, 'products' | 'stock' | 'bills' | 'mode'>): Draft {
  const parsed = parseOrder(msg.text, {
    index: indexFor(state.products), catalog: catalogOf(state), sentAt: new Date(msg.sentAt), history: historyFor(state, msg.partyId),
  });
  return { ...parsed, parsedAt: Date.now(), shipAvailable: true, aiAsked: false };
}

const startOfToday = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** A week of earlier bills so Orders and Insights open with realistic history. */
function seedBills(now: number): Bill[] {
  const day = 86_400_000;
  const templates: [string, string, number, boolean, Channel][] = [
    ['P04', '200 ball pen blue, 4 dozen notebook 200 pages, 2 box pencil, 1 dozen scissors', 6, true, 'text'],
    ['P01', '2 cajas de grapadoras 24/6, 10 paquetes de grapas 24/6, 24 cinta adhesiva', 6, true, 'text'],
    ['P06', 'pechkas 2 set, taala 40mm 1 dabba, measuring tape 1 dozen', 5, true, 'voice'],
    ['P03', '١ كرتونة لمبة ليد 12W، ١٠ مشترك 6 socket، ٢ علب بطارية AAA', 5, true, 'text'],
    ['P02', '2 dúzias de mamadeiras 125ml, 16 pacotes de fraldas pequenas, 1 caixa de lenços umedecidos', 4, true, 'text'],
    ['P05', '24 cadres photo 8x10, 12 horloges murales, 50 papier cadeau doré, 20 tasses', 4, false, 'photo'],
    ['P07', 'gel pen 200, geometry box 24, eraser 5 box, sharpner 5 box, stapler 1 box', 3, true, 'photo'],
    ['P01', '3 docenas de papel de regalo rojo, 50 bolsas de regalo, 2 rollos de cinta de embalaje', 3, false, 'text'],
    ['P06', 'plaas 1 dozen, hathoda bada 6, allen key 6 set, cable tie 10 pkt', 2, false, 'voice'],
    ['P04', 'sticky notes 2 box, highlighter 2 box, glue stick 1 box, file folder A4 100, tape 2 dozen', 2, true, 'text'],
    ['P03', '٢ كرتونة لمبة ليد 9W، ٢٠ شاحن، ٥٠ كابل، ١ علبة سماعات', 1, false, 'text'],
    ['P02', 'fraldas médias 24 pacotes, grandes 16 pacotes, 12 chocalho, 12 copo de transição', 1, false, 'voice'],
    ['P07', '4 box sticky notes, 5 dozen eraser, glue stick 2 box', 1, false, 'text'],
    ['P05', 'ours en peluche 12 inch 20, ours en peluche 24 inch 6, 40 guirlande lumineuse, 100 sac cadeau', 0, false, 'text'],
  ];
  // bill numbers follow the order the bills were made
  templates.sort((a, b) => b[2] - a[2]);
  const cat = new Map(CATALOG.map((p) => [p.sku, p]));
  return templates.map(([pid, text, daysAgo, paid, channel], i) => {
    const party = PARTIES.find((p) => p.id === pid)!;
    const at = Math.min(now - 3_600_000, startOfToday(now) - daysAgo * day + (10 + (i % 6)) * 3_600_000);
    const parsed = parseOrder(text, { index: indexFor(CATALOG), catalog: cat, sentAt: new Date(at), history: HISTORY[pid] });
    const lines = parsed.lines.map((l) => (l.sku ? l : l.candidates[0] ? chooseSku(l, l.candidates[0].sku, cat, 'trader') : l));
    const invoice = buildInvoice(SELLER, party, lines, cat, { seq: 128 + i, date: new Date(at) });
    return {
      invoice, channel, createdAt: at, paid, backorder: [],
      auto: parsed.stats.auto, checked: parsed.stats.review + parsed.stats.unmatched, ai: 0, languages: parsed.languages,
    };
  });
}

/** The welcome screen: nothing chosen yet. */
export function welcomeState(theme: State['theme'] = null): State {
  return {
    mode: null, seller: { ...SELLER }, products: [], parties: [WALK_IN], view: 'desk', messages: [], drafts: {}, bills: [],
    stock: {}, seq: 0, theme,
  };
}

/** The guided demo: a fictional distributor with a catalog, customers, an inbox and a week of invoices. */
export function demoState(theme: State['theme'] = null): State {
  const now = Date.now();
  const base = { mode: 'demo' as const, products: CATALOG, stock: Object.fromEntries(CATALOG.map((p) => [p.sku, p.stock])), bills: [] as Bill[] };
  const messages: Msg[] = INBOX.map((m) => ({
    id: m.id, partyId: m.partyId, channel: m.channel, sentAt: now - m.minutesAgo * 60_000, text: m.text,
    durationSec: m.durationSec, photo: m.photo, status: 'new',
  }));
  const bills = seedBills(now);
  const first = messages[0];
  const drafts: Record<string, Draft> = { [first.id]: parseFor(first, { ...base, bills }) };
  first.status = 'read';
  return {
    ...base, seller: { ...SELLER, sample: true }, parties: PARTIES, view: 'desk', selected: first.id, messages, drafts, bills,
    seq: 128 + bills.length, theme,
  };
}

/** An empty desk for the user's own business. */
export function freshState(name: string, currency: string, symbol: string, theme: State['theme'] = null): State {
  return {
    ...welcomeState(theme), mode: 'fresh', view: 'stock',
    seller: { name: name.trim() || 'My business', tagline: 'Wholesale', taxId: '', currency, currencySymbol: symbol, sample: false },
  };
}

export const initialState = demoState;

export type Action =
  | { type: 'view'; view: View }
  | { type: 'select'; id: string }
  | { type: 'parse'; id: string }
  | { type: 'addMessage'; msg: Msg }
  | { type: 'setText'; id: string; text: string }
  | { type: 'updateLine'; id: string; line: OrderLine }
  | { type: 'removeLine'; id: string; lineId: string }
  | { type: 'acceptAll'; id: string }
  | { type: 'shipAvailable'; id: string; value: boolean }
  | { type: 'aiAsked'; id: string }
  | { type: 'confirm'; id: string }
  | { type: 'markPaid'; number: string; paid: boolean }
  | { type: 'theme'; theme: 'light' | 'dark' | null }
  | { type: 'start'; state: State }
  | { type: 'addProduct'; product: Product }
  | { type: 'receiveStock'; sku: string; qty: number }
  | { type: 'addParty'; party: Party }
  | { type: 'reset' };

export function billFor(state: State, id: string): { invoice: Invoice; backorder: { sku: string; qty: number }[] } | null {
  const msg = state.messages.find((m) => m.id === id);
  const d = state.drafts[id];
  if (!msg || !d) return null;
  const party = partyOf(state, msg.partyId);
  const cat = catalogOf(state);
  const lines = d.lines.filter((l) => l.sku);
  const plan = d.shipAvailable ? fillPlan(lines, cat) : undefined;
  const backorder: { sku: string; qty: number }[] = [];
  if (plan) for (const l of lines) {
    const short = l.billQty - (plan[l.id] ?? 0);
    if (short > 0) backorder.push({ sku: l.sku!, qty: short });
  }
  const invoice = buildInvoice(state.seller, party, lines, cat, { seq: state.seq + 1, date: new Date(), qtyOverride: plan });
  return { invoice, backorder };
}

export function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'view':
      return { ...state, view: a.view };
    case 'select': {
      const msg = state.messages.find((m) => m.id === a.id);
      if (!msg) return state;
      const drafts = state.drafts[a.id] || msg.status === 'billed' ? state.drafts : { ...state.drafts, [a.id]: parseFor(msg, state) };
      const messages = state.messages.map((m) => (m.id === a.id && m.status === 'new' ? { ...m, status: 'read' as const } : m));
      return { ...state, selected: a.id, drafts, messages, view: 'desk' };
    }
    case 'parse': {
      const msg = state.messages.find((m) => m.id === a.id);
      if (!msg) return state;
      return { ...state, drafts: { ...state.drafts, [a.id]: parseFor(msg, state) } };
    }
    case 'addMessage': {
      const messages = [a.msg, ...state.messages];
      return {
        ...state, messages: messages.map((m) => (m.id === a.msg.id ? { ...m, status: 'read' as const } : m)),
        selected: a.msg.id, drafts: { ...state.drafts, [a.msg.id]: parseFor(a.msg, state) }, view: 'desk',
      };
    }
    case 'setText': {
      const messages = state.messages.map((m) => (m.id === a.id ? { ...m, text: a.text } : m));
      const msg = messages.find((m) => m.id === a.id)!;
      return { ...state, messages, drafts: { ...state.drafts, [a.id]: parseFor(msg, state) } };
    }
    case 'updateLine': {
      const d = state.drafts[a.id];
      if (!d) return state;
      const lines = d.lines.map((l) => (l.id === a.line.id ? a.line : l));
      return { ...state, drafts: { ...state.drafts, [a.id]: { ...d, lines } } };
    }
    case 'removeLine': {
      const d = state.drafts[a.id];
      if (!d) return state;
      return { ...state, drafts: { ...state.drafts, [a.id]: { ...d, lines: d.lines.filter((l) => l.id !== a.lineId) } } };
    }
    case 'acceptAll': {
      const d = state.drafts[a.id];
      if (!d) return state;
      const cat = catalogOf(state);
      const lines = d.lines.map((l) => (l.status === 'review' && l.sku ? chooseSku(l, l.sku, cat, 'trader') : l));
      return { ...state, drafts: { ...state.drafts, [a.id]: { ...d, lines } } };
    }
    case 'shipAvailable': {
      const d = state.drafts[a.id];
      if (!d) return state;
      return { ...state, drafts: { ...state.drafts, [a.id]: { ...d, shipAvailable: a.value } } };
    }
    case 'aiAsked': {
      const d = state.drafts[a.id];
      if (!d) return state;
      return { ...state, drafts: { ...state.drafts, [a.id]: { ...d, aiAsked: true } } };
    }
    case 'confirm': {
      const res = billFor(state, a.id);
      const msg = state.messages.find((m) => m.id === a.id);
      const d = state.drafts[a.id];
      if (!res || !msg || !d || !res.invoice.lines.length) return state;
      const stock = { ...state.stock };
      for (const l of res.invoice.lines) stock[l.sku] = Math.max(0, (stock[l.sku] ?? 0) - l.qty);
      const bill: Bill = {
        invoice: res.invoice, msgId: a.id, channel: msg.channel, createdAt: Date.now(), paid: false, backorder: res.backorder,
        auto: d.lines.filter((l) => l.resolvedBy === 'rules' || l.resolvedBy === 'history').length,
        checked: d.lines.filter((l) => l.resolvedBy === 'trader').length,
        ai: d.lines.filter((l) => l.resolvedBy === 'ai').length,
        languages: d.languages,
      };
      return {
        ...state, stock, seq: state.seq + 1, bills: [...state.bills, bill],
        messages: state.messages.map((m) => (m.id === a.id ? { ...m, status: 'billed' as const, invoiceNo: res.invoice.number } : m)),
      };
    }
    case 'markPaid':
      return { ...state, bills: state.bills.map((b) => (b.invoice.number === a.number ? { ...b, paid: a.paid } : b)) };
    case 'theme':
      return { ...state, theme: a.theme };
    case 'start':
      return { ...a.state, theme: state.theme };
    case 'addProduct': {
      const products = [...state.products, a.product];
      const stock = { ...state.stock, [a.product.sku]: a.product.stock };
      const next = { ...state, products, stock };
      // re-read open orders so the new product is matched straight away
      const drafts = { ...state.drafts };
      for (const m of state.messages) if (m.status !== 'billed' && drafts[m.id]) drafts[m.id] = parseFor(m, next);
      return { ...next, drafts };
    }
    case 'receiveStock':
      return { ...state, stock: { ...state.stock, [a.sku]: Math.max(0, (state.stock[a.sku] ?? 0) + a.qty) } };
    case 'addParty':
      return { ...state, parties: [...state.parties.filter((p) => p.id !== WALK_IN.id), a.party, WALK_IN] };
    case 'reset':
      return welcomeState(state.theme);
  }
}

const KEY = 'parchi.desk.v2';

export function loadState(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s && Array.isArray(s.messages) && Array.isArray(s.products) && s.seller) return { ...s, view: s.view ?? 'desk' };
    }
  } catch { /* storage unavailable: start at the welcome screen */ }
  return welcomeState();
}

export function saveState(s: State) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
