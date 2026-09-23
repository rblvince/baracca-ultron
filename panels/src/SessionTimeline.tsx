import { fmtClock, fmtDay, roomFill, roomOf, sessionSegments, stripedRooms } from './logic';
import { PanelHeader } from './PanelHeader';
import type { Room, SessionRow } from './types';
import type { TableState } from './useTable';

export function SessionTimeline({ state, rooms, days }: { state: TableState<SessionRow>; rooms: Room[]; days: string[] }) {
  const header = <PanelHeader title="TIMELINE SESSIONI" sub="ultimi 7 giorni · 0-24h" error={state.error} />;
  if (state.data === null) {
    return <div className="dp c6">{header}<div className="empty">{state.error ? 'dati non raggiungibili' : 'caricamento…'}</div></div>;
  }
  const striped = stripedRooms(rooms);
  const segs = state.data.flatMap((s) => sessionSegments(s, days).map((seg) => ({ seg, s })));
  return (
    <div className="dp c6">
      {header}
      {[...days].reverse().map((day) => (
        <div key={day} className="tl-row">
          <span className="tl-day">{fmtDay(day)}</span>
          <div className="tl-track">
            {segs.filter(({ seg }) => seg.day === day).map(({ seg, s }) => {
              const room = roomOf(rooms, s.room);
              if (seg.point) {
                return <span key={s.id} className="tl-pt" style={{ left: `${seg.startPct}%` }}
                             title={`${room.n} · inizio non registrato · ultimo segnale ${fmtClock(s.ts)}`} />;
              }
              return <span key={s.id} className="tl-seg"
                           style={{ left: `${seg.startPct}%`, width: `${seg.endPct - seg.startPct}%`, background: roomFill(room, striped) }}
                           title={`${room.n} · ${fmtClock(Date.parse(s.created_at!))}–${fmtClock(s.ts)}`} />;
            })}
          </div>
        </div>
      ))}
      <div className="tl-axis">
        {[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}
      </div>
    </div>
  );
}
