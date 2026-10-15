import type { OrderUnit, Product } from './types';

export interface Converted { billQty: number; note?: string }

const UNIT_LABEL: Record<string, string> = {
  pc: 'pc', pkt: 'pkt', box: 'box', set: 'set', roll: 'roll', pair: 'pair', dozen: 'dozen', carton: 'carton', gross: 'gross',
};

export function unitLabel(u: string, qty = 2): string {
  const base = UNIT_LABEL[u] ?? u;
  if (qty === 1) return base;
  if (base === 'box') return 'boxes';
  if (base === 'pc') return 'pcs';
  if (base === 'dozen') return 'dozen';
  return base + 's';
}

/**
 * Convert what the customer asked for ("5 dozen", "2 peti") into the product's
 * billing unit. Anything that needs a guess is returned with a note so the trader
 * sees it before confirming.
 */
export function toBillUnit(qty: number, unit: OrderUnit | undefined, p: Product): Converted {
  if (!unit || unit === p.unit) return { billQty: qty };
  // pieces / packets / sets / rolls are used loosely by traders for "one unit"
  const looseUnits: OrderUnit[] = ['pc', 'pkt', 'set', 'roll', 'pair'];
  switch (unit) {
    case 'dozen':
      if (p.unit === 'box') return { billQty: qty * 12, note: '12 boxes per dozen, check with customer' };
      return { billQty: qty * 12, note: `${qty} dozen = ${qty * 12} ${unitLabel(p.unit, qty * 12)}` };
    case 'gross':
      return { billQty: qty * 144, note: `${qty} gross = ${qty * 144} ${unitLabel(p.unit, qty * 144)}` };
    case 'box':
      if (p.box) return { billQty: qty * p.box, note: `${qty} ${unitLabel('box', qty)} × ${p.box} = ${qty * p.box} ${unitLabel(p.unit, qty * p.box)}` };
      return { billQty: qty, note: 'Box size not set for this item; billed as single units' };
    case 'carton':
      if (p.carton) return { billQty: qty * p.carton, note: `${qty} ${unitLabel('carton', qty)} × ${p.carton} = ${qty * p.carton} ${unitLabel(p.unit, qty * p.carton)}` };
      if (p.box) return { billQty: qty * p.box, note: 'Carton size not set; used box size' };
      return { billQty: qty, note: 'Carton size not set; billed as single units' };
    case 'pkt':
      if (p.unit === 'pc' && p.pkt) return { billQty: qty * p.pkt, note: `${qty} pkt × ${p.pkt} = ${qty * p.pkt} pcs` };
      break;
    case 'pc':
      if (p.unit === 'box' && p.box) {
        const boxes = Math.ceil(qty / p.box);
        return { billQty: boxes, note: `${qty} pcs rounded up to ${boxes} ${unitLabel('box', boxes)}` };
      }
      break;
  }
  if (looseUnits.includes(unit) && looseUnits.includes(p.unit)) return { billQty: qty };
  return { billQty: qty, note: `Ordered in ${unit}, billed per ${p.unit}` };
}
