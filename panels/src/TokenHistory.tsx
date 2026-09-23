import { useState } from 'react';
import { fmtDay, fmtTokens, orderedRooms, roomFill, roomOf, stripedRooms, tokenDays, tokenSummary } from './logic';
import { PanelHeader, PanelPending } from './PanelHeader';
import type { Room, TokenUsageRow } from './types';
import type { TableState } from './useTable';

const W = 600, H = 150, TOP = 14, BASE = H - 18;

export function TokenHistory({ state, rooms, days }: { state: TableState<TokenUsageRow>; rooms: Room[]; days: string[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const striped = stripedRooms(rooms);
  const header = <PanelHeader title="CONSUMO TOKEN" sub={`ultimi ${days.length} giorni · input + output`} error={state.error} />;

  if (state.data === null) {
    return <PanelPending cls="dp c12" header={header} error={state.error} />;
  }

  const bars = tokenDays(state.data, days);
  const sum = tokenSummary(state.data);
  const max = Math.max(1, ...bars.map((b) => b.total));
  const slot = W / days.length;
  const barW = slot * 0.7;
  const y = (v: number) => BASE - (v / max) * (BASE - TOP);
  const shown = bars[sel ?? bars.length - 1];
  const fill = (r: Room) => (striped.has(r.id) ? `url(#tk-stripe-${r.id})` : r.col);
  const ticks = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];

  return (
    <div className="dp c12">
      {header}
      <div className="stats">
        <div>totale<b>{fmtTokens(sum.total)}</b></div>
        <div>reparto top<b>{sum.topRoom ? roomOf(rooms, sum.topRoom).n : '—'}</b></div>
        <div>resa cache<b>{sum.cacheYield === null ? '—' : `${Math.round(sum.cacheYield * 100)}%`}</b></div>
      </div>
      <svg className="tk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Consumo token per giorno, ultimi ${days.length} giorni`}>
        <defs>
          {rooms.filter((r) => striped.has(r.id)).map((r) => (
            <pattern key={r.id} id={`tk-stripe-${r.id}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" fill={r.col} />
              <rect width="2" height="4" fill="rgba(0,0,0,.4)" />
            </pattern>
          ))}
        </defs>
        <text className="tk-lbl" x="0" y="10">{fmtTokens(max)}</text>
        <line className="tk-axis" x1="0" x2={W} y1={BASE} y2={BASE} />
        {bars.map((b, i) => {
          let acc = 0;
          const x = i * slot + (slot - barW) / 2;
          return (
            <g key={b.day} className={`tk-bar${i === sel ? ' on' : ''}`} tabIndex={0}
               aria-label={`${fmtDay(b.day)}: ${fmtTokens(b.total)} token`}
               onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)}>
              <rect x={i * slot} y={0} width={slot} height={BASE} fill="transparent" />
              {orderedRooms(b.byRoom, rooms).map((r) => {
                const v = b.byRoom[r.id];
                const top = y(acc + v), bottom = y(acc);
                acc += v;
                return <rect key={r.id} x={x} y={top} width={barW} height={Math.max(0, bottom - top)} fill={fill(r)} />;
              })}
            </g>
          );
        })}
        {ticks.map((i, idx) => {
          const anchor = idx === 0 ? 'start' : idx === ticks.length - 1 ? 'end' : 'middle';
          const x = anchor === 'start' ? 0 : anchor === 'end' ? W : i * slot + slot / 2;
          return (
            <text key={i} className="tk-lbl" x={x} y={H - 4} textAnchor={anchor}>{fmtDay(days[i])}</text>
          );
        })}
      </svg>
      <div className="tk-detail">
        <b>{fmtDay(shown.day)}</b>
        {shown.total === 0
          ? <span>nessun consumo registrato</span>
          : <>
              <span>{fmtTokens(shown.total)}</span>
              {orderedRooms(shown.byRoom, rooms).map((r) => (
                <span key={r.id}><i style={{ background: roomFill(r, striped) }} />{r.n} {fmtTokens(shown.byRoom[r.id])}</span>
              ))}
            </>}
      </div>
    </div>
  );
}
