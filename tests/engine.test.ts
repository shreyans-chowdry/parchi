import { describe, expect, it } from 'vitest';
import {
  amountInWords, buildIndex, buildInvoice, extract, parseOrder, reorderList, tokenize,
} from '../src/engine';
import { CATALOG, CATALOG_MAP } from '../src/data/catalog';
import { HISTORY, PARTY_MAP, SELLER } from '../src/data/parties';
import { INBOX } from '../src/data/inbox';

const index = buildIndex(CATALOG);
const parse = (text: string, partyId?: string) =>
  parseOrder(text, { index, catalog: CATALOG_MAP, sentAt: new Date('2026-10-15T10:00:00Z'), history: partyId ? HISTORY[partyId] : undefined });
const skus = (text: string, partyId?: string) => parse(text, partyId).lines.map((l) => l.sku);
const msg = (id: string) => INBOX.find((m) => m.id === id)!;

describe('tokenizer', () => {
  it('keeps specs whole and finds separators', () => {
    const t = tokenize('2 box stapler 24/6, No.10 pins');
    expect(t.map((x) => x.raw)).toEqual(['2', 'box', 'stapler', '24/6', ',', 'No.10', 'pins']);
    expect(t[4].kind).toBe('sep');
  });
  it('normalises Arabic-Indic and Devanagari digits', () => {
    expect(tokenize('٢ كرتونة')[0].low).toBe('2');
    expect(tokenize('२ box')[0].low).toBe('2');
  });
});

describe('extraction', () => {
  it('reads Spanish quantities, units and colours', () => {
    const r = extract(msg('M1').text);
    expect(r.lines.map((l) => [l.qty, l.unit])).toEqual([[2, 'box'], [5, 'dozen'], [10, 'pkt'], [6, 'roll']]);
    expect(r.lines[1].color).toBe('red');
    expect(r.lines[0].specs).toContain('24/6');
    expect(r.deadline?.label).toBe('Tomorrow');
  });
  it('reads number words after the item and treats "bhej do" as a verb', () => {
    const r = extract('pliers ek dozen, hathoda chhe piece bhej do');
    expect(r.lines.map((l) => [l.itemText, l.qty, l.unit])).toEqual([['pliers', 1, 'dozen'], ['hathoda', 6, 'pc']]);
  });
  it('reads Portuguese number words and units', () => {
    const r = extract(msg('M3').text);
    expect(r.lines.map((l) => [l.qty, l.unit])).toEqual([[3, 'dozen'], [2, 'box'], [20, 'pkt']]);
    expect(r.languages).toContain('Portuguese');
  });
  it('reads slip-style "item - qty unit" lines', () => {
    const r = extract(msg('M5').text);
    expect(r.lines.map((l) => [l.qty, l.unit ?? null])).toEqual([[2, 'box'], [3, 'dozen'], [100, null], [12, null], [5, 'box']]);
    expect(r.lines[3].itemText.toLowerCase()).toBe('geometry box');
  });
  it('handles compound and fractional numbers', () => {
    expect(extract('do sau pen').lines[0].qty).toBe(200);
    expect(extract('half dozen mug').lines[0].qty).toBe(0.5);
    expect(extract('20pcs cable tie').lines[0]).toMatchObject({ qty: 20, unit: 'pc' });
  });
  it('drops "same as last time" phrases and flags a repeat order', () => {
    const r = extract(msg('M7').text);
    expect(r.repeatHint).toBe(true);
    expect(r.lines).toHaveLength(4);
  });
});

describe('matching', () => {
  it('uses specs to pick the right variant (Spanish)', () => {
    expect(skus(msg('M1').text, 'P01')).toEqual(['STA-102', 'GFT-201', 'STA-104', 'STA-115']);
  });
  it('understands trade words in a voice note', () => {
    expect(skus(msg('M2').text, 'P06')).toEqual(['HRD-401', 'HRD-402', 'HRD-403', 'HRD-406']);
  });
  it('handles Portuguese baby orders', () => {
    expect(skus(msg('M3').text, 'P02')).toEqual(['BAB-301', 'BAB-303', 'BAB-304']);
  });
  it('handles Arabic script', () => {
    expect(skus(msg('M4').text, 'P03')).toEqual(['ELE-501', 'ELE-503', 'ELE-505']);
  });
  it('survives spelling mistakes', () => {
    expect(skus(msg('M6').text, 'P04')).toEqual(['STA-105', 'STA-108', 'STA-113', 'HRD-405', 'STA-110']);
  });
  it('uses purchase history to settle an unspecified variant', () => {
    const p = parse(msg('M7').text, 'P05');
    expect(p.lines.map((l) => l.sku)).toEqual(['GFT-204', 'GFT-206', 'GFT-207', 'GFT-202']);
    expect(p.lines[3].resolvedBy).toBe('history');
  });
  it('photo transcription parses', () => {
    expect(skus(msg('M5').text, 'P07')).toEqual(['STA-101', 'STA-114', 'STA-107', 'STA-120', 'STA-112']);
  });
});

describe('robustness', () => {
  it('carries the item into elliptical lines', () => {
    expect(skus('want 25 large diapers and 10 small')).toEqual(['BAB-305', 'BAB-306']);
  });
  it('ignores chatter that is not an order line', () => {
    expect(parse('hello how are you').lines).toHaveLength(0);
  });
  it('asks for review when a variant is genuinely ambiguous', () => {
    const p = parse('Steplar 10');
    expect(p.lines[0].status).toBe('review');
    expect(p.lines[0].candidates.slice(0, 2).map((c) => c.sku).sort()).toEqual(['STA-101', 'STA-102']);
  });
});

