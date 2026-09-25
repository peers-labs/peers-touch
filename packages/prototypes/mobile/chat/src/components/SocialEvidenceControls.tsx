import type { Dispatch } from 'react';
import { Button, Typography } from 'antd';
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
      <Typography.Text type="secondary">
        Demo transitions only. Use Retry, Send Request, Check Status, or Message in the preview,
        then choose its outcome here.
      </Typography.Text>
      <div className="mp-evidence-actions">
        <Button size="small" disabled={state.runtime !== 'retrying'}
          onClick={() => dispatch({ type: 'resolve-runtime', outcome: 'ready' })}>
          Retry succeeds
        </Button>
        <Button size="small" disabled={state.runtime !== 'retrying'}
          onClick={() => dispatch({ type: 'resolve-runtime', outcome: 'failed' })}>
          Retry fails
        </Button>
        <Button size="small" disabled={!resolvingRequest}
          onClick={() => dispatch({ type: 'resolve-request', outcome: 'sent' })}>
          Request confirmed pending
        </Button>
        <Button size="small" disabled={!resolvingRequest}
          onClick={() => dispatch({ type: 'resolve-request', outcome: 'unknown' })}>
          Request outcome unknown
        </Button>
        <Button size="small" disabled={state.request?.status !== 'sent'}
          onClick={() => dispatch({ type: 'accept-request' })}>
          Relationship accepted
        </Button>
        <Button size="small" disabled={state.direct?.status !== 'preparing'}
          onClick={() => dispatch({ type: 'resolve-direct', outcome: 'ready' })}>
          Direct ready
        </Button>
        <Button size="small" disabled={state.direct?.status !== 'preparing'}
          onClick={() => dispatch({ type: 'resolve-direct', outcome: 'failed' })}>
          Direct fails
        </Button>
      </div>
      <Typography.Text type="secondary" className="mp-evidence-intent">
        Intent: {state.request
          ? `${state.request.intentId} / ${state.request.federationId} / ${state.request.status}`
          : 'none'}
      </Typography.Text>
    </section>
  );
}
