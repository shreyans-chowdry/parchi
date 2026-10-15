import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type CatalogIndex, availability, chooseSku, parseBatch, resolveBatchPrompt, searchCatalog, setQty, TRANSCRIBE_PROMPT, unitLabel,
  type OrderLine, type Product,
} from '../engine';
import type { Channel } from '../data/inbox';
import parchiUrl from '../../assets/sample-parchi.jpg';
import { type Action, billFor, catalogOf, indexFor, partyOf, type Draft, type Msg, type State } from './store';
import { type Caps, copyText, elementToPdf, sampleMessage } from './capabilities';
import { InvoiceSheet } from './InvoiceSheet';
import { ago, cash, initials, replyText, weekday } from './format';
import {
  IconAlert, IconCheck, IconCopy, IconDownload, IconInfo, IconPhoto, IconPlay, IconStamp, IconText,
  IconTrash, IconVoice, IconWand,
} from './icons';

type D = React.Dispatch<Action>;
const photoSrc = (m: Msg) => (m.photo === 'sample-parchi' ? parchiUrl : m.photo);

export const ChannelIcon = ({ c }: { c: Channel }) =>
  c === 'voice' ? <IconVoice /> : c === 'photo' ? <IconPhoto /> : <IconText />;

function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ------------------------------------------------------------------ Inbox */

const TRIES: { label: string; text: string; party: string }[] = [
  { label: 'English', text: 'pls send 2 doz umbrela, 1 gross ball pen blak, 30 tiffen box', party: 'P04' },
  { label: 'Ambiguous', text: 'Steplar 10, pin 5 pkt, tape 12', party: 'P08' },
  { label: 'Español', text: 'Hola, necesito 3 docenas de cuadernos 200 pages, dos cajas de lápices, cinco destornilladores y una docena de candados 50mm', party: 'P01' },
  { label: 'Português', text: 'Olá, preciso de 2 caixas de pilhas AA, 10 carregadores e 1 caixa de fones de ouvido. Urgente', party: 'P02' },
  { label: 'Français', text: "Bonjour, il me faut 2 cartons d'ampoules LED 12W, 10 multiprises 6 socket et 5 boîtes de piles AAA. Pour demain svp", party: 'P05' },
  { label: 'العربية', text: 'السلام عليكم، عايز ١ كرتونة لمبة ليد 12W، ٥ كشاف، و ٢ علب بطارية AAA. بكرة لو سمحت', party: 'P03' },
  { label: 'Bahasa', text: 'Halo, tolong kirim 2 lusin gunting, 50 buku tulis 200 pages, 6 gembok 40mm dan 1 kotak pensil. Besok ya', party: 'P08' },
  { label: 'हिन्दी', text: 'भाई 1 पेटी LED bulb 12W, 6 torch और 20 extension board 6 socket भेज दो', party: 'P06' },
];

