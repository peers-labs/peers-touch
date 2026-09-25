import { Button, Typography } from 'antd';
import type { SearchDemoControl, SearchDemoOutcome } from '../searchDemo';

export function SearchEvidenceControls({ state, dispatch }: SearchDemoControl) {
  const outcomes: Array<{ label: string; outcome: SearchDemoOutcome }> = [
    { label: 'Search results', outcome: 'results' },
    { label: 'Search empty', outcome: 'empty' },
    { label: 'Search fails', outcome: 'error' },
  ];
  return (
    <section className="mp-evidence-controls" aria-label="Controlled search demo transitions">
      <Typography.Text type="secondary">Prototype-only search outcomes</Typography.Text>
      <div className="mp-evidence-actions">
        {outcomes.map(({ label, outcome }) => (
          <Button key={outcome} size="small" disabled={state.status !== 'loading' || !state.ticket}
            onClick={() => state.ticket && dispatch({ type: 'resolve', ticket: state.ticket, outcome })}>
            {label}
          </Button>
        ))}
        <Button size="small" disabled={!state.discarded}
          onClick={() => state.discarded
            && dispatch({ type: 'resolve', ticket: state.discarded, outcome: 'results' })}>
          Discarded search results
        </Button>
      </div>
    </section>
  );
}
