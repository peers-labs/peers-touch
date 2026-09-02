import { useState, type ReactNode } from 'react';
import { theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// InlineThinkingTag renders an inline `<think>...</think>` reasoning block
// emitted by the model into the message body, as a collapsible section. This
// aligns Peers Markdown with LobeHub's inline `<think>` plugin (I3) — a pure
// display component, no store dependency. Registered via markdownConfig's
// `components.think` + `allowHtml`.
interface InlineThinkingTagProps {
  children?: ReactNode;
}

export function InlineThinkingTag({ children }: InlineThinkingTagProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  return (
    <Flexbox
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        background: token.colorFillQuaternary,
        margin: '6px 0',
        overflow: 'hidden',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        gap={6}
        onClick={() => setExpanded((v) => !v)}
        style={{
          padding: '6px 10px',
          cursor: 'pointer',
          color: token.colorTextSecondary,
          fontSize: 12,
          userSelect: 'none',
        }}
      >
        <Brain size={13} />
        <span style={{ flex: 1 }}>{t('chat.thinking.title')}</span>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </Flexbox>
      {expanded && (
        <div
          style={{
            padding: '4px 12px 10px',
            fontSize: 13,
            color: token.colorTextTertiary,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}
        >
          {children}
        </div>
      )}
    </Flexbox>
  );
}
