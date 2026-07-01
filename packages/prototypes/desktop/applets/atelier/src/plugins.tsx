/**
 * Task-management plugins.
 *
 * "How I organize my work" is pluggable. The shell owns the tasks; a plugin
 * only renders the left rail and delegates lifecycle moves back via TaskHost.
 *
 * Shipped here:
 *   - folders (default): group tasks by project/repo folder, like SOLO's
 *     "Your Task List". Each folder is collapsible with its own "+".
 *   - flat-list: a single flat list with the full lifecycle.
 *   - kanban / dag (placeholder): prove the surface can be swapped.
 *
 * Both real plugins share the same lifecycle (active -> archived -> deleted)
 * via the TaskRow menu. Adding Kanban/DAG later means implementing
 * TaskPlugin.render — no change to the data model or the rest of the shell.
 *
 * Web prototype surface: plain React DOM (<div>/<span>) + inline styles. The
 * row action menu is an inline expandable row.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { C } from './theme';
import type { Task, TaskHost, TaskPlugin } from './types';

function TaskRow({ t, host }: { t: Task; host: TaskHost }) {
  const selected = host.selectedId === t.id;
  const [menuOpen, setMenuOpen] = useState(false);

  const actions: { key: string; label: string; danger?: boolean }[] =
    t.status === 'active'
      ? [
          { key: 'archive', label: '归档' },
          { key: 'delete', label: '删除', danger: true },
        ]
      : t.status === 'archived'
        ? [
            { key: 'restore', label: '恢复到进行中' },
            { key: 'delete', label: '删除', danger: true },
          ]
        : [
            { key: 'restore', label: '还原' },
            { key: 'purge', label: '彻底删除', danger: true },
          ];

  const onAction = (key: string) => {
    setMenuOpen(false);
    if (key === 'archive') host.setStatus(t.id, 'archived');
    else if (key === 'delete') host.setStatus(t.id, 'deleted');
    else if (key === 'restore') host.setStatus(t.id, 'active');
    else if (key === 'purge') host.purge(t.id);
  };

  return (
    <div>
      <div
        onClick={() => host.select(t.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 26,
          padding: '0 6px',
          borderRadius: 6,
          backgroundColor: selected ? C.primaryWash2 : 'transparent',
          cursor: 'pointer',
        }}
      >
        <span
          style={{ flex: 1, fontSize: 12, color: t.status === 'active' ? C.text : C.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {t.title}
        </span>
        {t.branch ? <span style={{ fontSize: 11, color: C.textQuaternary, marginRight: 6 }}>⎇</span> : null}
        {t.running && t.status === 'active' ? <span style={{ fontSize: 11, color: C.primary, marginRight: 6 }}>●</span> : null}
        <span
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          style={{ fontSize: 13, color: selected ? C.textSecondary : C.textQuaternary, cursor: 'pointer' }}
        >
          {selected ? '▦' : '⋯'}
        </span>
      </div>
      {menuOpen ? (
        <div style={{ marginLeft: 8, marginBottom: 4 }}>
          {actions.map((a) => (
            <div
              key={a.key}
              onClick={() => onAction(a.key)}
              style={{ padding: '5px 8px', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 12, color: a.danger ? C.error : C.textSecondary }}>{a.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── default plugin: group tasks by project folder (SOLO style) ── */
const folders: TaskPlugin = {
  id: 'folders',
  name: '项目分组',
  tagline: '按项目 / 仓库文件夹分组（默认）',
  ready: true,
  render(host) {
    return <FoldersBody host={host} />;
  },
};

function FoldersBody({ host }: { host: TaskHost }) {
  const active = host.tasks.filter((t) => t.status === 'active');
  const archived = host.tasks.filter((t) => t.status === 'archived');
  const deleted = host.tasks.filter((t) => t.status === 'deleted');

  // preserve project order of first appearance
  const projects: string[] = [];
  for (const t of active) if (!projects.includes(t.project)) projects.push(t.project);

  return (
    <div>
      {projects.map((p) => (
        <ProjectGroup key={p} name={p} tasks={active.filter((t) => t.project === p)} host={host} />
      ))}
      {active.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textQuaternary, padding: 8 }}>没有进行中的任务</div>
      ) : null}

      {archived.length > 0 ? (
        <BinSection label={`归档 (${archived.length})`}>
          {archived.map((t) => (
            <TaskRow key={t.id} t={t} host={host} />
          ))}
        </BinSection>
      ) : null}
      {deleted.length > 0 ? (
        <BinSection label={`回收站 (${deleted.length})`}>
          {deleted.map((t) => (
            <TaskRow key={t.id} t={t} host={host} />
          ))}
          <div style={{ fontSize: 11, color: C.textQuaternary, padding: '4px 8px' }}>
            还原可找回；彻底删除不可恢复。
          </div>
        </BinSection>
      ) : null}
    </div>
  );
}

