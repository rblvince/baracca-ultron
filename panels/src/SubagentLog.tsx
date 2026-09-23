import { durationMs, fmtClock, fmtDay, formatDuration, groupByDay, roomFill, roomOf, stripedRooms } from './logic';
import { PanelHeader, PanelPending } from './PanelHeader';
import { HISTORY_SINCE, type Room, type SubagentRow } from './types';
import type { TableState } from './useTable';

export function SubagentLog({ state, rooms }: { state: TableState<SubagentRow>; rooms: Room[] }) {
  const header = <PanelHeader title="DIARIO SUBAGENTI" sub="ultimi 7 giorni" error={state.error} />;
  if (state.data === null) {
    return <PanelPending cls="dp c6" header={header} error={state.error} />;
  }
  if (state.data.length === 0) {
    return <div className="dp c6">{header}<div className="empty">Il diario parte dal {fmtDay(HISTORY_SINCE)}: ancora nessun subagente registrato.</div></div>;
  }
  const striped = stripedRooms(rooms);
  return (
    <div className="dp c6">
      {header}
      <div className="sa-list">
        {groupByDay(state.data, (r) => Date.parse(r.created_at)).map((g) => (
          <div key={g.day}>
            <div className="sa-day">{fmtDay(g.day)}</div>
            {g.rows.map((r) => {
              const room = roomOf(rooms, r.room);
              const ms = durationMs(r.created_at, r.finished_at);
              return (
                <div key={r.id} className="sa-row">
                  <span>{fmtClock(Date.parse(r.created_at))}</span>
                  <span className="sa-room" style={{ background: roomFill(room, striped) }}>{room.n}</span>
                  <span>{r.agent ?? '—'}</span>
                  <span className="sa-task" title={r.task ?? ''}>{r.task ?? '—'}</span>
                  {ms === null ? <span className="sa-run">in corso</span> : <span>{formatDuration(ms)}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
