import { Button, Typography, theme } from 'antd';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import type { Provider } from '../api/ai';
import { useAIStore } from '../store/ai';
import { t } from '../i18n';

/** Installation is a step of the selected CLI Provider's configuration. */
export default function AIProviderInstall({ provider }: { provider: Provider }) {
  const { token } = theme.useToken();
  const job = useAIStore((s) => s.installs[provider.id]);
  const start = useAIStore((s) => s.startInstall);
  const state = job?.install_state || provider.install_state || 'missing';
  const busy = state === 'installing';
  const percent = Math.max(0, Math.min(100, job?.percent || 0));
  const url = job?.manual_install_url || provider.manual_install_url;
  return (
    <section className="ai-editor-section" aria-label={t('ai.installFor', { name: provider.name })}>
      <Typography.Title level={5}>{t('ai.cliInstallation')}</Typography.Title>
      <div className="ai-installer" style={{ borderColor: token.colorBorderSecondary }}>
        {busy && <div aria-hidden className="ai-install-progress" style={{ width: `${percent}%`, background: token.colorPrimaryBg }} />}
        <div className="ai-installer-content">
          <Typography.Text role="status" aria-live="polite">
            {busy ? `${t(`ai.phase.${job?.phase || 'install'}`)} · ${percent}%`
              : state === 'ready' ? `${t('ai.installed')}${job?.installed_version ? ` · ${job.installed_version}` : ''}`
                : t(`ai.installState.${state}`)}
          </Typography.Text>
          {state !== 'ready' && (job?.install_supported ?? provider.install_supported) && (
            <Button loading={busy} onClick={() => void start(provider.id)} icon={state === 'failed' ? <RefreshCw size={14} /> : <Download size={14} />}>
              {t(state === 'failed' ? 'retry' : 'ai.install')}
            </Button>
          )}
          {url && <Button type="link" href={url} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={14} />}>{t('ai.guide')}</Button>}
        </div>
        {busy && <div role="progressbar" aria-label={t('ai.installFor', { name: provider.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="ai-sr-only" />}
        {state === 'failed' && <Typography.Paragraph className="ai-install-error" type="danger">{job?.error || t('ai.installRecovery')}</Typography.Paragraph>}
      </div>
      <Typography.Paragraph type="secondary">{t(state === 'ready' ? 'ai.afterInstall' : 'ai.installHint')}</Typography.Paragraph>
    </section>
  );
}
