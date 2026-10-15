// The order pipeline: extract -> match -> score -> convert units.
// Rules handle the common case in a few milliseconds and cost nothing per order;
// only lines the rules are unsure about are sent to a language model (see ai.ts).

import type { OrderLine, ParsedOrder, Product } from './types';
import { extract } from './extract';
import { type CatalogIndex, confidenceOf, matchLine } from './match';
import { toBillUnit } from './units';

export const THRESHOLDS = { matched: 0.66, review: 0.4 };

export interface ParseOptions {
  index: CatalogIndex;
  catalog: Map<string, Product>;
  sentAt?: Date;
  history?: string[];
}

let lineSeq = 0;

export function statusFor(conf: number): OrderLine['status'] {
  if (conf >= THRESHOLDS.matched) return 'matched';
  if (conf >= THRESHOLDS.review) return 'review';
  return 'unmatched';
}

export function parseOrder(text: string, opts: ParseOptions): ParsedOrder {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ex = extract(text, opts.sentAt ?? new Date());
  const lines: OrderLine[] = ex.lines
    // chatter with no quantity and nothing like a catalog item ("hello how are you") is not an order line
    .filter((l) => !(l.qtyAssumed && l.specs.length === 0 && (matchLine(opts.index, l, {}, 1)[0]?.score ?? 0) < 0.35))
    .map((l) => {
    const candidates = matchLine(opts.index, l, { history: opts.history });
    const confidence = confidenceOf(candidates);
    const status = statusFor(confidence);
    const top = candidates[0];
    const sku = status === 'unmatched' ? undefined : top?.sku;
    const product = sku ? opts.catalog.get(sku) : undefined;
    const conv = product ? toBillUnit(l.qty, l.unit, product) : { billQty: l.qty };
    return {
      ...l,
      id: `L${++lineSeq}`,
      candidates,
      sku,
      confidence,
      status,
      billQty: conv.billQty,
      unitNote: conv.note,
      resolvedBy: top?.reasons.includes('bought by this customer before') ? 'history' : 'rules',
    };
  });
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    messageText: text,
    lines,
    deadline: ex.deadline,
    repeatHint: ex.repeatHint,
    languages: ex.languages,
    stats: {
      ms: Math.max(0.1, Math.round((t1 - t0) * 10) / 10),
      auto: lines.filter((l) => l.status === 'matched').length,
      review: lines.filter((l) => l.status === 'review').length,
      unmatched: lines.filter((l) => l.status === 'unmatched').length,
    },
  };
}

/** Trader (or the model) picks a SKU for a line; recompute the billed quantity. */
export function chooseSku(line: OrderLine, sku: string, catalog: Map<string, Product>, by: OrderLine['resolvedBy']): OrderLine {
  const p = catalog.get(sku);
  if (!p) return line;
  const conv = toBillUnit(line.qty, line.unit, p);
  return {
    ...line,
    sku,
    status: 'matched',
    confidence: by === 'trader' ? 1 : Math.max(line.confidence, 0.9),
    billQty: conv.billQty,
    unitNote: conv.note,
    resolvedBy: by,
  };
}

export function setQty(line: OrderLine, qty: number, catalog: Map<string, Product>): OrderLine {
  const p = line.sku ? catalog.get(line.sku) : undefined;
  const conv = p ? toBillUnit(qty, line.unit, p) : { billQty: qty };
  return { ...line, qty, qtyAssumed: false, billQty: conv.billQty, unitNote: conv.note };
}
