import { useMemo, useState } from 'react';
import { Check, RefreshCw, Trash2, X } from 'lucide-react';

import {
  reliabilityCommandRecoveryActions,
  type ReliabilityCommandRecoveryAction,
} from '../../runtimes/commandRuntime';
import type { CommandRecoveryState } from '../../runtimes/recoveryProjection';

interface CommandRecoveryPanelProps {
  readonly state: CommandRecoveryState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onAction: (
    action: ReliabilityCommandRecoveryAction,
  ) => Promise<void>;
}

const ACTIONS: readonly ReliabilityCommandRecoveryAction[] = [
  'reconcile',
  'cancel',
  'acknowledge',
  'discard-tracking',
];

export function CommandRecoveryPanel({
  state,
  t,
  onAction,
}: CommandRecoveryPanelProps) {
  const [pendingAction, setPendingAction] =
    useState<ReliabilityCommandRecoveryAction | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const actionCounts = useMemo(() => {
    const counts = new Map<ReliabilityCommandRecoveryAction, number>();
    for (const command of state.commands) {
      for (const action of reliabilityCommandRecoveryActions(command)) {
        counts.set(action, (counts.get(action) ?? 0) + 1);
      }
    }
    return counts;
  }, [state.commands]);

  async function runAction(action: ReliabilityCommandRecoveryAction) {
    if (pendingAction || !actionCounts.has(action)) return;
    setActionFailed(false);
    setPendingAction(action);
    try {
      await onAction(action);
    } catch {
      setActionFailed(true);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      className="recovery-notice recovery-command"
      data-acceptance-id="recovery-command"
      role="status"
      aria-labelledby="command-recovery-title"
      aria-describedby="command-recovery-description"
      aria-busy={pendingAction !== null}
    >
      <span className="recovery-notice__icon" aria-hidden="true">
        <RefreshCw size={18} />
      </span>
      <div className="recovery-notice__content">
        <strong id="command-recovery-title" className="recovery-notice__title">
          {t('mobile.recovery.command.title')}
        </strong>
        <span id="command-recovery-description" className="recovery-notice__text">
          {t('mobile.recovery.command.body', { count: state.commands.length })}
        </span>
        <ul className="recovery-command__items">
          {state.commands.map((command) => {
            const friendRequest = command.envelope.payload.case === 'friendRequest'
              ? command.envelope.payload.value.body
              : undefined;
            const relationship = command.envelope.payload.case === 'socialRelationship'
              ? command.envelope.payload.value.body
              : undefined;
            const targetPtid = relationship?.targetActor?.ptid
              || friendRequest?.receiver?.ptid
              || friendRequest?.sender?.ptid
              || '';
            return (
              <li
                key={command.commandId}
                className="recovery-command__item"
                data-command-id={command.commandId}
                data-command-state={command.state}
              >
                <strong>
                  {t(
                    relationship
                      ? 'mobile.recovery.command.relationship'
                      : 'mobile.recovery.command.friendRequest',
                  )}
                </strong>
                <span>
                  {t('mobile.recovery.command.commandId', {
                    id: command.commandId,
                  })}
                </span>
                {friendRequest?.requestId ? (
                  <span>
                    {t('mobile.recovery.command.requestId', {
                      id: friendRequest.requestId,
                    })}
                  </span>
                ) : null}
                {targetPtid ? (
                  <span>
                    {t('mobile.recovery.command.target', {
                      ptid: targetPtid,
                    })}
                  </span>
                ) : null}
                <span>
                  {t(`mobile.recovery.command.state.${command.state}`)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="recovery-notice__actions">
          {ACTIONS.map((action) => {
            const count = actionCounts.get(action);
            if (!count) return null;
            return (
              <button
                key={action}
                type="button"
                data-acceptance-id={`recovery-command-${action}`}
                className={`recovery-btn recovery-btn--compact ${
                  action === 'discard-tracking'
                    ? 'recovery-btn--danger'
                    : 'recovery-btn--secondary'
                }`}
                disabled={pendingAction !== null}
                onClick={() => {
                  void runAction(action);
                }}
              >
                <CommandActionIcon action={action} />
                {t(`mobile.recovery.command.${action}`, { count })}
              </button>
            );
          })}
        </div>
        {actionFailed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.actionFailed')}
          </span>
        )}
      </div>
    </section>
  );
}

function CommandActionIcon({
  action,
}: {
  readonly action: ReliabilityCommandRecoveryAction;
}) {
  if (action === 'reconcile') return <RefreshCw size={14} aria-hidden="true" />;
  if (action === 'acknowledge') return <Check size={14} aria-hidden="true" />;
  if (action === 'discard-tracking') return <Trash2 size={14} aria-hidden="true" />;
  return <X size={14} aria-hidden="true" />;
}