describe('units', () => {
  it('converts dozen, box and carton into billing units', () => {
    expect(parse(msg('M4').text, 'P03').lines.map((l) => l.billQty)).toEqual([100, 10, 50]);
    expect(parse(msg('M1').text, 'P01').lines.map((l) => l.billQty)).toEqual([24, 60, 10, 6]);
  });
});

describe('invoice', () => {
  it('charges tax by item rate after the trade discount', () => {
    const p = parse(msg('M1').text, 'P01');
    const inv = buildInvoice(SELLER, PARTY_MAP.get('P01')!, p.lines, CATALOG_MAP, { seq: 143, date: new Date('2026-10-15') });
    const r = (sku: string) => CATALOG_MAP.get(sku)!.rate;
    const gross = 24 * r('STA-102') + 60 * r('GFT-201') + 10 * r('STA-104') + 6 * r('STA-115');
    expect(inv.taxable).toBeCloseTo(gross * 0.98, 1);
    expect(inv.tax).toBeCloseTo(inv.taxable * 0.15, 1);
    expect(inv.grandTotal).toBeCloseTo(inv.taxable + inv.tax, 2);
    expect(inv.number).toBe('INV-2026-0143');
    expect(inv.currency).toBe('USD');
  });
  it('zero-rates export customers', () => {
    const p = parse(msg('M4').text, 'P03');
    const inv = buildInvoice(SELLER, PARTY_MAP.get('P03')!, p.lines, CATALOG_MAP, { seq: 1 });
    expect(inv.export).toBe(true);
    expect(inv.tax).toBe(0);
    expect(inv.taxSummary.map((t) => t.rate)).toEqual([0]);
  });
  it('mixes tax rates in one summary', () => {
    const p = parse(msg('M6').text, 'P04');
    const inv = buildInvoice(SELLER, PARTY_MAP.get('P04')!, p.lines, CATALOG_MAP, { seq: 2 });
    expect(new Set(inv.taxSummary.map((t) => t.rate))).toEqual(new Set([0, 15]));
  });
  it('merges a repeated item into one line', () => {
    const p = parse('2 box stapler 24/6, 1 box stapler 24/6');
    const inv = buildInvoice(SELLER, PARTY_MAP.get('P08')!, p.lines, CATALOG_MAP, { seq: 3 });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0].qty).toBe(36);
  });
  it('writes amounts in words', () => {
    expect(amountInWords(123456)).toBe('One hundred twenty-three thousand four hundred fifty-six dollars');
    expect(amountInWords(1000000)).toBe('One million dollars');
    expect(amountInWords(4931.5)).toBe('Four thousand nine hundred thirty-one dollars and fifty cents');
  });
});

describe('stock', () => {
  it('suggests reorders for low items, rounded to packs', () => {
    const list = reorderList(CATALOG);
    const wrap = list.find((r) => r.product.sku === 'GFT-201')!;
    expect(wrap.suggest % 50).toBe(0);
    expect(wrap.suggest).toBeGreaterThanOrEqual(260);
  });
});

describe('speed', () => {
  it('parses a typical order in well under 50 ms', () => {
    const t = performance.now();
    for (let i = 0; i < 50; i++) parse(msg('M1').text, 'P01');
    expect((performance.now() - t) / 50).toBeLessThan(50);
  });
});

describe('global languages', () => {
  it('reads Spanish', () => {
    const p = parse('Hola, necesito 2 cajas de grapadoras 24/6, 5 docenas de papel de regalo rojo y 10 paquetes de grapas 24/6. Para mañana por favor');
    expect(p.lines.map((l) => l.sku)).toEqual(['STA-102', 'GFT-201', 'STA-104']);
    expect(p.lines.map((l) => l.billQty)).toEqual([24, 60, 10]);
    expect(p.deadline?.label).toBe('Tomorrow');
    expect(p.languages).toContain('Spanish');
  });
  it('reads Portuguese with plural sizes', () => {
    const p = parse('Olá, preciso de 3 dúzias de mamadeiras 250ml, 2 caixas de lenços umedecidos e 20 pacotes de fraldas médias');
    expect(p.lines.map((l) => l.sku)).toEqual(['BAB-301', 'BAB-303', 'BAB-304']);
    expect(p.lines.every((l) => l.status === 'matched')).toBe(true);
  });
  it('reads French with elision', () => {
    const p = parse("Bonjour, il me faut 2 cartons d'ampoules LED 9W, 10 multiprises 4 socket et 5 boîtes de piles AA. Pour demain svp");
    expect(p.lines.map((l) => l.sku)).toEqual(['ELE-501', 'ELE-503', 'ELE-505']);
    expect(p.lines[0].billQty).toBe(100);
  });
  it('reads Arabic script and Arabic-Indic digits', () => {
    const p = parse('السلام عليكم، عايز ٢ كرتونة لمبة ليد 9W، ١٠ مشترك 4 socket، و ٥ علب بطارية AA. بكرة لو سمحت');
    expect(p.lines.map((l) => [l.sku, l.billQty])).toEqual([['ELE-501', 100], ['ELE-503', 10], ['ELE-505', 50]]);
    expect(p.deadline?.label).toBe('Tomorrow');
    expect(p.languages).toContain('Arabic');
  });
  it('reads Indonesian', () => {
    const p = parse('Halo pak, tolong kirim 2 lusin gunting, 50 buku tulis 200 pages, 6 gembok 40mm dan 1 kotak pensil. Besok ya');
    expect(p.lines.map((l) => l.sku)).toEqual(['STA-113', 'STA-108', 'HRD-405', 'STA-110']);
    expect(p.lines[0].billQty).toBe(24);
  });
});
