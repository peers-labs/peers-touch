import type { Dispatch } from 'react';
import { Button, Text } from '@peers-touch/ui';
import type { SocialDemoAction, SocialDemoState } from '../socialDemo';

export function SocialEvidenceControls({
  state,
  dispatch,
}: {
  state: SocialDemoState;
  dispatch: Dispatch<SocialDemoAction>;
}) {
  const resolvingRequest = state.request?.status === 'pending'
    || state.request?.status === 'reconciling';

  return (
    <section className="mp-evidence-controls" aria-label="Controlled Social demo transitions">
      <Text tone="secondary">
        Demo transitions only. Use Retry, Send Request, Check Status, or Message in the preview,
        then choose its outcome here.
      </Text>
      <div className="mp-evidence-actions">
        <Button actionId="evidence.retry-ready" density="compact"
          availability={state.runtime !== 'retrying' ? { kind: 'disabled', reason: 'Only while retrying' } : undefined}
          onActivate={() => dispatch({ type: 'resolve-runtime', outcome: 'ready' })}>
          Retry succeeds
        </Button>
        <Button actionId="evidence.retry-fails" density="compact"
          availability={state.runtime !== 'retrying' ? { kind: 'disabled', reason: 'Only while retrying' } : undefined}
          onActivate={() => dispatch({ type: 'resolve-runtime', outcome: 'failed' })}>
          Retry fails
        </Button>
        <Button actionId="evidence.request-sent" density="compact"
          availability={!resolvingRequest ? { kind: 'disabled', reason: 'Only while resolving' } : undefined}
          onActivate={() => dispatch({ type: 'resolve-request', outcome: 'sent' })}>
          Request confirmed pending
        </Button>
        <Button actionId="evidence.request-unknown" density="compact"
          availability={!resolvingRequest ? { kind: 'disabled', reason: 'Only while resolving' } : undefined}
          onActivate={() => dispatch({ type: 'resolve-request', outcome: 'unknown' })}>
          Request outcome unknown
        </Button>
        <Button actionId="evidence.request-accepted" density="compact"
          availability={state.request?.status !== 'sent' ? { kind: 'disabled', reason: 'Only after request is sent' } : undefined}
          onActivate={() => dispatch({ type: 'accept-request' })}>
          Relationship accepted
        </Button>
        <Button actionId="evidence.direct-ready" density="compact"
          availability={state.direct?.status !== 'preparing' ? { kind: 'disabled', reason: 'Only while opening direct' } : undefined}
          onActivate={() => dispatch({ type: 'resolve-direct', outcome: 'ready' })}>
          Direct ready
        </Button>
        <Button actionId="evidence.direct-fails" density="compact"
          availability={state.direct?.status !== 'preparing' ? { kind: 'disabled', reason: 'Only while opening direct' } : undefined}
          onActivate={() => dispatch({ type: 'resolve-direct', outcome: 'failed' })}>
          Direct fails
        </Button>
      </div>
      <Text tone="secondary" className="mp-evidence-intent">
        Intent: {state.request
          ? `${state.request.intentId} / ${state.request.federationId} / ${state.request.status}`
          : 'none'}
      </Text>
    </section>
  );
}
