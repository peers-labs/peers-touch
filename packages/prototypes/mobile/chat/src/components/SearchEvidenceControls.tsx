import { Button, Text } from '@peers-touch/ui';
import type { SearchDemoControl, SearchDemoOutcome } from '../searchDemo';

export function SearchEvidenceControls({ state, dispatch }: SearchDemoControl) {
  const outcomes: Array<{ label: string; outcome: SearchDemoOutcome }> = [
    { label: 'Search results', outcome: 'results' },
    { label: 'Search empty', outcome: 'empty' },
    { label: 'Search fails', outcome: 'error' },
  ];
  const disabled = { kind: 'disabled', reason: 'Submit a search first' } as const;
  return (
    <section className="mp-evidence-controls" aria-label="Controlled search demo transitions">
      <Text tone="secondary">Prototype-only search outcomes</Text>
      <div className="mp-evidence-actions">
        {outcomes.map(({ label, outcome }) => (
          <Button key={outcome} actionId={`evidence.search.${outcome}`} density="compact"
            availability={state.status !== 'loading' || !state.ticket ? disabled : undefined}
            onActivate={() => state.ticket && dispatch({ type: 'resolve', ticket: state.ticket, outcome })}>
            {label}
          </Button>
        ))}
        <Button actionId="evidence.search.discarded" density="compact"
          availability={!state.discarded ? { kind: 'disabled', reason: 'No discarded search' } : undefined}
          onActivate={() => state.discarded
            && dispatch({ type: 'resolve', ticket: state.discarded, outcome: 'results' })}>
          Discarded search results
        </Button>
      </div>
    </section>
  );
}
