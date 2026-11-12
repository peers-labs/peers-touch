import { useEffect, useState, type ReactNode } from 'react';
import { Button, Dialog, Segmented, Select, TextField } from '@peers-touch/ui';
import { Schema } from '@peers-touch/schema';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  ScanLine,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  ChannelAppValidation,
  ChannelProvisioningSnapshot,
  ChannelProvisioningStart,
} from '../../../services/desktop_api';
import { api } from '../../../services/desktop_api';
import { channelActions } from '../../../services/channelActions';
import type { ChannelCreationDraft } from './channelDrafts';

type SetupMode = 'managed' | 'scan' | 'custom';

interface ChannelProvisioningPanelProps {
  draft: ChannelCreationDraft;
  onDraftChange: (draft: ChannelCreationDraft) => void;
  onBack: () => void;
  onConnected: (bindingId: string) => void;
}

const terminalStatuses = new Set(['ready', 'failed', 'cancelled', 'expired']);

function regionDomain(region: ChannelCreationDraft['region']): string {
  return region === 'lark'
    ? 'https://open.larksuite.com'
    : 'https://open.feishu.cn';
}

export function ChannelProvisioningPanel({
  draft,
  onDraftChange,
  onBack,
  onConnected,
}: ChannelProvisioningPanelProps) {
  const { t } = useTranslation('channels');
  const [mode, setMode] = useState<SetupMode>('managed');
  const [start, setStart] = useState<ChannelProvisioningStart | null>(null);
  const [snapshot, setSnapshot] = useState<ChannelProvisioningSnapshot | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [validation, setValidation] = useState<ChannelAppValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!start || terminalStatuses.has(snapshot?.status ?? '')) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await channelActions.pollProvisioning(
          start.sessionId,
          start.jobId,
        );
        if (!cancelled) {
          setSnapshot(next);
          setError(next.errorMessage || '');
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : String(pollError));
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [snapshot?.status, start]);

  const updateDraft = (patch: Partial<ChannelCreationDraft>) => {
    onDraftChange({ ...draft, ...patch });
  };

  const beginScan = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await channelActions.startProvisioning({
        appName: draft.name.trim(),
        appDescription: draft.description.trim(),
        region: draft.region,
      });
      setStart(next);
      setSnapshot(null);
      setMode('scan');
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(false);
    }
  };

  const cancelScan = async () => {
    if (start) {
      try {
        await channelActions.cancelProvisioning(start.sessionId, start.jobId);
      } catch {
        // The persisted job may already be terminal; returning remains valid.
      }
    }
    setStart(null);
    setSnapshot(null);
    setError('');
    setMode('managed');
  };

  const closeDialog = () => {
    const activeStart = start;
    const shouldCancel = activeStart
      && !terminalStatuses.has(snapshot?.status ?? '');
    onBack();
    if (shouldCancel) {
      void channelActions.cancelProvisioning(
        activeStart.sessionId,
        activeStart.jobId,
      ).catch(() => {
        // Closing remains valid when the persisted job already became terminal.
      });
    }
  };

  const wrapDialog = (content: ReactNode) => (
    <Dialog
      open
      onDismiss={closeDialog}
      title={t('channels.v2.create.title')}
      width={560}
      className="pt-channel-provision-modal"
      contentStyle={{
        borderRadius: 12,
        padding: 20,
        maxHeight: 'calc(100vh - 160px)',
        overflowY: 'auto',
      }}
    >
      {content}
    </Dialog>
  );

  const confirmScan = async () => {
    if (!start) return;
    setBusy(true);
    setError('');
    try {
      const confirmed = await channelActions.confirmProvisioning({
        sessionId: start.sessionId,
        jobId: start.jobId,
        pluginId: 'lark',
        providerKind: 'lark',
        domain: regionDomain(draft.region),
        agentId: '',
        enabled: true,
        name: draft.name.trim(),
      });
      const bindingId = confirmed.binding?.bindingId;
      if (!bindingId) throw new Error('channels.provisioning.bindingMissing');
      onConnected(bindingId);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : String(confirmError));
    } finally {
      setBusy(false);
    }
  };

  const checkCustomApp = async () => {
    setBusy(true);
    setError('');
    setValidation(null);
    try {
      const result = await channelActions.validateApp({
        providerKind: 'lark',
        providerAppId: appId.trim(),
        appSecret,
        domain: regionDomain(draft.region),
        region: draft.region,
      });
      setValidation(result);
      if (!result.valid) setError(result.errorMessage);
    } catch (validationError) {
      setError(validationError instanceof Error
        ? validationError.message
        : String(validationError));
    } finally {
      setBusy(false);
    }
  };

  const connectCustomApp = async () => {
    if (!validation?.valid) return;
    setBusy(true);
    setError('');
    try {
      const binding = await channelActions.createBinding({
        pluginId: 'lark',
        providerKind: 'lark',
        providerAppId: appId.trim(),
        domain: regionDomain(draft.region),
        agentId: '',
        enabled: true,
        appSecret,
        name: validation.appName,
        description: '',
        region: draft.region,
        appMode: 'custom',
      });
      setAppSecret('');
      onConnected(binding.bindingId);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError));
    } finally {
      setBusy(false);
    }
  };

  const renderCoreFields = (includeName: boolean) => (
    <>
      {includeName ? (
        <label>
          <span>{t('channels.v2.create.name')}</span>
          <TextField
            aria-label={t('channels.v2.create.name')}
            value={draft.name}
            onValueChange={(value) => updateDraft({ name: value })}
          />
        </label>
      ) : null}
      <label>
        <span>{t('channels.v2.create.region')}</span>
        <Select<ChannelCreationDraft['region']>
          value={draft.region}
          options={[
            { value: 'feishu', label: t('channels.v2.region.feishu') },
            { value: 'lark', label: t('channels.v2.region.lark') },
          ]}
          onValueChange={(next) => updateDraft({
            region: next as ChannelCreationDraft['region'],
          })}
        />
      </label>
    </>
  );

  if (mode === 'scan' && start) {
    const status = snapshot?.status ?? 'wait_scan';
    const ready = status === 'ready';
    const waitingAdmin = status === 'wait_admin';
    const failed = status === 'failed' || status === 'expired';
    return wrapDialog(
      <section className="pt-channel-create is-dialog">
        <div className="pt-channel-scan">
          {!ready && !failed ? (
            <div className="pt-channel-qr">
              <Schema.QRCode
                content={{ kind: 'external-protocol', owner: 'channels.provider-provisioning', value: start.qrPayload }}
                constraints={{ size: 320, style: 'classic', errorCorrection: 'Q' }}
                title={t('channels.v2.provision.scan')}
                errorLabel={t('channels.schema.qrUnavailable')}
              />
            </div>
          ) : ready ? (
            <span className="pt-channel-result-mark is-ready"><Check size={28} /></span>
          ) : (
            <span className="pt-channel-result-mark is-warning"><CircleAlert size={28} /></span>
          )}
          <h2>
            {ready
              ? t('channels.v2.provision.ready')
              : waitingAdmin
                ? t('channels.v2.provision.waitAdmin')
                : failed
                  ? t('channels.v2.provision.failed')
                  : t('channels.v2.provision.scan')}
          </h2>
          <p>
            {snapshot?.recoveryAction
              || t('channels.v2.provision.scanDescription')}
          </p>
          <div className="pt-channel-progress" role="status">
            {(snapshot?.steps ?? []).map((step) => (
              <span key={step.stepId} className={`is-${step.status}`}>
                {step.status === 'complete'
                  ? <Check size={15} />
                  : step.status === 'failed'
                    ? <X size={15} />
                    : <RefreshCw className={step.status === 'active' ? 'is-spinning' : ''} size={15} />}
                {step.label}
              </span>
            ))}
            {!snapshot ? (
              <span className="is-active">
                <RefreshCw className="is-spinning" size={15} />
                {t('channels.v2.provision.waiting')}
              </span>
            ) : null}
          </div>
          {snapshot?.consoleUrl ? (
            <Button
              actionId="channel-open-console"
              density="compact"
              leading={<ExternalLink size={15} />}
              label={t('channels.v2.provision.openConsole')}
              onActivate={() => api.openExternalUrl(snapshot.consoleUrl)}
            />
          ) : null}
          {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
        </div>
        <div className="pt-channel-dialog-actions">
          <Button
            actionId="channel-scan-back"
            density="compact"
            leading={<ArrowLeft size={15} />}
            label={t('channels.v2.back')}
            onActivate={() => void cancelScan()}
          />
          <span />
          <Button
            actionId="channel-scan-cancel"
            density="compact"
            label={t('channels.v2.cancel')}
            onActivate={closeDialog}
          />
          {ready ? (
            <Button
              actionId="channel-scan-connect"
              emphasis="primary"
              density="compact"
              execution={busy ? 'pending' : 'idle'}
              label={t('channels.v2.provision.connect')}
              onActivate={() => void confirmScan()}
            />
          ) : null}
        </div>
      </section>,
    );
  }

  const managedPane = (
    <div className="pt-channel-method-pane">
      <div className="pt-channel-form-grid">
        {renderCoreFields(true)}
        <div className="pt-channel-inline-note">
          <ScanLine size={17} />
          <span>
            <b>{t('channels.v2.create.scan')}</b>
            <small>{t('channels.v2.create.managedDescription')}</small>
          </span>
        </div>
      </div>
      <div className="pt-channel-method-summary">
        <span><Check size={14} />{t('channels.v2.create.managedCheck')}</span>
        <span><Check size={14} />{t('channels.v2.create.managedEditable')}</span>
      </div>
      {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
      <div className="pt-channel-dialog-actions">
        <span />
        <Button
          actionId="channel-managed-cancel"
          density="compact"
          label={t('channels.v2.cancel')}
          onActivate={closeDialog}
        />
        <Button
          actionId="channel-managed-next"
          emphasis="primary"
          density="compact"
          execution={busy ? 'pending' : 'idle'}
          label={t('channels.v2.create.next')}
          availability={!draft.name.trim()
            ? { kind: 'disabled', reason: t('channels.v2.create.next') }
            : undefined}
          onActivate={() => void beginScan()}
        />
      </div>
    </div>
  );

  const customPane = (
    <div className="pt-channel-method-pane">
      <div className="pt-channel-form-grid is-three-columns">
        {renderCoreFields(false)}
        <label>
          <span>{t('channels.config.lark.appId.label')}</span>
          <TextField
            aria-label={t('channels.config.lark.appId.label')}
            value={appId}
            placeholder={t('channels.config.lark.appId.placeholder')}
            onValueChange={(value) => {
              setAppId(value);
              setValidation(null);
            }}
          />
        </label>
        <label>
          <span>{t('channels.config.lark.appSecret.label')}</span>
          <TextField
            type="password"
            aria-label={t('channels.config.lark.appSecret.label')}
            value={appSecret}
            onValueChange={(value) => {
              setAppSecret(value);
              setValidation(null);
            }}
          />
        </label>
      </div>
      <p className="pt-channel-form-note">
        {t('channels.v2.custom.secretStorage')}
      </p>
      {validation ? (
        <div className={`pt-channel-validation${validation.valid ? ' is-ready' : ' is-warning'}`}>
          {validation.valid ? <Check size={18} /> : <CircleAlert size={18} />}
          <div>
            <b>{validation.valid
              ? t('channels.v2.custom.ready')
              : t('channels.v2.custom.needsRepair')}</b>
            {validation.checks.map((check) => (
              <small key={check.capability}>
                {check.capability}: {check.status}
                {check.recoveryAction ? ` · ${check.recoveryAction}` : ''}
              </small>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
      <div className="pt-channel-dialog-actions">
        <span />
        <Button
          actionId="channel-custom-cancel"
          density="compact"
          label={t('channels.v2.cancel')}
          onActivate={closeDialog}
        />
        {!validation?.valid ? (
          <Button
            actionId="channel-custom-check"
            emphasis="primary"
            density="compact"
            execution={busy ? 'pending' : 'idle'}
            label={t('channels.v2.custom.check')}
            availability={(!appId.trim() || !appSecret)
              ? { kind: 'disabled', reason: t('channels.v2.custom.check') }
              : undefined}
            onActivate={() => void checkCustomApp()}
          />
        ) : (
          <Button
            actionId="channel-custom-connect"
            emphasis="primary"
            density="compact"
            execution={busy ? 'pending' : 'idle'}
            label={t('channels.v2.custom.connect')}
            onActivate={() => void connectCustomApp()}
          />
        )}
      </div>
    </div>
  );

  return wrapDialog(
    <section className="pt-channel-create is-dialog">
      <Segmented<SetupMode>
        className="pt-channel-method-tabs"
        density="compact"
        value={mode}
        onValueChange={(key) => {
          if (!key) return;
          setError('');
          setValidation(null);
          setMode(key);
        }}
        options={[
          { value: 'managed', label: t('channels.v2.create.tabManaged') },
          { value: 'custom', label: t('channels.v2.create.tabExisting') },
        ]}
      />
      {mode === 'managed' ? managedPane : customPane}
    </section>,
  );
}
