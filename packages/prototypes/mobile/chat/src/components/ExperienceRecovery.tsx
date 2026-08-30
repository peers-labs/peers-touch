import { Button, Typography } from 'antd';
import {
  AlertTriangle,
  FileClock,
  KeyRound,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

const { Text, Title } = Typography;

export type BlockingEvidenceScenario =
  | 'station-identity-mismatch'
  | 'oauth-expired'
  | 'session-revoked';

export type ShellEvidenceScenario =
  | 'unknown-write'
  | 'ledger-full'
  | 'draft-restored';

const blockingContent = {
  'station-identity-mismatch': {
    Icon: ShieldAlert,
    eyebrow: 'Station verification',
    title: 'Station identity changed',
    description:
      'This address no longer matches the Station you saved. Your account data and pending actions remain isolated.',
    status: 'Connection blocked',
    primary: 'Review Station',
    secondary: 'Back to Stations',
  },
  'oauth-expired': {
    Icon: KeyRound,
    eyebrow: 'Sign in',
    title: 'Sign-in link expired',
    description:
      'The authorization attempt expired before it could be verified. No session was activated.',
    status: 'Authorization expired',
    primary: 'Try GitHub again',
    secondary: 'Use Email login',
  },
  'session-revoked': {
    Icon: ShieldAlert,
    eyebrow: 'Session',
    title: 'Sign in again',
    description:
      'This device session was revoked. Previous account content has been hidden.',
    status: 'Session revoked',
    primary: 'Continue to sign in',
    secondary: 'Change Station',
  },
} satisfies Record<
  BlockingEvidenceScenario,
  {
    Icon: typeof ShieldAlert;
    eyebrow: string;
    title: string;
    description: string;
    status: string;
    primary: string;
    secondary: string;
  }
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
  const Icon = content.Icon;

  return (
    <main className="mp-recovery-screen">
      <section className="mp-recovery-panel" aria-labelledby="recovery-title">
        <span className="mp-recovery-icon" aria-hidden="true">
          <Icon size={24} />
        </span>
        <Text className="mp-recovery-eyebrow">{content.eyebrow}</Text>
        <Title level={1} id="recovery-title" className="mp-recovery-title">
          {content.title}
        </Title>
        <Text className="mp-recovery-description">{content.description}</Text>
        <div className="mp-recovery-status" role="status">
          <AlertTriangle size={15} />
          <span>{content.status}</span>
        </div>
        <div className="mp-recovery-actions">
          <Button type="primary" block icon={<RefreshCw size={16} />} onClick={onPrimary}>
            {content.primary}
          </Button>
          <Button block onClick={onSecondary}>{content.secondary}</Button>
        </div>
      </section>
    </main>
  );
}

const shellContent = {
  'unknown-write': {
    Icon: FileClock,
    title: 'Message status unknown',
    description:
      'The Station may have accepted this message. Check its status before sending it again.',
    primary: 'Check status',
    secondary: 'Keep draft',
  },
  'ledger-full': {
    Icon: AlertTriangle,
    title: 'Pending changes need attention',
    description:
      'New changes are paused until earlier actions are resolved. You can continue reading.',
    primary: 'Review pending actions',
    secondary: 'Continue read-only',
  },
  'draft-restored': {
    Icon: FileClock,
    title: 'Draft restored',
    description:
      'Your unsent text and attachments were restored for this Station and account.',
    primary: 'Continue editing',
    secondary: 'Discard draft',
  },
} satisfies Record<
  ShellEvidenceScenario,
  {
    Icon: typeof FileClock;
    title: string;
    description: string;
    primary: string;
    secondary: string;
  }
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
  const Icon = content.Icon;

  return (
    <div className="mp-action-sheet-backdrop" role="presentation">
      <section className="mp-action-sheet mp-recovery-sheet" aria-labelledby="recovery-sheet-title">
        <div className="mp-action-sheet-handle" />
        <span className="mp-recovery-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <Title level={2} id="recovery-sheet-title" className="mp-recovery-sheet-title">
          {content.title}
        </Title>
        <Text className="mp-recovery-description">{content.description}</Text>
        <div className="mp-recovery-actions">
          <Button type="primary" block onClick={onPrimary}>{content.primary}</Button>
          <Button block onClick={onSecondary}>{content.secondary}</Button>
        </div>
      </section>
    </div>
  );
}
