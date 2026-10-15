// Catalog matcher: maps loose item text ("gift wrap red wala", "sciccors", "पेचकस")
// to SKUs. It blends three signals:
//   1. token similarity weighted by IDF, so rare words ("stapler") count more than common ones ("set")
//   2. character-trigram similarity against every name and alias, which absorbs typos and
//      run-together words ("giftwrap", "notbook")
//   3. structured agreement on specs (24/6, 9w, 6x8), colour and size
// The same index shape maps 1:1 to a pgvector + pg_trgm setup in Postgres (see supabase/).

import type { Candidate, ExtractedLine, Product } from './types';
import { fold, normSpec } from './normalize';

export interface CatalogIndex {
  products: Product[];
  docTokens: Map<string, Set<string>>;   // sku -> folded tokens
  phrases: Map<string, string[]>;        // sku -> folded phrases (name + aliases, spaces removed)
  idf: Map<string, number>;
  vocab: string[];
  specs: Map<string, Set<string>>;
}

export function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = trigrams(a);
  const B = trigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

const tokenizeName = (s: string) =>
  s.split(/[\s,()/+-]+/).map((w) => fold(w)).filter((w) => w.length > 0 && !/^\d+$/.test(w));

export function buildIndex(products: Product[]): CatalogIndex {
  const docTokens = new Map<string, Set<string>>();
  const phrases = new Map<string, string[]>();
  const specs = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const p of products) {
    const toks = new Set<string>();
    const sources = [p.name, ...p.aliases];
    for (const s of sources) for (const t of tokenizeName(s)) toks.add(t);
    docTokens.set(p.sku, toks);
    phrases.set(p.sku, sources.map((s) => tokenizeName(s).join('')));
    specs.set(p.sku, new Set((p.specs ?? []).map(normSpec)));
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = products.length;
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + N / n));
  return { products, docTokens, phrases, idf, vocab: [...df.keys()], specs };
}

function tokenSim(q: string, d: string): number {
  if (q === d) return 1;
  if (q.length >= 3 && d.startsWith(q)) return 0.86;
  if (d.length >= 4 && q.startsWith(d)) return 0.8;
  return dice(q, d);
}

/** Specs of the same kind ("9w" vs "12w") contradict each other; different kinds don't. */
function specKind(s: string): string {
  return s.replace(/[\d.]+/g, '#');
}

export interface MatchContext {
  /** SKUs this customer bought before, most recent first. */
  history?: string[];
}

export function matchLine(index: CatalogIndex, line: ExtractedLine, ctx: MatchContext = {}, k = 6): Candidate[] {
  const q = line.itemTokens.filter((t) => t.length > 1);
  if (q.length === 0 && line.specs.length === 0) return [];
  const qPhrase = q.join('');
  const results: Candidate[] = [];

  for (const p of index.products) {
    const toks = index.docTokens.get(p.sku)!;
    const reasons: string[] = [];

    // 1. IDF-weighted token coverage of the query
    let num = 0;
    let den = 0;
    let bestWord = '';
    let bestWordSim = 0;
    for (const qt of q) {
      let best = 0;
      let bestTok = '';
      for (const dt of toks) {
        const s = tokenSim(qt, dt);
        if (s > best) { best = s; bestTok = dt; }
      }
      const w = index.idf.get(bestTok) ?? 1.2;
      num += w * best;
      den += w;
      if (best > bestWordSim) { bestWordSim = best; bestWord = bestTok; }
    }
    const tokScore = den ? num / den : 0;

    // 2. best trigram similarity against the product's name and each alias
    let phraseScore = 0;
    for (const ph of index.phrases.get(p.sku)!) phraseScore = Math.max(phraseScore, dice(qPhrase, ph));

    // Text similarity tops out at 0.8; the remaining headroom is earned by agreeing on specs,
    // colour and size, so exact variants beat siblings that share the same name.
    let score = q.length ? 0.8 * (0.6 * tokScore + 0.4 * phraseScore) : 0.25;
    if (bestWordSim >= 0.99 && bestWord) reasons.push(`“${bestWord}” matches`);
    else if (bestWordSim >= 0.6 && bestWord) reasons.push(`close to “${bestWord}”`);

    // 3. structured agreement
    const pSpecs = index.specs.get(p.sku)!;
    for (const s of line.specs) {
      if (pSpecs.has(s)) { score += 0.16; reasons.push(`size ${s} matches`); }
      else if ([...pSpecs].some((ps) => specKind(ps) === specKind(s))) { score -= 0.22; }
    }
    if (line.color) {
      if (p.color === line.color) { score += 0.12; reasons.push(`${line.color} matches`); }
      else if (p.color) score -= 0.16;
    }
    if (line.size) {
      if (p.size === line.size) { score += 0.1; reasons.push(`${line.size} size matches`); }
      else if (p.size) score -= 0.12;
    }

    results.push({ sku: p.sku, score: Math.max(0, score), reasons });
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, k);

  // 4. customer history breaks near-ties: when the top candidates are within 0.12 of each
  //    other and exactly one of them was bought by this customer before, prefer it.
  if (ctx.history?.length && top.length > 1) {
    const lead = top[0].score;
    const tied = top.filter((c) => lead - c.score < 0.12 && c.score > 0.3);
    const known = tied.filter((c) => ctx.history!.includes(c.sku));
    if (tied.length > 1 && known.length === 1) {
      known[0].score += 0.12;
      known[0].reasons.push('bought by this customer before');
      top.sort((a, b) => b.score - a.score);
    }
  }
  return top;
}

/** Confidence blends the top score with its lead over the runner-up. */
export function confidenceOf(cands: Candidate[]): number {
  if (!cands.length) return 0;
  const top = Math.min(1, cands[0].score);
  const margin = cands[0].score - (cands[1]?.score ?? 0);
  return Math.max(0, Math.min(0.99, top * 0.82 + Math.min(margin, 0.3) * 0.6));
}

/** Free-text catalog search for the trader's manual picker. */
export function searchCatalog(index: CatalogIndex, query: string, limit = 8): Product[] {
  const toks = query.split(/\s+/).map(fold).filter(Boolean);
  if (!toks.length) return index.products.slice(0, limit);
  const line = { itemTokens: toks, specs: [], highlights: [] } as unknown as ExtractedLine;
  const bySku = new Map(index.products.map((p) => [p.sku, p]));
  return matchLine(index, line, {}, limit).filter((c) => c.score > 0.2).slice(0, limit).map((c) => bySku.get(c.sku)!);
}
