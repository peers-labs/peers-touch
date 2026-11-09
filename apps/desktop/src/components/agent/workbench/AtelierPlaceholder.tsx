import { ArrowLeft, Zap } from 'lucide-react';
import { Button, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '../../../store/agent';

// Placeholder sub-surface for the former top-level Atelier module. It renders
// no extension runtime: no runtime page, extension store, page descriptor or
// hash route is involved. The entry lives in Agent Profile → Extensions until
// the product re-establishes a coherent Atelier ownership model.
export function AtelierPlaceholder({ agentName }: { agentName: string }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const setAgentSurface = useAgentStore((state) => state.setAgentSurface);

  return (
    <div
      data-pt-atelier-placeholder
      style={{
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgLayout,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <Button
          size="small"
          type="text"
          icon={<ArrowLeft size={15} />}
          data-pt-atelier-back
          aria-label={t('agent.atelier.back')}
          title={t('agent.atelier.back')}
          onClick={() => setAgentSurface(agentName, 'chat')}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: token.colorText }}>
          {t('agent.atelier.title')}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: token.colorPrimaryBg,
            color: token.colorPrimary,
          }}
        >
          <Zap size={28} />
        </span>
        <strong style={{ fontSize: 16, color: token.colorText }}>
          {t('agent.atelier.title')}
        </strong>
        <span
          data-pt-atelier-placeholder-hint
          style={{ maxWidth: 380, fontSize: 13, lineHeight: 1.6, color: token.colorTextSecondary }}
        >
          {t('agent.atelier.placeholderHint')}
        </span>
      </div>
    </div>
  );
}
