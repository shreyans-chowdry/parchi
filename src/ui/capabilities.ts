// Thin wrappers around the claude.ai artifact runtime. Every feature here is
// optional: when a capability is absent the app keeps working on the rules engine.

type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: <T>(input: string, opts?: Record<string, unknown>) => Promise<T>;
  limits: () => Promise<{ images?: { maxCount: number; mediaTypes: string[] } }>;
};
type DownloadsNs = { save: (r: { filename: string; data: Blob | string }) => Promise<{ status: string }> };

declare global {
  interface Window {
    claude?: { use: (name: string) => Promise<unknown> };
    html2canvas?: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
    jspdf?: { jsPDF: new (o: Record<string, unknown>) => any };
  }
}

export interface Caps { sample: SampleFn | null; images: boolean; downloads: DownloadsNs | null }

export async function loadCaps(): Promise<Caps> {
  const use = window.claude?.use;
  if (!use) return { sample: null, images: false, downloads: null };
  const [sample, downloads] = await Promise.all([
    use.call(window.claude, 'sample').catch(() => null) as Promise<SampleFn | null>,
    use.call(window.claude, 'downloads').catch(() => null) as Promise<DownloadsNs | null>,
  ]);
  let images = false;
  if (sample) {
    const lim = await sample.limits().catch(() => null);
    images = !!lim?.images;
  }
  return { sample, images, downloads };
}

export function sampleMessage(code: string | undefined): string {
  switch (code) {
    case 'not_granted': return 'Claude assist was not allowed for this page. The rules engine still works.';
    case 'rate_limited': return 'Too many requests to Claude just now. Wait a minute and try again.';
    case 'images_unavailable': return 'Photo reading is not available in this view.';
    case 'image_rejected': return 'That photo could not be read. Use a JPEG or PNG under 20 MB.';
    case 'invalid_json': return 'Claude replied in an unexpected format. Try again.';
    case 'cancelled': return 'Stopped.';
    default: return 'Claude could not answer right now. Try again in a moment.';
  }
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { loaded.delete(src); reject(new Error('load failed')); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src)!;
}

/** Render an element to an A4 PDF blob (scripts load on first use). */
export async function elementToPdf(el: HTMLElement): Promise<Blob> {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const bg = getComputedStyle(document.body).backgroundColor;
  const canvas = await window.html2canvas!(el, { scale: 2, backgroundColor: bg, useCORS: true });
  const { jsPDF } = window.jspdf!;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const w = pageW - margin * 2;
  const h = (canvas.height / canvas.width) * w;
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, w, Math.min(h, pageH - margin * 2));
  return pdf.output('blob');
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
