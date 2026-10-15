// Sample seller and customers. All fictional: names, places and tax IDs exist only
// to make the demo realistic.

import type { Party } from '../engine/types';
import type { Seller } from '../engine/invoice';

export const SELLER: Seller = {
  name: 'Meridian Trading Co.',
  tagline: 'Wholesale distributor',
  taxId: 'MT-4417-2290',
  currency: 'USD',
  currencySymbol: '$',
};

export const PARTIES: Party[] = [
  { id: 'P01', name: 'Papelería Hernández', contact: 'Lucía', phone: '+52 55 0000 1201', area: 'Coyoacán', city: 'Mexico City', country: 'Mexico', taxId: 'HEPL-880412', export: false, discountPct: 2, creditDays: 15 },
  { id: 'P02', name: 'Bebê & Cia', contact: 'Ana', phone: '+55 11 0000 2302', area: 'Pinheiros', city: 'São Paulo', country: 'Brazil', taxId: 'BC-2291-77', export: false, discountPct: 0, creditDays: 7 },
  { id: 'P03', name: 'Al Amal Electricals', contact: 'Omar', phone: '+20 2 0000 3403', area: 'Ataba', city: 'Cairo', country: 'Egypt', export: true, discountPct: 3, creditDays: 30 },
  { id: 'P04', name: 'Kariuki Books & Stationery', contact: 'Grace', phone: '+254 20 000 4504', area: 'Moi Avenue', city: 'Nairobi', country: 'Kenya', taxId: 'KBS-50331', export: false, discountPct: 0, creditDays: 15 },
  { id: 'P05', name: 'Maison du Cadeau', contact: 'Claire', phone: '+1 514 000 5605', area: 'Plateau', city: 'Montréal', country: 'Canada', export: true, discountPct: 2, creditDays: 21 },
  { id: 'P06', name: 'Al Noor Hardware', contact: 'Ravi', phone: '+971 4 000 6706', area: 'Deira', city: 'Dubai', country: 'UAE', taxId: 'ANH-71180', export: false, discountPct: 3, creditDays: 30 },
  { id: 'P07', name: 'Okafor Stationers', contact: 'Chidi', phone: '+234 1 000 7807', area: 'Balogun Market', city: 'Lagos', country: 'Nigeria', export: true, discountPct: 1, creditDays: 15 },
  { id: 'P08', name: 'New walk-in customer', contact: '', phone: '', area: '', city: '', country: '', export: false, discountPct: 0, creditDays: 0 },
];

export const PARTY_MAP = new Map(PARTIES.map((p) => [p.id, p]));

/** SKUs each customer bought before, most recent first. */
export const HISTORY: Record<string, string[]> = {
  P01: ['STA-102', 'GFT-201', 'STA-104', 'STA-115'],
  P02: ['BAB-301', 'BAB-304', 'BAB-303'],
  P03: ['ELE-501', 'ELE-503', 'ELE-505'],
  P04: ['STA-105', 'STA-108', 'STA-113'],
  P05: ['GFT-204', 'GFT-202', 'GFT-206', 'GFT-207'],
  P06: ['HRD-401', 'HRD-403', 'HRD-406', 'HRD-402'],
  P07: ['STA-101', 'STA-114', 'STA-107'],
};
