import { type CSSProperties, useMemo } from 'react';
import { Plus, Sparkles, Timer, MessageCircle, GitBranch, SlidersHorizontal, ListFilter } from 'lucide-react';
import { T } from '../theme';
import type { Task, TaskMode } from '../types';
import { PanelToggleDock } from '../../../../shared/PanelToggleButton';

interface LeftRailProps {
  mode: TaskMode;
  setMode: (mode: TaskMode) => void;
  tasks: Task[];
  selectedTaskId: string;
  onSelectTask: (id: string) => void;
  onNewTask: () => void;
  onCollapse: () => void;
}

const MODES: { key: TaskMode; label: string }[] = [
  { key: 'work', label: 'Work' },
  { key: 'code', label: '</> Code' },
  { key: 'design', label: 'Design' },
];

export function LeftRail({ mode, setMode, tasks, selectedTaskId, onSelectTask, onNewTask, onCollapse }: LeftRailProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.status !== 'active') continue;
      const list = map.get(t.project) ?? [];
      list.push(t);
      map.set(t.project, list);
    }
    return map;
  }, [tasks]);

  return (
    <div style={S.rail}>
      {/* Pill Tabs */}
      <div style={S.tabs}>
        {MODES.map((m) => (
          <button key={m.key} onClick={() => setMode(m.key)} style={{ ...S.tab, ...(mode === m.key ? S.tabActive : {}) }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Quick Actions */}
      <div style={S.actions}>
        <button onClick={onNewTask} style={S.actionRow}><Plus size={14} color={T.text.primary} /><span>New task</span></button>
        <button style={S.actionRow}><Sparkles size={14} color={T.text.muted} /><span>Skills</span></button>
        <button style={S.actionRow}><Timer size={14} color={T.text.muted} /><span>Automation</span></button>
        <button style={S.actionRow}><MessageCircle size={14} color={T.text.muted} /><span>IM Channel</span></button>
      </div>

      {/* Task List Header */}
      <div style={S.listHeader}>
        <span style={S.listTitle}>Your Task List</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={S.headerIcon}><SlidersHorizontal size={13} color={T.text.muted} /></button>
          <button style={S.headerIcon}><ListFilter size={13} color={T.text.muted} /></button>
        </div>
      </div>

      {/* Task List */}
      <div style={S.list}>
        {Array.from(grouped.entries()).map(([project, projectTasks]) => (
          <div key={project} style={S.projectGroup}>
            <div style={S.projectHeader}>
              <span style={S.projectName}>{project}</span>
              <button style={S.projectAdd}><Plus size={11} color={T.text.muted} /></button>
            </div>
            {projectTasks.map((t) => (
              <button key={t.id} onClick={() => onSelectTask(t.id)} style={{ ...S.taskRow, ...(t.id === selectedTaskId ? S.taskActive : {}) }}>
                {t.running && <span style={S.dot} />}
                {t.branch && <GitBranch size={12} color={T.text.quaternary} style={{ flexShrink: 0, marginRight: 4 }} />}
                <span style={{ ...S.taskTitle, ...(t.id === selectedTaskId ? { color: T.action.primary } : {}) }}>{t.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <PanelToggleDock side="left" open title="折叠任务面板" onClick={onCollapse} />
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  rail: { width: 230, minWidth: 230, height: '100%', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.border.hairline}`, background: T.surface.canvas, padding: '12px 8px 56px', boxSizing: 'border-box', position: 'relative' },
  tabs: { display: 'flex', gap: 0, background: T.surface.subtle, borderRadius: 20, padding: 3, marginBottom: 12 },
  tab: { flex: 1, border: 'none', borderRadius: 16, padding: '5px 0', fontSize: 12, fontWeight: 600, color: T.text.muted, background: 'transparent', cursor: 'pointer', transition: 'all 0.15s' },
  tabActive: { background: '#fff', color: T.text.primary, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  actions: { display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 16 },
  actionRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 13, color: T.text.secondary, textAlign: 'left' as const },
  listHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 8 },
  listTitle: { fontSize: 11, fontWeight: 600, color: T.text.muted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  headerIcon: { width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, background: 'transparent', cursor: 'pointer' },
  list: { flex: 1, overflowY: 'auto' as const },
  projectGroup: { marginBottom: 12 },
  projectHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 4 },
  projectName: { fontSize: 11, fontWeight: 600, color: T.text.muted },
  projectAdd: { width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, background: 'transparent', cursor: 'pointer' },
  taskRow: { display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '6px 8px', border: 'none', borderRadius: 6, background: 'transparent', cursor: 'pointer', textAlign: 'left' as const },
  taskActive: { background: 'rgba(107,91,214,0.08)' },
  dot: { width: 6, height: 6, borderRadius: '50%', background: T.trust.success, flexShrink: 0, marginRight: 4 },
  taskTitle: { fontSize: 13, color: T.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
};
