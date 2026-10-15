// Model-on-doubt layer. The rules engine resolves most lines; a language model is
// called only for (a) reading a photo of a handwritten parchi and (b) lines the
// rules marked "review" or "unmatched". The model provider is injected, so the
// browser demo, the Edge Function and the tests can each supply their own.

import type { Candidate, OrderLine, Party, Product } from './types';

export type ModelCall = (prompt: string, opts?: { images?: Blob[] }) => Promise<string>;

export function parseJsonLoose<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return undefined;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end <= start) return undefined;
  try { return JSON.parse(body.slice(start, end + 1)) as T; } catch { return undefined; }
}

export const TRANSCRIBE_PROMPT = `You are reading a photo of a handwritten order slip sent to a wholesaler.
Transcribe exactly what is written, one item per line, keeping quantities, units, sizes and colours.
Keep every word in the language and script it is written in.
Do not add, correct or guess items. If a line is illegible, write [illegible].
Return only the transcription text, nothing else.`;

export function resolvePrompt(line: OrderLine, candidates: Candidate[], catalog: Map<string, Product>, party?: Party): string {
  const options = candidates
    .slice(0, 6)
    .map((c) => {
      const p = catalog.get(c.sku)!;
      return `- ${p.sku}: ${p.name} (${p.category}; sold per ${p.unit}${p.specs?.length ? '; specs ' + p.specs.join(', ') : ''})`;
    })
    .join('\n');
  return `A wholesale customer${party ? ` (${party.name}, ${party.city})` : ''} wrote this order line, possibly in a mix of languages:
"${line.raw}"

Which catalog item do they mean? Options:
${options}

Rules: choose only from the options. If none fits, use null. Local trade words are common
(e.g. "grapadora" = stapler, "pechkas" = screwdriver, "مفك" = screwdriver, "dabba"/"caja" = box).
Reply with JSON only: {"sku": "<sku or null>", "confidence": <0-1>, "reason": "<under 15 words>"}`;
}

export interface ResolveAnswer { sku: string | null; confidence: number; reason: string }

export function parseResolve(text: string, allowed: string[]): ResolveAnswer | undefined {
  const j = parseJsonLoose<ResolveAnswer>(text);
  if (!j || typeof j !== 'object') return undefined;
  const sku = j.sku && allowed.includes(j.sku) ? j.sku : null;
  const confidence = typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : 0.5;
  return { sku, confidence, reason: String(j.reason ?? '').slice(0, 120) };
}

export async function resolveWithModel(
  model: ModelCall, line: OrderLine, catalog: Map<string, Product>, party?: Party,
): Promise<ResolveAnswer | undefined> {
  const cands = line.candidates.slice(0, 6);
  if (!cands.length) return undefined;
  const text = await model(resolvePrompt(line, cands, catalog, party));
  return parseResolve(text, cands.map((c) => c.sku));
}

export async function transcribeParchi(model: ModelCall, image: Blob): Promise<string> {
  const text = await model(TRANSCRIBE_PROMPT, { images: [image] });
  return text.trim();
}

/** One prompt for every doubtful line in an order, so a whole order costs one model call. */
export function resolveBatchPrompt(lines: OrderLine[], catalog: Map<string, Product>, party?: Party): string {
  const blocks = lines.map((l) => {
    const opts = l.candidates.slice(0, 6).map((c) => {
      const p = catalog.get(c.sku)!;
      return `    - ${p.sku}: ${p.name} (sold per ${p.unit}${p.specs?.length ? '; ' + p.specs.join(', ') : ''})`;
    }).join('\n');
    return `  Line ${l.id}: "${l.raw}"\n  Options:\n${opts}`;
  }).join('\n\n');
  return `You help a wholesaler turn customer order messages into bills.
Customer${party ? `: ${party.name}, ${party.city}` : ''}. The message may be in any language or a mix of languages.
Trade words vary by market: grapadora = stapler, caixa = box, douzaine = dozen, كرتونة = carton,
lusin = dozen, pechkas = screwdriver, dabba = box.

For each line below, choose the catalog item the customer most likely means, only from that line's options.
Use null when none of the options fits.

${blocks}

Reply with only a JSON array, one object per line, like:
[{"line": "L1", "sku": "STA-102", "confidence": 0.9, "reason": "24/6 is the heavy stapler size"}]
Keep each reason under 12 words.`;
}

export interface BatchAnswer { line: string; sku: string | null; confidence: number; reason: string }

export function parseBatch(value: unknown, lines: OrderLine[]): BatchAnswer[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: BatchAnswer[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const line = byId.get(String(o.line));
    if (!line) continue;
    const allowed = line.candidates.slice(0, 6).map((c) => c.sku);
    const sku = typeof o.sku === 'string' && allowed.includes(o.sku) ? o.sku : null;
    const confidence = typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.5;
    out.push({ line: line.id, sku, confidence, reason: String(o.reason ?? '').slice(0, 100) });
  }
  return out;
}
