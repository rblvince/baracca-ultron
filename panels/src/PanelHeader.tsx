export function PanelHeader({ title, sub, error }: { title: string; sub: string; error: boolean }) {
  return (
    <h4>
      {title} <span className={`dtag ${error ? 'err' : 'real'}`}>{error ? 'ERRORE' : 'REALE'}</span>
      <em>{sub}</em>
    </h4>
  );
}