function Composer({ state, dispatch, caps, toast }: { state: State; dispatch: D; caps: Caps; toast: (s: string) => void }) {
  const [text, setText] = useState('');
  const [party, setParty] = useState('P08');
  const [adding, setAdding] = useState(false);
  const [np, setNp] = useState({ name: '', city: '', country: '', exp: false });
  const saveParty = () => {
    if (!np.name.trim()) return;
    const id = `C${Date.now().toString(36)}`;
    dispatch({ type: 'addParty', party: { id, name: np.name.trim(), contact: '', phone: '', area: '', city: np.city.trim(), country: np.country.trim(), export: np.exp, discountPct: 0, creditDays: 15 } });
    setParty(id); setAdding(false); setNp({ name: '', city: '', country: '', exp: false });
    toast(`Added ${np.name.trim()}`);
  };
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = (body: string, channel: Channel = 'text', photo?: string, pid = party) => {
    if (!body.trim()) return;
    dispatch({
      type: 'addMessage',
      msg: { id: `C${Date.now()}`, partyId: pid, channel, sentAt: Date.now(), text: body.trim(), status: 'new', photo, custom: true },
    });
    setText('');
  };

  const onPhoto = async (file?: File) => {
    if (!file || !caps.sample) return;
    setBusy(true);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((res, rej) => { reader.onload = () => res(String(reader.result)); reader.onerror = rej; reader.readAsDataURL(file); });
      const { text: t } = await caps.sample(TRANSCRIBE_PROMPT, { images: file, modelTier: 'default' });
      add(t, 'photo', dataUrl.length < 1_500_000 ? dataUrl : undefined);
      toast('Photo read by Claude and parsed');
    } catch (e) {
      toast(sampleMessage((e as { code?: string })?.code));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <form className="panel composer" onSubmit={(e) => { e.preventDefault(); add(text); }}>
      <label htmlFor="new-order" className="sr">Paste an order</label>
      <textarea
        id="new-order" dir="auto" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Paste a WhatsApp order, any language… e.g. 2 box stapler 24/6, 5 dozen gift wrap red"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(text); }}
      />
      <div className="row">
        <label htmlFor="new-party" className="sr">Customer</label>
        <select id="new-party" value={party} onChange={(e) => { if (e.target.value === '__add') setAdding(true); else setParty(e.target.value); }}>
          {state.parties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.city ? `, ${p.city}` : ''}</option>)}
          <option value="__add">+ Add a customer…</option>
        </select>
        <button type="submit" className="btn primary" disabled={!text.trim()}>Read order</button>
      </div>
      {adding && (
        <div className="mini-form">
          <label htmlFor="np-name" className="sr">Customer name</label>
          <input id="np-name" autoFocus placeholder="Customer name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          <div className="row">
            <label htmlFor="np-city" className="sr">City</label>
            <input id="np-city" placeholder="City" value={np.city} onChange={(e) => setNp({ ...np, city: e.target.value })} />
            <label htmlFor="np-country" className="sr">Country</label>
            <input id="np-country" placeholder="Country" value={np.country} onChange={(e) => setNp({ ...np, country: e.target.value })} />
          </div>
          <label className="check"><input id="np-export" type="checkbox" checked={np.exp} onChange={(e) => setNp({ ...np, exp: e.target.checked })} /> Export customer (zero-rated)</label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn small primary" disabled={!np.name.trim()} onClick={saveParty}>Add customer</button>
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="tries" aria-label="Try an example" dir="auto">
          {state.mode === 'demo' && TRIES.map((t) => (
            <button type="button" key={t.label} onClick={() => { setText(t.text); setParty(t.party); }}>{t.label}</button>
          ))}
        </div>
        {caps.images && (
          <>
            <input ref={fileRef} id="photo-in" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
            <button type="button" className="btn small carbon" disabled={busy} onClick={() => fileRef.current?.click()}>
              <IconPhoto />{busy ? 'Reading photo…' : 'Add photo'}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function Inbox({ state, dispatch }: { state: State; dispatch: D }) {
  const pending = state.messages.filter((m) => m.status !== 'billed').length;
  return (
    <>
      <div className="pane-title"><h2>Orders in</h2><small>{pending} waiting</small></div>
      <div className="panel inbox" role="listbox" aria-label="Incoming orders">
        {state.messages.map((m) => {
          const p = partyOf(state, m.partyId);
          return (
            <button
              key={m.id} className="msg" role="option" aria-selected={state.selected === m.id}
              onClick={() => {
                dispatch({ type: 'select', id: m.id });
                if (window.innerWidth < 900) setTimeout(() => document.getElementById('workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
              }}
            >
              <span className="avatar">{initials(p.name)}<span className="ch"><ChannelIcon c={m.channel} /></span></span>
              <span style={{ minWidth: 0 }}>
                <span className="who">{p.name}</span>
                <span className="where">{[p.area, p.city].filter(Boolean).join(', ')}</span>
                <span className="preview">{m.channel === 'voice' ? `Voice note · ${m.durationSec ?? 0}s · ` : m.channel === 'photo' ? 'Photo · ' : ''}{m.text}</span>
              </span>
              <span className="meta">
                {ago(m.sentAt)}
                <span className={`st ${m.status === 'billed' ? 'billed' : m.status === 'new' ? 'new' : 'read'}`}>
                  {m.status === 'billed' ? 'Billed' : m.status === 'new' ? 'New' : 'Read'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Slip */

interface Seg { start: number; end: number; cls: string; line?: string; i: number }

function Slip({ msg, draft, hot, setHot }: { msg: Msg; draft: Draft; hot?: string; setHot: (id?: string) => void }) {
  const segs = useMemo(() => {
    const marks: Seg[] = [];
    draft.lines.forEach((l) => l.highlights.forEach((h) => marks.push({ start: h.span.start, end: h.span.end, cls: h.role, line: l.id, i: 0 })));
    if (draft.deadline?.span) marks.push({ start: draft.deadline.span.start, end: draft.deadline.span.end, cls: 'when', i: 0 });
    marks.sort((a, b) => a.start - b.start);
    const out: Seg[] = [];
    let pos = 0;
    let n = 0;
    for (const m of marks) {
      if (m.start < pos) continue;
      if (m.start > pos) out.push({ start: pos, end: m.start, cls: 'dim', i: 0 });
      out.push({ ...m, i: n++ });
      pos = m.end;
    }
    if (pos < msg.text.length) out.push({ start: pos, end: msg.text.length, cls: 'dim', i: 0 });
    return out;
  }, [draft, msg.text]);

  const fresh = Date.now() - draft.parsedAt < 2500;
  return (
    <div dir="auto" className={`slip${fresh ? ' reading' : ''}`} key={draft.parsedAt} onMouseLeave={() => setHot(undefined)}>
      {segs.map((s, k) => (
        <span
          key={k}
          className={`seg ${s.cls}${s.line && s.line === hot ? ' hot' : ''}`}
          style={{ ['--i' as string]: s.i } as React.CSSProperties}
          onMouseEnter={() => s.line && setHot(s.line)}
        >
          {msg.text.slice(s.start, s.end)}
        </span>
      ))}
      <span className="legend" aria-hidden="true"><span><b>12</b> quantity</span><span style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>item</span><span style={{ textDecoration: 'underline wavy', textDecorationColor: 'var(--haldi)', textUnderlineOffset: 3 }}>size / colour</span></span>
    </div>
  );
}

function Wave({ seed }: { seed: number }) {
  const bars = useMemo(() => {
    let x = seed * 9301 + 49297;
    return Array.from({ length: 64 }, (_, i) => {
      x = (x * 9301 + 49297) % 233280;
      const r = x / 233280;
      return 6 + Math.round((Math.sin(i / 3.3) * 0.5 + 0.5) * 14 + r * 8);
    });
  }, [seed]);
  return <span className="wave">{bars.map((h, i) => <span key={i} style={{ height: h }} />)}</span>;
}

/* ------------------------------------------------------------------ Lines */

function Conf({ line }: { line: OrderLine }) {
  const on = Math.max(1, Math.round(line.confidence * 5));
  return (
    <span className={`conf ${line.status}`} title={`Confidence ${Math.round(line.confidence * 100)}%`} aria-label={`Confidence ${Math.round(line.confidence * 100)} percent`}>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < on ? 'on' : ''} />)}
    </span>
  );
}

function Picker({ line, catalog, index, anchor, onPick, onClose }: { line: OrderLine; catalog: Map<string, Product>; index: CatalogIndex; anchor: HTMLElement | null; onPick: (sku: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: 0 });
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const w = Math.min(360, window.innerWidth - 32);
      const h = ref.current?.offsetHeight ?? 360;
      const below = r.bottom + 6 + h < window.innerHeight;
      setPos({ top: below ? r.bottom + 6 : Math.max(12, r.top - h - 6), left: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, q]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor && anchor.contains(e.target as Node))) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const items = q.trim()
    ? searchCatalog(index, q, 8).map((p) => ({ p, score: undefined as number | undefined, why: '' }))
    : line.candidates.map((c) => ({ p: catalog.get(c.sku)!, score: Math.min(1, c.score), why: c.reasons.join(' · ') }));
  return createPortal(
    <div className="popover" ref={ref} role="dialog" aria-label={`Choose item for “${line.itemText}”`} style={{ position: 'fixed', top: pos.top, left: pos.left }}>
      <label className="sr" htmlFor={`pick-${line.id}`}>Search catalog</label>
      <input id={`pick-${line.id}`} autoFocus placeholder="Search in any language: grapadora, دباسة, stapler…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q && <div className="hint">Closest matches for “{line.itemText}”</div>}
      <ul>
        {items.map(({ p, score, why }) => (
          <li key={p.sku}>
            <button className={p.sku === line.sku ? 'cur' : ''} onClick={() => onPick(p.sku)}>
              <span className="nm">{p.name}</span>
              <span className="sm">{p.sku} · {cash(p.rate, 2)}/{p.unit} · {p.stock} in stock{why ? ` · ${why}` : ''}</span>
              {score !== undefined && <span className="score"><span className="bar"><b style={{ width: `${Math.round(score * 100)}%` }} /></span>{Math.round(score * 100)}</span>}
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="hint">Nothing in the catalog matches “{q}”.</li>}
      </ul>
    </div>,
    document.body,
  );
}

function LinesTable({ msg, draft, state, dispatch, hot, setHot, caps, toast }: {
  msg: Msg; draft: Draft; state: State; dispatch: D; hot?: string; setHot: (id?: string) => void; caps: Caps; toast: (s: string) => void;
}) {
  const [open, setOpen] = useState<string>();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [asking, setAsking] = useState(false);
  const catalog = useMemo(() => catalogOf(state), [state.products, state.stock]);
  const avail = useMemo(() => availability(draft.lines, catalog), [draft.lines, catalog]);
  const doubtful = draft.lines.filter((l) => l.status !== 'matched');
  const party = partyOf(state, msg.partyId);

  const askClaude = async () => {
    if (!caps.sample || !doubtful.length) return;
    setAsking(true);
    try {
      const value = await caps.sample.json(resolveBatchPrompt(doubtful, catalog, party), { modelTier: 'default' });
      const answers = parseBatch(value, doubtful);
      let n = 0;
      for (const a of answers) {
        const line = draft.lines.find((l) => l.id === a.line)!;
        if (a.sku) { dispatch({ type: 'updateLine', id: msg.id, line: { ...chooseSku(line, a.sku, catalog, 'ai'), why: a.reason, confidence: Math.max(0.5, a.confidence) } }); n++; }
      }
      dispatch({ type: 'aiAsked', id: msg.id });
      toast(n ? `Claude resolved ${n} of ${doubtful.length} line${doubtful.length > 1 ? 's' : ''}` : 'Claude found no confident match; pick the items by hand');
    } catch (e) {
      toast(sampleMessage((e as { code?: string })?.code));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="panel lines">
      <div className="lines-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: '24%' }}>Customer wrote</th>
              <th>Matched item</th>
              <th className="r">Bill qty</th>
              <th className="r">Amount</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((l) => {
              const p = l.sku ? catalog.get(l.sku) : undefined;
              const a = l.sku ? avail.get(l.sku) : undefined;
              const short = a && a.short > 0;
              const amount = p ? l.billQty * p.rate * (1 - (party?.discountPct ?? 0) / 100) : 0;
              return (
                <tr key={l.id} className={`${l.status}${hot === l.id ? ' hot' : ''}`} onMouseEnter={() => setHot(l.id)} onMouseLeave={() => setHot(undefined)}>
                  <td>
                    <div className="asked" dir="auto">{l.raw}
                      <small>{l.qtyAssumed ? 'qty not given, assumed 1' : `${l.qty} ${l.unit ? unitLabel(l.unit, l.qty) : ''}`}</small>
                    </div>
                  </td>
                  <td style={{ position: 'relative', minWidth: 210 }}>
                    <button className={`pick${p ? '' : ' none'}`} onClick={(e) => { setAnchor(e.currentTarget); setOpen(open === l.id ? undefined : l.id); }} aria-haspopup="dialog" aria-expanded={open === l.id}>
                      <span className="nm"><Conf line={l} />{p ? p.name : 'Not found, choose an item'}</span>
                      {p && <span className="sku">{p.sku}{p.hs ? ` · HS ${p.hs}` : ''} · tax {p.tax}%</span>}
                      {l.status === 'review' && <span className="why" style={{ color: 'var(--haldi)' }}>Check: {l.candidates[1] ? `could also be ${catalog.get(l.candidates[1].sku)?.name}` : 'low confidence'}</span>}
                      {l.resolvedBy === 'ai' && l.why && <span className="why">Claude: {l.why}</span>}
                    </button>
                    <span className={`by${l.resolvedBy === 'ai' ? ' ai' : ''}`}>
                      {l.resolvedBy === 'history' ? 'Settled by this customer’s past orders' : l.resolvedBy === 'ai' ? 'Resolved by Claude' : l.resolvedBy === 'trader' ? 'Chosen by you' : l.status === 'matched' ? 'Read by rules' : ''}
                    </span>
                    {open === l.id && (
                      <Picker line={l} catalog={catalog} index={indexFor(state.products)} anchor={anchor} onClose={() => setOpen(undefined)}
                        onPick={(sku) => { dispatch({ type: 'updateLine', id: msg.id, line: chooseSku(l, sku, catalog, 'trader') }); setOpen(undefined); }} />
                    )}
                  </td>
                  <td className="r">
                    <label className="sr" htmlFor={`q-${l.id}`}>Bill quantity</label>
                    <input id={`q-${l.id}`} className="qty-in" type="number" min={0} step="any" value={l.billQty}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        dispatch({ type: 'updateLine', id: msg.id, line: { ...l, billQty: v, unitNote: undefined } });
                      }} />
                    <span className="note">{p ? unitLabel(p.unit, l.billQty) : ''}{l.unitNote ? ` · ${l.unitNote}` : ''}</span>
                    {p && <span className={`note stock-cell${short ? ' short' : ''}`}>{short ? `Only ${p.stock} in stock` : `${p.stock} in stock`}</span>}
                  </td>
                  <td className="r num">{p ? cash(amount, 2) : '—'}</td>
                  <td className="r">
                    <button className="btn ghost small" title="Remove line" aria-label={`Remove ${l.itemText}`} onClick={() => dispatch({ type: 'removeLine', id: msg.id, lineId: l.id })}><IconTrash /></button>
                  </td>
                </tr>
              );
            })}
            {draft.lines.length === 0 && (
              <tr><td colSpan={5}><div className="empty"><h3>No items found in this message</h3><p>Edit the message or paste the order again with quantities, e.g. “10 box stapler”.</p></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {draft.lines.length > 0 && (
        <div className="lines-foot">
          {doubtful.length > 0 ? (
            <small style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--haldi)' }}><IconAlert className="ico-sm" /> {doubtful.length} line{doubtful.length > 1 ? 's' : ''} to check</small>
          ) : (
            <small style={{ color: 'var(--leaf)' }}>All lines matched</small>
          )}
          <span className="grow" />
          {draft.lines.some((l) => l.status === 'review') && (
            <button className="btn small" onClick={() => dispatch({ type: 'acceptAll', id: msg.id })}><IconCheck />Accept suggestions</button>
          )}
          {caps.sample && doubtful.length > 0 && (
            <button className="btn small carbon" onClick={askClaude} disabled={asking}><IconWand />{asking ? 'Asking Claude…' : `Ask Claude about ${doubtful.length}`}</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Workbench */

function Workbench({ state, dispatch, caps, toast, hot, setHot }: { state: State; dispatch: D; caps: Caps; toast: (s: string) => void; hot?: string; setHot: (id?: string) => void }) {
  const msg = state.messages.find((m) => m.id === state.selected);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  useEffect(() => { setEditing(false); }, [state.selected]);
  if (!msg) {
    return (
      <div className="pane" id="workbench">
        <div className="panel empty start">
          {state.products.length === 0 ? (
            <>
              <h3>Add your products first</h3>
              <p>Parchi matches every order line to your catalog. Add a few products with the names your customers use, then paste an order.</p>
              <button className="btn primary" onClick={() => dispatch({ type: 'view', view: 'stock' })}>Add products</button>
            </>
          ) : (
            <>
              <h3>Paste your first order</h3>
              <p>Copy a WhatsApp message from a customer, in any language, into the box on the left and choose Read order. It's read on the spot, matched to your {state.products.length} product{state.products.length === 1 ? '' : 's'} and turned into an invoice.</p>
            </>
          )}
        </div>
      </div>
    );
  }
  const party = partyOf(state, msg.partyId);
  const draft = state.drafts[msg.id];

  const rereadPhoto = async () => {
    if (!caps.sample || !msg.photo) return;
    setReading(true);
    try {
      const src = photoSrc(msg)!;
      const { text: t } = await caps.sample(TRANSCRIBE_PROMPT, { images: dataUrlToBlob(src), modelTier: 'default' });
      if (t.trim()) dispatch({ type: 'setText', id: msg.id, text: t.trim() });
      toast('Claude re-read the photo');
    } catch (e) {
      toast(sampleMessage((e as { code?: string })?.code));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="pane" id="workbench">
      <div className="work-head">
        <span className="avatar" style={{ width: 44, height: 44 }}>{initials(party.name)}<span className="ch"><ChannelIcon c={msg.channel} /></span></span>
        <div style={{ minWidth: 0 }}>
          <h1>{party.name}</h1>
          <div className="sub">{[party.area, party.city].filter(Boolean).join(', ')} · {msg.channel === 'voice' ? 'voice note' : msg.channel === 'photo' ? 'photo of slip' : 'WhatsApp text'} · {ago(msg.sentAt)}{ago(msg.sentAt) === 'now' ? '' : ' ago'}</div>
        </div>
        <span className="grow" />
        {msg.status !== 'billed' && !editing && (
          <button className="btn small ghost" onClick={() => { setText(msg.text); setEditing(true); }}>Edit message</button>
        )}
      </div>

      <div className={`slip-wrap${msg.photo ? ' with-media' : ''}`}>
        {msg.photo && (
          <figure className="media" style={{ margin: 0 }}>
            <img src={photoSrc(msg)} alt={`Photo of a handwritten order slip from ${party.name}`} />
            <figcaption>
              {caps.images ? (
                <button className="btn small carbon" style={{ width: '100%', justifyContent: 'center' }} onClick={rereadPhoto} disabled={reading}>
                  <IconWand />{reading ? 'Reading…' : 'Read photo with Claude'}
                </button>
              ) : 'Transcribed slip'}
            </figcaption>
          </figure>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, minWidth: 0 }}>
          {msg.channel === 'voice' && (
            <div className="voice">
              <span className="play"><IconPlay /></span>
              <Wave seed={msg.id.length + (msg.durationSec ?? 7)} />
              <small className="num">0:{String(msg.durationSec ?? 0).padStart(2, '0')}</small>
            </div>
          )}
          {editing ? (
            <form className="panel composer" onSubmit={(e) => { e.preventDefault(); dispatch({ type: 'setText', id: msg.id, text }); setEditing(false); }}>
              <label className="sr" htmlFor="edit-msg">Edit message</label>
              <textarea id="edit-msg" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
                <button type="submit" className="btn primary">Read again</button>
              </div>
            </form>
          ) : draft ? (
            <Slip msg={msg} draft={draft} hot={hot} setHot={setHot} />
          ) : (
            <div className="slip">{msg.text}</div>
          )}
        </div>
      </div>

      {draft && msg.status !== 'billed' && (
        <>
          <div className="strip" aria-live="polite">
            <span>Read in <strong className="num">{draft.stats.ms} ms</strong></span>
            <span className="sep" />
            <span><strong>{draft.lines.length}</strong> lines · <strong>{draft.lines.filter((l) => l.status === 'matched').length}</strong> ready · <strong>{draft.lines.filter((l) => l.status !== 'matched').length}</strong> to check</span>
            <span className="sep" />
            <span>{draft.languages.join(' + ')}</span>
            {draft.deadline && (<><span className="sep" /><span className="when">{draft.deadline.urgent ? 'Urgent' : 'Wanted'}{draft.deadline.date ? ` by ${weekday(draft.deadline.date)}` : ''}</span></>)}
            {draft.repeatHint && (<><span className="sep" /><span>Repeat order: past purchases used</span></>)}
          </div>
          <LinesTable msg={msg} draft={draft} state={state} dispatch={dispatch} hot={hot} setHot={setHot} caps={caps} toast={toast} />
        </>
      )}
      {msg.status === 'billed' && (() => {
        const bill = state.bills.find((b) => b.invoice.number === msg.invoiceNo);
        const next = state.messages.find((m) => m.status !== 'billed' && m.id !== msg.id);
        const nextParty = next ? partyOf(state, next.partyId) : undefined;
        return (
          <>
            <div className="callout ok"><IconCheck /><span>Billed as {msg.invoiceNo}. Stock has been updated.</span></div>
            {bill && (
              <div className="panel recap">
                <div className="recap-stats">
                  <div><b className="num">{bill.invoice.lines.length}</b><span>lines billed</span></div>
                  <div><b className="num">{bill.auto}</b><span>read by rules</span></div>
                  <div><b className="num">{bill.ai}</b><span>resolved by Claude</span></div>
                  <div><b className="num">{bill.checked}</b><span>chosen by you</span></div>
                </div>
                <ul className="recap-lines">
                  {bill.invoice.lines.map((l) => (
                    <li key={l.sku}><span>{l.name}</span><span className="num">{l.qty} {unitLabel(l.unit, l.qty)}</span><span className="num">{cash(l.total, 2)}</span></li>
                  ))}
                  {bill.backorder.map((b) => (
                    <li key={'bo' + b.sku} className="bo"><span>Backorder: {state.drafts[msg.id]?.lines.find((l) => l.sku === b.sku)?.itemText ?? b.sku}</span><span className="num">{b.qty}</span><span>on the reorder list</span></li>
                  ))}
                </ul>
                {next && nextParty && (
                  <button className="btn primary" onClick={() => dispatch({ type: 'select', id: next.id })}>
                    Next order: {nextParty.name}
                  </button>
                )}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------ Bill pane */

function BillPane({ state, dispatch, caps, toast }: { state: State; dispatch: D; caps: Caps; toast: (s: string) => void }) {
  const msg = state.messages.find((m) => m.id === state.selected);
  const sheet = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const draft = msg ? state.drafts[msg.id] : undefined;
  const saved = msg?.invoiceNo ? state.bills.find((b) => b.invoice.number === msg.invoiceNo) : undefined;
  const live = useMemo(() => (msg && draft && !saved ? billFor(state, msg.id) : null), [state, msg, draft, saved]);
  if (!msg) return null;

  const invoice = saved?.invoice ?? live?.invoice;
  const backorder = saved?.backorder ?? live?.backorder ?? [];
  const catalog = catalogOf(state);
  const shortages = draft && !saved ? [...availability(draft.lines, catalog).values()].filter((a) => a.short > 0) : [];
  const blocking = draft ? draft.lines.filter((l) => l.status !== 'matched').length : 0;
  const reply = invoice ? replyText(invoice, saved?.languages ?? draft?.languages ?? [], backorder, draft?.deadline?.label, catalog) : '';

  const download = async () => {
    if (!caps.downloads || !sheet.current || !invoice) return;
    setSaving(true);
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    try {
      const blob = await elementToPdf(sheet.current);
      await caps.downloads.save({ filename: `${invoice.number.replace(/\//g, '-')}.pdf`, data: blob });
      toast('Invoice PDF saved');
    } catch (e) {
      const code = (e as { code?: string })?.code;
      toast(code === 'declined' ? 'Download cancelled' : 'Could not make the PDF here. Copy the WhatsApp message instead.');
    } finally {
      if (prev) root.setAttribute('data-theme', prev); else root.removeAttribute('data-theme');
      setSaving(false);
    }
  };

  return (
    <div className="pane billpane">
      <div className="pane-title"><h2>{saved ? 'Bill' : 'Bill preview'}</h2><small>{saved ? 'Duplicate copy' : 'Updates as you check lines'}</small></div>

      {!saved && shortages.length > 0 && (
        <div className="callout warn">
          <IconAlert />
          <div style={{ display: 'grid', gap: 6 }}>
            <span>{shortages.map((s) => `${catalog.get(s.sku)?.name}: ${s.have} in stock, ${s.need} asked`).join('; ')}.</span>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id="ship-available" type="checkbox" checked={draft!.shipAvailable} onChange={(e) => dispatch({ type: 'shipAvailable', id: msg.id, value: e.target.checked })} />
              Bill what is in stock, keep the rest as backorder
            </label>
          </div>
        </div>
      )}

      {invoice && <InvoiceSheet invoice={invoice} stamped={!!saved} preview={!saved} sheetRef={sheet} />}

      <div className="bill-actions">
        {!saved && draft && (
          <button className="btn primary block" disabled={blocking > 0 || !invoice?.lines.length} onClick={() => { dispatch({ type: 'confirm', id: msg.id }); toast(`Billed ${invoice?.number}`); }}>
            <IconStamp />{blocking > 0 ? `Check ${blocking} line${blocking > 1 ? 's' : ''} to confirm` : `Confirm and bill ${invoice ? cash(invoice.grandTotal, 2) : ''}`}
          </button>
        )}
        {saved && (
          <>
            <div className="row">
              {caps.downloads && <button className="btn" onClick={download} disabled={saving}><IconDownload />{saving ? 'Making PDF…' : 'Download PDF'}</button>}
              <button className="btn" onClick={async () => { const ok = await copyText(reply); toast(ok ? 'WhatsApp reply copied' : 'Select the text below to copy it'); }}><IconCopy />Copy WhatsApp reply</button>
            </div>
            <div className="reply" dir="auto" aria-label="WhatsApp reply">{reply}</div>
            {saved.backorder.length > 0 && (
              <div className="callout info"><IconInfo /><span>Backorder: {saved.backorder.map((b) => `${catalog.get(b.sku)?.name} × ${b.qty}`).join(', ')}. Added to the next supplier reorder list.</span></div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Desk(props: { state: State; dispatch: D; caps: Caps; toast: (s: string) => void }) {
  const [hot, setHot] = useState<string>();
  return (
    <div className="desk">
      <div className="pane">
        <Composer state={props.state} dispatch={props.dispatch} caps={props.caps} toast={props.toast} />
        <Inbox state={props.state} dispatch={props.dispatch} />
      </div>
      <Workbench {...props} hot={hot} setHot={setHot} />
      <BillPane {...props} />
    </div>
  );
}

