import { Button, Icon, Spin, Text } from '@peers-touch/ui';
import type { IconName } from '../types';
import copy from '../../../../../locales/en/common.json';
import type { DemoFriendRequest, SocialDemoState } from '../socialDemo';

export function SocialUnavailablePage({ title, runtime, onRetry, onBack }: {
  title: string;
  runtime: SocialDemoState['runtime'];
  onRetry: () => void;
  onBack?: () => void;
}) {
  const retrying = runtime === 'retrying';
  return (
    <div className={`mp-page${onBack ? ' mp-page--detail' : ''}`} data-demo-runtime={runtime}>
      <header className="mp-header">
        {onBack ? (
          <button type="button" className="mp-header-action" onClick={onBack} aria-label="Back">
            <Icon iconId="arrow-left" size={20} />
          </button>
        ) : null}
        <h1 className="mp-header-title">{title}</h1>
      </header>
      <section
        className="mp-route-state"
        role={retrying ? 'status' : 'alert'}
        aria-live="polite"
        aria-busy={retrying}
        data-demo-recovery-owner="lifecycle"
        data-demo-route-state={retrying ? 'preparing' : 'unavailable'}
      >
        <span className="mp-route-state-icon" aria-hidden="true">
          {retrying ? <Spin size="small" /> : <Icon iconId="attention" size={22} />}
        </span>
        <Text strong className="mp-route-state-title">
          {copy[
            retrying
              ? 'mobile.route.preparingTitle'
              : 'mobile.route.unavailableTitle'
          ].replace('{{feature}}', title)}
        </Text>
        <Text tone="secondary" className="mp-route-state-copy">
          {copy[
            retrying
              ? 'mobile.route.preparingBody'
              : 'mobile.route.unavailableBody'
          ]}
        </Text>
        <Button actionId="route.retry" emphasis="primary"
          execution={retrying ? 'pending' : 'idle'}
          leading={<Icon iconId="refresh-ccw" size={16} />}
          onActivate={onRetry}>
          {copy['common.action.retry']}
        </Button>
      </section>
    </div>
  );
}

export function RequestRecoveryNotice({ request, onCheck }: {
  request: DemoFriendRequest | null;
  onCheck: () => void;
}) {
  if (!request || (request.status !== 'unknown' && request.status !== 'reconciling')) return null;
  const checking = request.status === 'reconciling';
  return (
    <section className="mp-request-recovery" role="status" aria-busy={checking}
      data-demo-intent-id={request.intentId}>
      <Text strong>{copy['mobile.recovery.command.title']}</Text>
      <Text className="mp-recovery-description" tone="secondary">{copy['mobile.contacts.requestUnconfirmed']}</Text>
      <Button actionId="request.check" execution={checking ? 'pending' : 'idle'}
        availability={checking ? { kind: 'disabled', reason: 'Checking' } : undefined}
        onActivate={onCheck}>
        {copy['mobile.recovery.command.reconcile'].replace('{{count}}', '1')}
      </Button>
    </section>
  );
}

export type BlockingEvidenceScenario =
  | 'station-identity-mismatch'
  | 'oauth-expired';

export type ShellEvidenceScenario =
  | 'unknown-write'
  | 'ledger-full'
  | 'draft-restored';

const blockingContent = {
  'station-identity-mismatch': {
    iconId: 'shield-alert',
    eyebrow: 'Station verification',
    title: 'Station identity changed',
    description:
      'This address no longer matches the Station you saved. Your account data and pending actions remain isolated.',
    status: 'Connection blocked',
    primary: 'Review Station',
    secondary: 'Back to Stations',
  },
  'oauth-expired': {
    iconId: 'key-round',
    eyebrow: 'Sign in',
    title: 'Sign-in link expired',
    description:
      'The authorization attempt expired before it could be verified. No session was activated.',
    status: 'Authorization expired',
    primary: 'Try GitHub again',
    secondary: 'Use Email login',
  },
} satisfies Record<
  BlockingEvidenceScenario,
  { iconId: IconName; eyebrow: string; title: string; description: string; status: string; primary: string; secondary: string }
>;

export function BlockingRecoveryScreen({
  scenario,
  onPrimary,
  onSecondary,
}: {
  scenario: BlockingEvidenceScenario;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  const content = blockingContent[scenario];

  return (
    <main className="mp-recovery-screen">
      <section className="mp-recovery-panel" aria-labelledby="recovery-title">
        <span className="mp-recovery-icon" aria-hidden="true">
          <Icon iconId={content.iconId} size={24} />
        </span>
        <Text className="mp-recovery-eyebrow" tone="secondary">{content.eyebrow}</Text>
        <h1 id="recovery-title" className="mp-recovery-title">{content.title}</h1>
        <Text className="mp-recovery-description" tone="secondary">{content.description}</Text>
        <div className="mp-recovery-status" role="status">
          <Icon iconId="attention" size={15} />
          <span>{content.status}</span>
        </div>
        <div className="mp-recovery-actions">
          <Button actionId="recovery.primary" emphasis="primary" fullWidth
            onActivate={onPrimary}>{content.primary}</Button>
          <Button actionId="recovery.secondary" fullWidth onActivate={onSecondary}>{content.secondary}</Button>
        </div>
      </section>
    </main>
  );
}

const shellContent = {
  'unknown-write': {
    iconId: 'file-clock',
    title: 'Message status unknown',
    description:
      'The Station may have accepted this message. Check its status before sending it again.',
    primary: 'Check status',
    secondary: 'Keep draft',
  },
  'ledger-full': {
    iconId: 'attention',
    title: 'Pending changes need attention',
    description:
      'New changes are paused until earlier actions are resolved. You can continue reading.',
    primary: 'Review pending actions',
    secondary: 'Continue read-only',
  },
  'draft-restored': {
    iconId: 'file-clock',
    title: 'Draft restored',
    description:
      'Your unsent text and attachments were restored for this Station and account.',
    primary: 'Continue editing',
    secondary: 'Discard draft',
  },
} satisfies Record<
  ShellEvidenceScenario,
  { iconId: IconName; title: string; description: string; primary: string; secondary: string }
>;

export function ShellRecoverySheet({
  scenario,
  onPrimary,
  onSecondary,
}: {
  scenario: ShellEvidenceScenario;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  const content = shellContent[scenario];

  return (
    <div className="mp-action-sheet-backdrop" role="presentation">
      <section className="mp-action-sheet mp-recovery-sheet" aria-labelledby="recovery-sheet-title">
        <div className="mp-action-sheet-handle" />
        <span className="mp-recovery-icon" aria-hidden="true">
          <Icon iconId={content.iconId} size={22} />
        </span>
        <h2 id="recovery-sheet-title" className="mp-recovery-sheet-title">{content.title}</h2>
        <Text className="mp-recovery-description" tone="secondary">{content.description}</Text>
        <div className="mp-recovery-actions">
          <Button actionId="shell-recovery.primary" emphasis="primary" fullWidth
            onActivate={onPrimary}>{content.primary}</Button>
          <Button actionId="shell-recovery.secondary" fullWidth
            onActivate={onSecondary}>{content.secondary}</Button>
        </div>
      </section>
    </div>
  );
}
