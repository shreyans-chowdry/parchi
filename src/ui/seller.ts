// The business the app is billing for. Kept in a module-level object so formatting
// helpers deep in the tree don't need it passed through every component.
import type { Seller } from '../engine';
import { SELLER } from '../data/parties';

export const CURRENT: Seller = { ...SELLER };

export function applySeller(s: Seller) {
  Object.assign(CURRENT, s);
}

export const CURRENCIES: { code: string; symbol: string; label: string }[] = [
  { code: 'USD', symbol: '$', label: 'US dollar ($)' },
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'GBP', symbol: '£', label: 'Pound sterling (£)' },
  { code: 'AED', symbol: 'AED ', label: 'UAE dirham (AED)' },
  { code: 'MXN', symbol: 'MX$', label: 'Mexican peso (MX$)' },
  { code: 'BRL', symbol: 'R$', label: 'Brazilian real (R$)' },
  { code: 'CAD', symbol: 'CA$', label: 'Canadian dollar (CA$)' },
  { code: 'AUD', symbol: 'A$', label: 'Australian dollar (A$)' },
  { code: 'NGN', symbol: '₦', label: 'Nigerian naira (₦)' },
  { code: 'KES', symbol: 'KSh ', label: 'Kenyan shilling (KSh)' },
  { code: 'EGP', symbol: 'E£', label: 'Egyptian pound (E£)' },
  { code: 'IDR', symbol: 'Rp ', label: 'Indonesian rupiah (Rp)' },
];
