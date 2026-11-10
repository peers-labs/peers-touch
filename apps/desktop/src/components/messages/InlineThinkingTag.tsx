import { useState, type ReactNode } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// InlineThinkingTag renders an inline `<think>...</think>` reasoning block
// emitted by the model into the message body, as a collapsible section. A pure
// display component, no store dependency. Wired through LazyMarkdown's
// `renderReasoning` slot on the peers Markdown primitive.
interface InlineThinkingTagProps {
  children?: ReactNode;
}

export function InlineThinkingTag({ children }: InlineThinkingTagProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`sc-think${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="sc-think__head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <Brain size={13} />
        <span className="sc-think__title">{t('chat.thinking.title')}</span>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {expanded && <div className="sc-think__body">{children}</div>}
    </div>
  );
}
