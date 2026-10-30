import { Button, Tag, Typography, theme } from 'antd';
import { Download, ExternalLink, RefreshCw, Terminal } from 'lucide-react';
import { useAIStore } from '../store/ai';
import { t } from '../i18n';

const ADAPTERS = [
  ['trae-cli', 'TRAE CLI'], ['codex-cli', 'Codex'],
  ['cursor-cli', 'Cursor'], ['claude-cli', 'Claude Code'],
] as const;

export default function AIInstallers() {
  const { token } = theme.useToken();
  const providers = useAIStore((s) => s.providers);
  const installs = useAIStore((s) => s.installs);
  const start = useAIStore((s) => s.startInstall);
  return (
    <section aria-label={t('ai.adapters')}>
      <Typography.Title level={5}>{t('ai.adapters')}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {t('ai.installHint')}
      </Typography.Paragraph>
      <div className="ai-installers">
        {ADAPTERS.map(([id, name]) => {
          const provider = providers.find((p) => p.id === id);
          const job = installs[id];
          const state = job?.install_state || provider?.install_state || '';
          const percent = Math.max(0, Math.min(100, job?.percent || 0));
          const busy = state === 'installing';
          const url = job?.manual_install_url || provider?.manual_install_url;
          const supported = job?.install_supported ?? provider?.install_supported;
          return (
            <div key={id} className="ai-installer" data-adapter={id} style={{ borderColor: token.colorBorderSecondary }}>
              {busy && <div aria-hidden className="ai-install-progress" style={{ width: `${percent}%`, background: token.colorPrimaryBg }} />}
              <div className="ai-installer-content">
                <Terminal size={18} aria-hidden />
                <div className="ai-installer-label">
                  <Typography.Text strong>{name}</Typography.Text>
                  <div role="status" aria-live="polite">
                    <Typography.Text type={state === 'failed' ? 'danger' : 'secondary'}>
                      {busy ? `${t(`ai.phase.${job?.phase || 'install'}`)} · ${percent}%`
                        : state === 'ready' ? `${t('ai.installed')}${job?.installed_version ? ` · ${job.installed_version}` : ''}`
                          : t(`ai.installState.${state || 'missing'}`)}
                    </Typography.Text>
                  </div>
                </div>
                {state === 'ready' ? <Tag color="success">{t('ai.ready')}</Tag> : supported && state !== 'unsupported' ? (
                  <Button loading={busy} onClick={() => void start(id)} icon={state === 'failed' ? <RefreshCw size={14} /> : <Download size={14} />}>
                    {t(busy ? 'ai.phase.install' : state === 'failed' ? 'retry' : 'ai.install')}
                  </Button>
                ) : null}
                {url && <Button type="link" href={url} target="_blank" rel="noopener noreferrer" aria-label={t('ai.guideFor', { name })} icon={<ExternalLink size={14} />}>{t('ai.guide')}</Button>}
              </div>
              {busy && <div role="progressbar" aria-label={t('ai.installFor', { name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="ai-sr-only" />}
              {state === 'failed' && <Typography.Paragraph className="ai-install-error" type="danger">{job?.error || t('ai.installRecovery')}</Typography.Paragraph>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
