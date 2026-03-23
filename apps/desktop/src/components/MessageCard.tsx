import { Flexbox } from 'react-layout-kit';
import { Tag } from 'antd';
import { theme } from 'antd';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Info,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

export interface CardData {
  type: string;
  title?: string;
  body?: string;
  status?: 'ok' | 'error' | 'info' | 'warning';
  link?: string;
  linkText?: string;
  meta?: Record<string, unknown>;
}

interface Props {
  card: CardData;
  onNavigate?: (uri: string) => void;
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  ok: { color: 'success', icon: <CheckCircle2 size={14} />, label: 'Success' },
  error: { color: 'error', icon: <XCircle size={14} />, label: 'Error' },
  info: { color: 'processing', icon: <Info size={14} />, label: 'Info' },
  warning: { color: 'warning', icon: <AlertTriangle size={14} />, label: 'Warning' },
};

const typeLabels: Record<string, { icon: React.ReactNode; label: string }> = {
  'cron-run': { icon: <Clock size={14} />, label: 'Cron Run' },
  'channel-sent': { icon: <CheckCircle2 size={14} />, label: 'Delivered' },
  system: { icon: <Info size={14} />, label: 'System' },
};

export default function MessageCard({ card, onNavigate }: Props) {
  const { token } = theme.useToken();
  const sc = card.status ? statusConfig[card.status] : undefined;
  const tl = typeLabels[card.type] || { icon: <Info size={14} />, label: card.type };

  const borderColor =
    card.status === 'error'
      ? token.colorErrorBorder
      : card.status === 'warning'
        ? token.colorWarningBorder
        : token.colorBorderSecondary;

  return (
    <Flexbox
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: token.borderRadiusLG,
        padding: '12px 16px',
        background: token.colorBgContainer,
        maxWidth: 480,
        gap: 8,
      }}
    >
      {/* Header: type badge + status */}
      <Flexbox horizontal align="center" gap={8}>
        <Tag
          icon={tl.icon}
          style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {tl.label}
        </Tag>
        {sc && (
          <Tag
            color={sc.color}
            icon={sc.icon}
            style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {sc.label}
          </Tag>
        )}
        {card.meta?.duration != null && (
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {Number(card.meta.duration)}ms
          </span>
        )}
      </Flexbox>

      {/* Title */}
      {card.title && (
        <div style={{ fontWeight: 500, fontSize: 14, color: token.colorText }}>
          {card.title}
        </div>
      )}

      {/* Body */}
      {card.body && (
        <div
          style={{
            fontSize: 13,
            color: card.status === 'error' ? token.colorErrorText : token.colorTextSecondary,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {card.body}
        </div>
      )}

      {/* Deep link */}
      {card.link && (
        <div
          style={{
            fontSize: 13,
            color: token.colorPrimary,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
          onClick={() => onNavigate?.(card.link!)}
        >
          <ExternalLink size={12} />
          {card.linkText || 'View details'}
        </div>
      )}
    </Flexbox>
  );
}
