import { useState } from 'react';
import { dayKey, fmtClock, fmtDay, formatDuration, roomFill, roomOf, sessionSegments, stripedRooms } from './logic';
import { PanelHeader, PanelPending } from './PanelHeader';
import type { Room, SessionRow } from './types';
import type { TableState } from './useTable';

/** Reparto, orari e durata di una sessione: etichetta accessibile e riga di dettaglio. */
function sessionLabel(s: SessionRow, room: Room): string {
  if (!s.created_at) return `${room.n} · inizio non registrato · ultimo segnale ${fmtClock(s.ts)}`;
  const start = Math.min(Date.parse(s.created_at), s.ts);
  const sameDay = dayKey(new Date(start)) === dayKey(new Date(s.ts));
  const from = sameDay ? fmtClock(start) : `${fmtDay(dayKey(new Date(start)))} ${fmtClock(start)}`;
  return `${room.n} · ${from}–${fmtClock(s.ts)} · ${formatDuration(s.ts - start)}`;
}

export function SessionTimeline({ state, rooms, days }: { state: TableState<SessionRow>; rooms: Room[]; days: string[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const header = <PanelHeader title="TIMELINE SESSIONI" sub="ultimi 7 giorni · 0-24h" error={state.error} />;
  if (state.data === null) {
    return <PanelPending cls="dp c6" header={header} error={state.error} />;
  }
  const striped = stripedRooms(rooms);
  const segs = state.data.flatMap((s) => sessionSegments(s, days).map((seg) => ({ seg, s })));
  // di default la sessione più recente fra quelle disegnate
  const latest = segs.reduce<SessionRow | null>((a, { s }) => (!a || s.ts > a.ts ? s : a), null);
  const shown = segs.find(({ s }) => s.id === sel)?.s ?? latest;
  const pick = (id: number) => ({ onMouseEnter: () => setSel(id), onFocus: () => setSel(id), onClick: () => setSel(id) });
  return (
    <div className="dp c6">
      {header}
      {[...days].reverse().map((day) => (
        <div key={day} className="tl-row">
          <span className="tl-day">{fmtDay(day)}</span>
          <div className="tl-track">
            {segs.filter(({ seg }) => seg.day === day).map(({ seg, s }) => {
              const room = roomOf(rooms, s.room);
              const on = shown?.id === s.id ? ' on' : '';
              if (seg.point) {
                return <span key={s.id} className={`tl-pt${on}`} style={{ left: `${seg.startPct}%` }}
                             role="button" aria-pressed={!!on} tabIndex={0} aria-label={sessionLabel(s, room)} {...pick(s.id)} />;
              }
              return <span key={s.id} className={`tl-seg${on}`}
                           style={{ left: `${seg.startPct}%`, width: `${seg.endPct - seg.startPct}%`, background: roomFill(room, striped) }}
                           role="button" aria-pressed={!!on} tabIndex={0} aria-label={sessionLabel(s, room)} {...pick(s.id)} />;
            })}
          </div>
        </div>
      ))}
      <div className="tl-axis">
        {[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}
      </div>
      <div className="tk-detail tl-detail" aria-live="polite">
        {shown ? <span>{sessionLabel(shown, roomOf(rooms, shown.room))}</span> : <span>nessuna sessione registrata</span>}
      </div>
    </div>
  );
}
