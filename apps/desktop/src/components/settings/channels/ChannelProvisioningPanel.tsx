import { useEffect, useState, type ReactNode } from 'react';
import { Button, Modal } from '@lobehub/ui';
import { Tabs } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
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
    <Modal
      centered
      destroyOnHidden
      enableResponsive={false}
      footer={null}
      open
      rootClassName="pt-channel-provision-modal"
      title={t('channels.v2.create.title')}
      width={560}
      onCancel={closeDialog}
      styles={{
        container: { borderRadius: 12, padding: 20 },
        body: {
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto',
          padding: 0,
        },
      }}
    >
      {content}
    </Modal>
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
          <input
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
          />
        </label>
      ) : null}
      <label>
        <span>{t('channels.v2.create.region')}</span>
        <select
          value={draft.region}
          onChange={(event) => updateDraft({
            region: event.target.value as ChannelCreationDraft['region'],
          })}
        >
          <option value="feishu">{t('channels.v2.region.feishu')}</option>
          <option value="lark">{t('channels.v2.region.lark')}</option>
        </select>
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
              <QRCodeSVG value={start.qrPayload} size={184} level="M" />
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
              onClick={() => api.openExternalUrl(snapshot.consoleUrl)}
            >
              <ExternalLink size={15} />
              {t('channels.v2.provision.openConsole')}
            </Button>
          ) : null}
          {error ? <p className="pt-channel-error" role="alert">{error}</p> : null}
        </div>
        <div className="pt-channel-dialog-actions">
          <Button onClick={() => void cancelScan()}>
            <ArrowLeft size={15} />
            {t('channels.v2.back')}
          </Button>
          <span />
          <Button onClick={closeDialog}>{t('channels.v2.cancel')}</Button>
          {ready ? (
            <Button type="primary" loading={busy} onClick={confirmScan}>
              {t('channels.v2.provision.connect')}
            </Button>
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
        <Button onClick={closeDialog}>{t('channels.v2.cancel')}</Button>
        <Button
          type="primary"
          loading={busy}
          disabled={!draft.name.trim()}
          onClick={beginScan}
        >
          {t('channels.v2.create.next')}
        </Button>
      </div>
    </div>
  );

  const customPane = (
    <div className="pt-channel-method-pane">
      <div className="pt-channel-form-grid is-three-columns">
        {renderCoreFields(false)}
        <label>
          <span>{t('channels.config.lark.appId.label')}</span>
          <input
            value={appId}
            placeholder={t('channels.config.lark.appId.placeholder')}
            onChange={(event) => {
              setAppId(event.target.value);
              setValidation(null);
            }}
          />
        </label>
        <label>
          <span>{t('channels.config.lark.appSecret.label')}</span>
          <input
            type="password"
            value={appSecret}
            onChange={(event) => {
              setAppSecret(event.target.value);
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
        <Button onClick={closeDialog}>{t('channels.v2.cancel')}</Button>
        {!validation?.valid ? (
          <Button
            type="primary"
            loading={busy}
            disabled={!appId.trim() || !appSecret}
            onClick={checkCustomApp}
          >
            {t('channels.v2.custom.check')}
          </Button>
        ) : (
          <Button type="primary" loading={busy} onClick={connectCustomApp}>
            {t('channels.v2.custom.connect')}
          </Button>
        )}
      </div>
    </div>
  );

  return wrapDialog(
    <section className="pt-channel-create is-dialog">
      <Tabs
        activeKey={mode}
        destroyOnHidden
        items={[
          {
            key: 'managed',
            label: t('channels.v2.create.tabManaged'),
            children: managedPane,
          },
          {
            key: 'custom',
            label: t('channels.v2.create.tabExisting'),
            children: customPane,
          },
        ]}
        size="small"
        onChange={(key) => {
          setError('');
          setValidation(null);
          setMode(key as SetupMode);
        }}
      />
    </section>,
  );
}
