import { useRef, useState } from 'react';
import { Select, Typography, theme } from 'antd';
import { Check, Download, LoaderCircle, RotateCcw } from 'lucide-react';
import type { Provider } from '../api/ai';
import { useAIStore } from '../store/ai';
import { t } from '../i18n';

/** The selection owns installation intent; the Station owns job state. */
export default function AIProviderSelect({ method }: { method: 'http' | 'cli' }) {
  const { token } = theme.useToken();
  const providers = useAIStore((s) => s.providers);
  const selected = useAIStore((s) => s.selected);
  const installs = useAIStore((s) => s.installs);
  const select = useAIStore((s) => s.select);
  const startInstall = useAIStore((s) => s.startInstall);
  const loading = useAIStore((s) => s.loading);
  const profileDefaults = useAIStore((s) => s.profileDefaults);
  const [open, setOpen] = useState(false);
  const keepOpenOnSelection = useRef(false);
  const choices = providers.filter((p) => method === 'http' ? p.runtime_kind !== 'cli'
    : p.runtime_kind === 'cli' && p.id === (p.cli_adapter_id || p.id));
  const installation = (provider: Provider) => {
    const job = installs[provider.cli_adapter_id || provider.id];
    return {
      state: job?.install_state || provider.install_state || 'missing',
      supported: job?.install_supported ?? provider.install_supported,
      percent: Math.max(0, Math.min(100, job?.percent || 0)),
      phase: job?.phase || 'install',
      guide: job?.manual_install_url || provider.manual_install_url,
    };
  };
  const choose = (id: string) => {
    const provider = choices.find((p) => p.id === id);
    if (!provider) return;
    const profileID = method === 'cli' ? profileDefaults.find((item) => item.cli_adapter_id === id)?.provider_id : '';
    void select(profileID || id);
    const job = installation(provider);
    keepOpenOnSelection.current = method === 'cli' &&
      (job.state === 'installing' || Boolean(job.supported && ['missing', 'failed'].includes(job.state)));
    if (method === 'cli' && job.supported && ['missing', 'failed'].includes(job.state)) {
      setOpen(true);
      void startInstall(id);
    } else {
      setOpen(job.state === 'installing');
    }
  };
  const selectedRecord = providers.find((p) => p.id === selected);
  const selectedProvider = choices.find((p) => p.id === (method === 'cli' ? selectedRecord?.cli_adapter_id || selected : selected));
  const active = selectedProvider && installation(selectedProvider);
  return (
    <div className="ai-provider-picker">
      <Select
        aria-label={t('ai.selectProvider')}
        className="ai-provider-select"
        classNames={{ popup: { root: 'ai-provider-popup' } }}
        popupMatchSelectWidth
        open={open}
        onOpenChange={(next) => {
          // Select emits close after onSelect for both pointer and keyboard.
          // Consume only that close; Escape and outside clicks still dismiss.
          setOpen(next || keepOpenOnSelection.current);
          keepOpenOnSelection.current = false;
        }}
        value={selectedProvider?.id}
        onSelect={choose}
        placeholder={t('ai.selectProvider')}
        loading={loading && !providers.length}
        showSearch
        optionFilterProp="label"
        options={choices.map((p) => ({ value: p.id, label: p.name, provider: p }))}
        optionRender={(option) => {
          const provider = option.data.provider;
          const job = installation(provider);
          const cli = provider.runtime_kind === 'cli';
          const installing = cli && job.state === 'installing';
          const status = installing ? `${t(`ai.phase.${job.phase}`)} ${job.percent}%`
            : job.state === 'ready' ? t('ai.installed')
              : job.state === 'failed' && job.supported ? t('ai.retryInstall')
                : job.supported ? t('ai.selectToInstall') : t(`ai.installState.${job.state}`);
          return (
            <div className="ai-provider-select-option" data-provider-id={provider.id}
              data-install-state={cli ? job.state : undefined}>
              {installing && <span aria-hidden className="ai-option-progress"
                style={{ width: `${job.percent}%`, background: token.colorPrimaryBorder }} />}
              <span className="ai-option-content">
                <span>{provider.name}</span>
                {cli && <span className="ai-option-status" style={{ color: token.colorTextSecondary }}>
                  {installing ? <LoaderCircle size={13} /> : job.state === 'ready' ? <Check size={13} />
                    : job.state === 'failed' ? <RotateCcw size={13} /> : <Download size={13} />}
                  {status}
                </span>}
              </span>
            </div>
          );
        }}
      />
      {method === 'cli' && active?.state === 'installing' && <Typography.Text className="ai-picker-status"
        role="status" aria-live="polite" type="secondary">
        {t(`ai.phase.${active.phase}`)} {active.percent}%
        <span className="ai-sr-only" role="progressbar" aria-label={t('ai.installFor', { name: selectedProvider!.name })}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={active.percent} />
      </Typography.Text>}
      {method === 'cli' && active && ['manual_required', 'unsupported', 'failed'].includes(active.state) && (
        <Typography.Text className="ai-picker-status" type="secondary">
          {t(`ai.installState.${active.state}`)}
          {active.guide && <> · <a href={active.guide} target="_blank" rel="noopener noreferrer">{t('ai.guide')}</a></>}
        </Typography.Text>
      )}
    </div>
  );
}
