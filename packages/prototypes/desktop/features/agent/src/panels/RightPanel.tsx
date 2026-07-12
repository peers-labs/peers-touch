import { type CSSProperties, useState } from 'react';
import { T } from '../theme';
import type { TodoItem, TaskContext } from '../types';
import { PanelToggleDock } from '../../../../shared/PanelToggleButton';

interface RightPanelProps {
  todos: TodoItem[];
  context: TaskContext | undefined;
  onCollapse: () => void;
}

export function RightPanel({ todos, context, onCollapse }: RightPanelProps) {
  const [ctxTab, setCtxTab] = useState<'files' | 'other'>('files');
  const doneCount = todos.filter((t) => t.done).length;

  return (
    <div style={S.panel}>
      <PanelToggleDock side="right" open title="折叠上下文面板" onClick={onCollapse} />

      {/* Scrollable content */}
      <div style={S.content}>
        {/* Todo */}
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <span style={S.sectionTitle}>Todo</span>
          </div>
          {todos.length === 0 ? (
            <div style={S.emptyState}>
              <span style={S.emptyTitle}>No todos yet</span>
              <span style={S.emptyDesc}>Progress for complex tasks will appear here</span>
            </div>
          ) : (
            <div style={S.todoList}>
              {todos.map((item) => (
                <label key={item.id} style={S.todoRow}>
                  <input type="checkbox" checked={item.done} readOnly style={S.checkbox} />
                  <span style={{ ...S.todoText, ...(item.done ? S.todoDone : {}) }}>{item.text}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Context */}
        <div style={{ ...S.section, borderTop: `1px solid ${T.border.hairline}`, paddingTop: 16 }}>
          <div style={S.sectionHeader}>
            <span style={S.sectionTitle}>Context</span>
            <div style={S.contextMeta}>
              <button style={S.compactPill}>compact</button>
              {context && <span style={S.pctText}>{context.usedPct}%</span>}
            </div>
          </div>
          {!context ? (
            <div style={S.emptyState}>
              <span style={S.emptyTitle}>No contexts used yet</span>
              <span style={S.emptyDesc}>Track the tools and files in use as TRAE Work works.</span>
            </div>
          ) : (
            <>
              <div style={S.progressTrack}>
                <div style={{ ...S.progressFill, width: `${context.usedPct}%` }} />
              </div>
              <div style={S.fileTabs}>
                <button onClick={() => setCtxTab('files')} style={{ ...S.fileTab, ...(ctxTab === 'files' ? S.fileTabActive : {}) }}>Files</button>
                <button onClick={() => setCtxTab('other')} style={{ ...S.fileTab, ...(ctxTab === 'other' ? S.fileTabActive : {}) }}>Other</button>
              </div>
              <div style={S.fileList}>
                {context.files.filter((f) => f.group === ctxTab).map((f) => (
                  <div key={f.name} style={S.fileRow}>
                    <span style={S.fileIcon}>📄</span>
                    <span style={S.fileName}>{f.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  panel: { width: 230, minWidth: 230, height: '100%', display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${T.border.hairline}`, background: T.surface.canvas, padding: '14px 16px', boxSizing: 'border-box', position: 'relative' },
  content: { flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: 36 },
  section: { marginBottom: 16 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: T.text.primary },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 8px', textAlign: 'center' as const },
  emptyTitle: { fontSize: 13, fontWeight: 500, color: T.text.muted, marginBottom: 4 },
  emptyDesc: { fontSize: 12, color: T.text.quaternary, lineHeight: 1.4 },
  todoList: { display: 'flex', flexDirection: 'column', gap: 4 },
  todoRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' },
  checkbox: { width: 14, height: 14, accentColor: T.action.primary },
  todoText: { fontSize: 12, color: T.text.primary },
  todoDone: { textDecoration: 'line-through', color: T.text.muted },
  contextMeta: { display: 'flex', alignItems: 'center', gap: 8 },
  compactPill: { fontSize: 10, padding: '2px 8px', borderRadius: 10, border: `1px solid ${T.border.hairline}`, background: 'transparent', color: T.text.muted, cursor: 'pointer' },
  pctText: { fontSize: 11, color: T.text.muted, fontWeight: 500 },
  progressTrack: { height: 3, borderRadius: 2, background: T.surface.subtle, marginBottom: 10 },
  progressFill: { height: 3, borderRadius: 2, background: T.action.primary, transition: 'width 0.3s' },
  fileTabs: { display: 'flex', gap: 12, marginBottom: 8 },
  fileTab: { border: 'none', background: 'transparent', fontSize: 12, fontWeight: 500, color: T.text.muted, cursor: 'pointer', padding: 0 },
  fileTabActive: { color: T.action.primary },
  fileList: { display: 'flex', flexDirection: 'column', gap: 2 },
  fileRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' },
  fileIcon: { fontSize: 12 },
  fileName: { fontSize: 12, color: T.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
};
