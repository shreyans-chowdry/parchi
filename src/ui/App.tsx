import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { applySeller } from './seller';
import { Welcome } from './Welcome';
import { loadState, reducer, saveState, type View } from './store';
import { type Caps, loadCaps } from './capabilities';
import { Desk } from './Desk';
import { Insights, Orders, Plans, Stock } from './Views';
import { IconBills, IconDesk, IconInsights, IconMoon, IconPlans, IconReset, IconStock, IconSun } from './icons';

const NAV: { view: View; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { view: 'desk', label: 'Desk', Icon: IconDesk },
  { view: 'orders', label: 'Bills', Icon: IconBills },
  { view: 'stock', label: 'Stock', Icon: IconStock },
  { view: 'insights', label: 'Week', Icon: IconInsights },
  { view: 'plans', label: 'Plans', Icon: IconPlans },
];

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [caps, setCaps] = useState<Caps>({ sample: null, images: false, downloads: null });
  const [toastMsg, setToast] = useState<string>();
  const [confirmReset, setConfirmReset] = useState(false);
  const timer = useRef<number>();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => { loadCaps().then(setCaps).catch(() => undefined); }, []);
  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme) root.setAttribute('data-theme', state.theme); else root.removeAttribute('data-theme');
  }, [state.theme]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [state.view]);

  const toast = useCallback((s: string) => {
    setToast(s);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(undefined), 2800);
  }, []);

  applySeller(state.seller);
  const pending = state.messages.filter((m) => m.status === 'new').length;
  const dark = state.theme === 'dark' || (!state.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        <div className="mark" aria-hidden="true">P</div>
        {state.mode && NAV.map(({ view, label, Icon }) => (
          <button key={view} aria-current={state.view === view ? 'page' : undefined} onClick={() => dispatch({ type: 'view', view })}>
            <Icon />{label}
            {view === 'desk' && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
        <span className="spacer" />
        {!state.mode ? null : confirmReset ? (
          <button onClick={() => { dispatch({ type: 'reset' }); setConfirmReset(false); }} onBlur={() => setConfirmReset(false)} title="Click again to start over">
            <IconReset />Sure?
          </button>
        ) : (
          <button onClick={() => setConfirmReset(true)} title="Start over: choose demo or an empty desk"><IconReset />Start over</button>
        )}
      </nav>

      <header className="topbar">
        <div className="wordmark"><b>Parchi</b></div>
        {state.mode && <div className="biz"><strong>{state.seller.name}</strong><small>{state.mode === 'demo' ? 'Demo · sample data' : `${state.products.length} products · ${state.seller.currency}`}</small></div>}
        <span className="grow" />
        <span className={`chip-ai${caps.sample ? ' on' : ''}`} title={caps.sample ? 'Unclear lines and photos can be sent to Claude' : 'Running on the rules engine only'}>
          <i />{caps.sample ? 'Claude assist on' : 'Rules engine'}
        </span>
        <button className="theme-btn" onClick={() => dispatch({ type: 'theme', theme: dark ? 'light' : 'dark' })} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
          {dark ? <IconSun /> : <IconMoon />}
        </button>
      </header>

      <main className="main" ref={mainRef}>
        {!state.mode && <Welcome state={state} dispatch={dispatch} />}
        {state.mode && state.view === 'desk' && <Desk state={state} dispatch={dispatch} caps={caps} toast={toast} />}
        {state.mode && state.view === 'orders' && <Orders state={state} dispatch={dispatch} />}
        {state.mode && state.view === 'stock' && <Stock state={state} dispatch={dispatch} toast={toast} />}
        {state.mode && state.view === 'insights' && <Insights state={state} />}
        {state.mode && state.view === 'plans' && <Plans />}
      </main>

      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
