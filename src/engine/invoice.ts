// Invoicing: per-line tax by rate, zero-rated export sales, tax summary by rate,
// rounding to whole currency units, amount in words and yearly invoice numbering.
// Currency and tax rates are settings, so the same code serves any market.

import type { Invoice, InvoiceLine, OrderLine, Party, Product, TaxRate } from './types';

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface Seller { name: string; tagline: string; taxId: string; currency: string; currencySymbol: string; sample?: boolean }

/** Currency unit names for amounts in words. */
export const CURRENCY_WORDS: Record<string, [string, string, string, string]> = {
  USD: ['dollar', 'dollars', 'cent', 'cents'], EUR: ['euro', 'euros', 'cent', 'cents'], GBP: ['pound', 'pounds', 'penny', 'pence'],
  AED: ['dirham', 'dirhams', 'fil', 'fils'], BRL: ['real', 'reais', 'centavo', 'centavos'], MXN: ['peso', 'pesos', 'centavo', 'centavos'],
  IDR: ['rupiah', 'rupiah', 'sen', 'sen'], NGN: ['naira', 'naira', 'kobo', 'kobo'], KES: ['shilling', 'shillings', 'cent', 'cents'],
  EGP: ['pound', 'pounds', 'piastre', 'piastres'], CAD: ['dollar', 'dollars', 'cent', 'cents'], AUD: ['dollar', 'dollars', 'cent', 'cents'],
};

/** 1234567.5 -> "1,234,567.50" */
export function money(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const tens = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? '-' + ONES[r % 10] : ''}`;
  return [h ? `${ONES[h]} hundred` : '', tens].filter(Boolean).join(' ');
}

function words(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const) {
    if (n >= size) { parts.push(`${below1000(Math.floor(n / size))} ${name}`); n %= size; }
  }
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

/** 4792.5 -> "Four thousand seven hundred ninety-two dollars and fifty cents" */
export function amountInWords(amount: number, currency = 'USD'): string {
  const [one, many, subOne, subMany] = CURRENCY_WORDS[currency] ?? CURRENCY_WORDS.USD;
  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);
  const w = `${words(whole)} ${whole === 1 ? one : many}${cents ? ` and ${words(cents)} ${cents === 1 ? subOne : subMany}` : ''}`;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function invoiceNumber(seq: number, d: Date, prefix = 'INV'): string {
  return `${prefix}-${d.getFullYear()}-${String(seq).padStart(4, '0')}`;
}

export function buildInvoice(
  seller: Seller,
  party: Party,
  lines: OrderLine[],
  catalog: Map<string, Product>,
  opts: { seq: number; date?: Date; qtyOverride?: Record<string, number> },
): Invoice {
  const date = opts.date ?? new Date();
  const merged = new Map<string, InvoiceLine>();
  for (const l of lines) {
    if (!l.sku) continue;
    const p = catalog.get(l.sku);
    if (!p) continue;
    const qty = opts.qtyOverride?.[l.id] ?? l.billQty;
    if (qty <= 0) continue;
    const taxRate = (party.export ? 0 : p.tax) as TaxRate;
    const prev = merged.get(p.sku);
    const q = (prev?.qty ?? 0) + qty;           // a customer may write the same item twice
    const taxable = r2(q * p.rate * (1 - party.discountPct / 100));
    const tax = r2((taxable * taxRate) / 100);
    merged.set(p.sku, {
      sku: p.sku, name: p.name, hs: p.hs, qty: q, unit: p.unit, rate: p.rate, discountPct: party.discountPct,
      taxable, taxRate, tax, total: r2(taxable + tax),
    });
  }
  const out = [...merged.values()];

  const byRate = new Map<TaxRate, { rate: TaxRate; taxable: number; tax: number }>();
  for (const l of out) {
    const s = byRate.get(l.taxRate) ?? { rate: l.taxRate, taxable: 0, tax: 0 };
    s.taxable = r2(s.taxable + l.taxable);
    s.tax = r2(s.tax + l.tax);
    byRate.set(l.taxRate, s);
  }
  const taxable = r2(out.reduce((a, l) => a + l.taxable, 0));
  const tax = r2(out.reduce((a, l) => a + l.tax, 0));
  const grandTotal = r2(taxable + tax);
  const due = new Date(date);
  due.setDate(due.getDate() + party.creditDays);

  return {
    number: invoiceNumber(opts.seq, date),
    date: date.toISOString().slice(0, 10),
    party,
    currency: seller.currency,
    export: party.export,
    lines: out,
    taxSummary: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    taxable,
    tax,
    roundOff: 0,
    grandTotal,
    amountInWords: amountInWords(grandTotal, seller.currency),
    dueDate: due.toISOString().slice(0, 10),
  };
}
