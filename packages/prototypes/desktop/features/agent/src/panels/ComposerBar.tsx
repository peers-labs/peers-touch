import { type CSSProperties, useRef, useState } from 'react';
import { Send, Paperclip, Image, Mic, AudioLines, ChevronDown } from 'lucide-react';
import { T } from '../theme';

interface ComposerBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  model: string;
  onModelChange: (model: string) => void;
}

const MODEL_OPTIONS = ['GPT-5.5', 'Claude Sonnet 4', 'Claude Opus 4', 'Gemini 2.5 Pro'];

export function ComposerBar({ value, onChange, onSend, model, onModelChange }: ComposerBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const hasText = value.trim().length > 0;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  }

  return (
    <div style={S.wrapper}>
      <div style={S.inputRow}>
        <button style={S.iconBtn}><Paperclip size={16} color={T.text.muted} /></button>
        <button style={S.iconBtn}><Image size={16} color={T.text.muted} /></button>
        <input ref={inputRef} type="text" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Help you write code, debugs, optimize performance and other development work, deliver production-ready code." style={S.input} />
        <div style={S.rightGroup}>
          <div style={{ position: 'relative' }}>
            <button style={S.modelBtn} onClick={() => setModelOpen(!modelOpen)}>
              <span style={S.modelText}>{model}</span>
              <ChevronDown size={11} color={T.text.muted} />
            </button>
            {modelOpen && (
              <div style={S.dropdown}>
                {MODEL_OPTIONS.map((m) => (
                  <button key={m} style={{ ...S.dropItem, ...(m === model ? S.dropItemActive : {}) }} onClick={() => { onModelChange(m); setModelOpen(false); }}>{m}</button>
                ))}
              </div>
            )}
          </div>
          <button style={S.iconBtn}><Mic size={16} color={T.text.muted} /></button>
          <button style={S.iconBtn}><AudioLines size={16} color={T.text.muted} /></button>
          <button style={{ ...S.sendBtn, ...(hasText ? S.sendActive : {}) }} onClick={onSend} disabled={!hasText}>
            <Send size={14} color={hasText ? '#fff' : T.text.quaternary} />
          </button>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  wrapper: { padding: '12px 20px 16px', borderTop: `1px solid ${T.border.hairline}` },
  inputRow: { display: 'flex', alignItems: 'center', gap: 4, padding: '10px 12px', borderRadius: 16, border: `1px solid ${T.border.hairline}`, background: T.surface.base },
  iconBtn: { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', flexShrink: 0 },
  input: { flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: T.text.primary, minWidth: 0 },
  rightGroup: { display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 },
  modelBtn: { display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', border: 'none', borderRadius: 6, background: 'transparent', cursor: 'pointer' },
  modelText: { fontSize: 12, color: T.text.muted, fontWeight: 500 },
  sendBtn: { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: '50%', background: '#e8e8e8', cursor: 'not-allowed', flexShrink: 0, transition: 'all 0.15s' },
  sendActive: { background: T.action.primary, cursor: 'pointer' },
  dropdown: { position: 'absolute', bottom: '100%', right: 0, marginBottom: 4, minWidth: 160, padding: 4, borderRadius: 10, border: `1px solid ${T.border.hairline}`, background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 100 },
  dropItem: { display: 'block', width: '100%', padding: '6px 10px', border: 'none', borderRadius: 6, background: 'transparent', fontSize: 12, color: T.text.primary, textAlign: 'left' as const, cursor: 'pointer' },
  dropItemActive: { background: T.surface.subtle, color: T.action.primary, fontWeight: 500 },
};
