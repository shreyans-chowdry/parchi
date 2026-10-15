import { money, unitLabel, type Invoice } from '../engine';
import { CURRENT as SELLER } from './seller';

export const cash = (n: number, d = 0) => `${SELLER.currencySymbol}${money(n, d)}`;

export function ago(ts: number, now = Date.now()): string {
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

export function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export function weekday(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}


/** WhatsApp confirmation in the customer's own register. */
const tidy = (s: string) => s.replace(/ +([,،])/g, '$1').replace(/ {2,}/g, ' ');

export function replyText(inv: Invoice, languages: string[], backorder: { sku: string; qty: number }[], deadlineLabel?: string, names: Map<string, { name: string }> = new Map()): string {
  const hindi = languages.includes('Hindi');
  const tamil = !hindi && languages.includes('Tamil');
  const first = inv.party.contact; // walk-in customers have no contact name: greet without one
  const items = inv.lines.map((l) => `• ${l.name} × ${l.qty} ${unitLabel(l.unit, l.qty)}`).join('\n');
  const total = cash(inv.grandTotal, 2);
  const short = backorder.map((b) => `${names.get(b.sku)?.name ?? b.sku}: ${b.qty}`).join(', ');
  const due = shortDate(inv.dueDate);
  if (hindi) {
    return [
      `Namaste ${first} ji 🙏`,
      `Aapka order confirm hai. Bill no. ${inv.number}`,
      items,
      `Total: ${total} (tax sahit)`,
      short ? `Abhi stock kam hai, baad mein bhejenge: ${short}` : '',
      deadlineLabel ? `Delivery: ${deadlineLabel === 'Tomorrow' ? 'kal tak' : deadlineLabel === 'Today' ? 'aaj' : deadlineLabel}` : '',
      inv.party.creditDays ? `Payment ${due} tak.` : '',
      `— ${SELLER.name}`,
    ].filter(Boolean).map(tidy).join('\n');
  }
  if (tamil) {
    return [
      `Vanakkam ${first} 🙏`,
      `Unga order confirm aachu. Bill no. ${inv.number}`,
      items,
      `Total: ${total} (tax serthu)`,
      short ? `Stock kammi, aprom anupuvom: ${short}` : '',
      deadlineLabel ? `Delivery: ${deadlineLabel === 'Tomorrow' ? 'naalaikku' : deadlineLabel === 'Today' ? 'inniki' : deadlineLabel}` : '',
      inv.party.creditDays ? `Payment ${due} kulla.` : '',
      `— ${SELLER.name}`,
    ].filter(Boolean).map(tidy).join('\n');
  }
  const T: Record<string, { hi: string; ok: string; tot: string; short: string; tom: string; today: string; pay: string }> = {
    Spanish: { hi: `Hola ${first},`, ok: `Su pedido está confirmado. Factura n.º ${inv.number}`, tot: `Total: ${total} (impuestos incluidos)`,
      short: 'Sin stock por ahora, enviaremos después:', tom: 'mañana', today: 'hoy', pay: `Pago antes del ${due}.` },
    Portuguese: { hi: `Olá ${first},`, ok: `Seu pedido está confirmado. Nota nº ${inv.number}`, tot: `Total: ${total} (impostos incluídos)`,
      short: 'Sem estoque agora, enviaremos depois:', tom: 'amanhã', today: 'hoje', pay: `Pagamento até ${due}.` },
    French: { hi: `Bonjour ${first},`, ok: `Votre commande est confirmée. Facture n° ${inv.number}`, tot: `Total : ${total} TTC`,
      short: 'En rupture pour l’instant, envoi ultérieur :', tom: 'demain', today: 'aujourd’hui', pay: `Paiement avant le ${due}.` },
    Arabic: { hi: `مرحبا ${first}،`, ok: `تم تأكيد طلبك. فاتورة رقم ${inv.number}`, tot: `الإجمالي: ${total} شامل الضريبة`,
      short: 'غير متوفر حاليا، سنرسله لاحقا:', tom: 'بكرة', today: 'اليوم', pay: `الدفع قبل ${due}.` },
    Indonesian: { hi: `Halo ${first},`, ok: `Pesanan Anda sudah dikonfirmasi. Faktur no. ${inv.number}`, tot: `Total: ${total} (termasuk pajak)`,
      short: 'Stok kurang, akan dikirim nanti:', tom: 'besok', today: 'hari ini', pay: `Pembayaran sebelum ${due}.` },
  };
  const g = ['Spanish', 'Portuguese', 'French', 'Arabic', 'Indonesian'].find((l) => languages.includes(l));
  if (g) {
    const t = T[g];
    return [
      t.hi, t.ok, items, t.tot,
      short ? `${t.short} ${short}` : '',
      deadlineLabel ? `🚚 ${deadlineLabel === 'Tomorrow' ? t.tom : deadlineLabel === 'Today' ? t.today : deadlineLabel}` : '',
      inv.party.creditDays ? t.pay : '',
      `— ${SELLER.name}`,
    ].filter(Boolean).map(tidy).join('\n');
  }
  return [
    `Hello ${first},`,
    `Your order is confirmed. Bill no. ${inv.number}`,
    items,
    `Total: ${total} incl. tax`,
    short ? `Short in stock, will follow: ${short}` : '',
    deadlineLabel ? `Delivery: ${deadlineLabel.toLowerCase()}` : '',
    inv.party.creditDays ? `Payment due by ${due}.` : '',
    `— ${SELLER.name}`,
  ].filter(Boolean).map(tidy).join('\n');
}