function ProjectGroup({ name, tasks, host }: { name: string; tasks: Task[]; host: TaskHost }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', height: 26, padding: '0 4px' }}
      >
        <span style={{ fontSize: 13, color: C.textTertiary, marginRight: 5 }}>▱</span>
        <span onClick={() => setOpen((v) => !v)} style={{ fontSize: 11, color: C.textTertiary, marginRight: 4, cursor: 'pointer' }}>
          {open ? '⌄' : '›'}
        </span>
        <span style={{ flex: 1, fontSize: 12, color: C.textSecondary }}>{name}</span>
        <span onClick={host.newTask} style={{ width: 18, height: 18, borderRadius: 5, backgroundColor: C.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: C.textTertiary, cursor: 'pointer' }}>+</span>
      </div>
      {open ? tasks.map((t) => <TaskRow key={t.id} t={t} host={host} />) : null}
    </div>
  );
}

/* ── optional plugin: a single flat list ── */
const flatList: TaskPlugin = {
  id: 'flat-list',
  name: '简单平铺',
  tagline: '任务平铺一个列表，不分项目',
  ready: true,
  render(host) {
    return <FlatListBody host={host} />;
  },
};

function FlatListBody({ host }: { host: TaskHost }) {
  const active = host.tasks.filter((t) => t.status === 'active');
  const archived = host.tasks.filter((t) => t.status === 'archived');
  const deleted = host.tasks.filter((t) => t.status === 'deleted');

  return (
    <div>
      {active.map((t) => (
        <TaskRow key={t.id} t={t} host={host} />
      ))}
      {active.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textQuaternary, padding: 8 }}>没有进行中的任务</div>
      ) : null}
      {archived.length > 0 ? (
        <BinSection label={`归档 (${archived.length})`}>
          {archived.map((t) => (
            <TaskRow key={t.id} t={t} host={host} />
          ))}
        </BinSection>
      ) : null}
      {deleted.length > 0 ? (
        <BinSection label={`回收站 (${deleted.length})`}>
          {deleted.map((t) => (
            <TaskRow key={t.id} t={t} host={host} />
          ))}
          <div style={{ fontSize: 11, color: C.textQuaternary, padding: '4px 8px' }}>
            还原可找回；彻底删除不可恢复。
          </div>
        </BinSection>
      ) : null}
    </div>
  );
}

/* ── shared collapsible section for archived / trash ── */
function BinSection({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, fontSize: 11, fontWeight: 'bold', color: C.textTertiary }}>{label}</span>
        <span style={{ fontSize: 12, color: C.textTertiary }}>{open ? '−' : '+'}</span>
      </div>
      {open ? <div>{children}</div> : null}
    </div>
  );
}

/* ── placeholders: prove the surface is swappable ── */
const kanban: TaskPlugin = {
  id: 'kanban',
  name: 'Kanban',
  tagline: '看板列管理（计划中）',
  ready: false,
  render() {
    return (
      <div style={{ padding: 16 }}>
        <span style={{ display: 'inline-block', backgroundColor: C.fillSecondary, borderRadius: 4, padding: '1px 7px', fontSize: 11, color: C.textSecondary }}>
          未实现
        </span>
        <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 8, lineHeight: '20px' }}>
          看板 / DAG 等管理方式可作为独立 plugin 接入：实现 TaskPlugin.render 即可，数据模型与对话流不变。
        </div>
      </div>
    );
  },
};

const dag: TaskPlugin = {
  id: 'dag',
  name: 'DAG',
  tagline: '依赖图管理（计划中）',
  ready: false,
  render() {
    return (
      <div style={{ padding: 16 }}>
        <span style={{ display: 'inline-block', backgroundColor: C.fillSecondary, borderRadius: 4, padding: '1px 7px', fontSize: 11, color: C.textSecondary }}>
          未实现
        </span>
      </div>
    );
  },
};

export const PLUGINS: TaskPlugin[] = [folders, flatList, kanban, dag];
export const DEFAULT_PLUGIN_ID = folders.id;
