import React, { useState } from 'react';
import { type Action, demoState, freshState, type State } from './store';
import { CURRENCIES } from './seller';

export function Welcome({ state, dispatch }: { state: State; dispatch: React.Dispatch<Action> }) {
  const [name, setName] = useState('');
  const [cur, setCur] = useState('USD');
  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const c = CURRENCIES.find((x) => x.code === cur) ?? CURRENCIES[0];
    dispatch({ type: 'start', state: freshState(name, c.code, c.symbol, state.theme) });
  };
  return (
    <div className="welcome">
      <div className="welcome-in">
        <div className="welcome-head">
          <div className="welcome-mark" aria-hidden="true">P</div>
          <h1>Parchi</h1>
          <p className="welcome-tag">Chat orders in. Invoices out.</p>
          <p className="welcome-lead">
            Paste an order the way your customer wrote it, in any of 7 languages. Parchi matches every line to your products,
            checks stock and hands back an invoice and a reply.
          </p>
        </div>

        <div className="choices">
          <section className="panel choice demo" aria-labelledby="c-demo">
            <div className="slip-mini" dir="auto" aria-hidden="true">
              <span className="dim">Hola, necesito </span><b>2</b> <i>cajas</i> <u>grapadoras</u> <em>24/6</em>, <b>5</b> <i>docenas</i> <u>papel de regalo</u> <em>rojo</em>…
            </div>
            <h2 id="c-demo">Explore the demo</h2>
            <p>A fictional distributor with 64 products, 7 customers in 7 countries, orders waiting in 5 languages and a week of invoices.</p>
            <button className="btn primary block" onClick={() => dispatch({ type: 'start', state: demoState(state.theme) })}>Open the demo</button>
          </section>

          <section className="panel choice" aria-labelledby="c-fresh">
            <h2 id="c-fresh">Start fresh</h2>
            <p>An empty desk for your own business. Add your products, then paste your first customer order.</p>
            <form className="form" onSubmit={start}>
              <label htmlFor="w-name">Business name<input id="w-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind Wholesale" /></label>
              <label htmlFor="w-cur">Currency
                <select id="w-cur" value={cur} onChange={(e) => setCur(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </label>
              <button className="btn block">Start with an empty desk</button>
            </form>
          </section>
        </div>
        <p className="welcome-foot">Your data is saved in this browser. You can switch with Start over at any time.</p>
      </div>
    </div>
  );
}
