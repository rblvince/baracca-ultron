import type { SupabaseClient } from '@supabase/supabase-js';
import { useMemo } from 'react';
import { dayStart, lastNDays } from './logic';
import { fetchSessions, fetchSubagents, fetchTokenUsage, listenTable } from './queries';
import { SessionTimeline } from './SessionTimeline';
import { SubagentLog } from './SubagentLog';
import { TokenHistory } from './TokenHistory';
import type { Room } from './types';
import { useTable } from './useTable';

export function Storico({ client, rooms, active, now = () => new Date() }:
  { client: SupabaseClient; rooms: Room[]; active: boolean; now?: () => Date }) {
  const today = now();
  const days30 = lastNDays(today, 30);
  const days7 = lastNDays(today, 7);
  const since7 = dayStart(days7[0]);
  const tokens = useTable(() => fetchTokenUsage(client, days30[0]), active);
  // useMemo: una funzione nuova a ogni render farebbe riagganciare il canale (e rileggere) di continuo
  const onSubs = useMemo(() => listenTable(client, 'subagents'), [client]);
  const onSess = useMemo(() => listenTable(client, 'sessions'), [client]);
  const subs = useTable(() => fetchSubagents(client, new Date(since7).toISOString()), active, 60_000, onSubs);
  const sess = useTable(() => fetchSessions(client, since7), active, 60_000, onSess);
  return (
    <>
      <div className="dgroup">STORICO</div>
      <TokenHistory state={tokens} rooms={rooms} days={days30} />
      <SubagentLog state={subs} rooms={rooms} />
      <SessionTimeline state={sess} rooms={rooms} days={days7} />
    </>
  );
}
