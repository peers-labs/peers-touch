/**
 * Right workbench dock panels: resources owned by the task, not by the
 * component mount. All rows are projections of Station/device truth:
 * artifact versions, conversation-bound browser tabs, worker-owned PTYs,
 * candidate memories, and per-capability readiness.
 */
import {
  Alert,
  Button,
  Empty,
  ListRow,
  ListSection,
  Tag,
} from '@peers-touch/ui';
import {
  Brain,
  Globe2,
  PackageCheck,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react';
import type {
  ArtifactVersion,
  BrowserTab,
  Capability,
  MemoryCandidate,
  TerminalSession,
} from './model';

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--pt-space-xs)',
};

const metaStyle: React.CSSProperties = { fontSize: 11, color: 'var(--pt-muted)' };
const titleStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--pt-text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export function ArtifactsPanel({
  artifacts,
  onCheck,
  onAccept,
}: {
  artifacts: ArtifactVersion[];
  onCheck: (version: number, pass: boolean) => void;
  onAccept: (version: number) => void;
}) {
  if (artifacts.length === 0) {
    return <Empty icon={<PackageCheck size={22} aria-hidden />} description="尚无成果。完成并检查后的 Agent 输出在这里成为不可变版本。" />;
  }
  return (
    <div style={sectionStyle} data-dock-panel="artifacts">
      {artifacts.map((a) => (
        <ListSection key={a.version} title={`v${a.version} · ${a.createdAt}`}>
          <ListRow
            label={<span style={titleStyle}>{a.title}</span>}
            description={
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Tag tone={a.structuralCheck === 'pass' ? 'success' : a.structuralCheck === 'fail' ? 'danger' : 'neutral'}>
                  {a.structuralCheck === 'pass' ? '检查通过' : a.structuralCheck === 'fail' ? '检查失败' : '未检查'}
                </Tag>
                {a.accepted ? <Tag>已接受</Tag> : null}
                <span style={metaStyle}>{a.sha}</span>
              </span>
            }
            control={a.accepted ? (
              <Tag tone="neutral">current</Tag>
            ) : (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <Button
                  actionId={`workbench.dock.check.${a.version}`}
                  density="compact"
                  availability={a.structuralCheck === 'pass' ? { kind: 'disabled', reason: '结构检查已通过' } : { kind: 'enabled' }}
                  onActivate={() => onCheck(a.version, true)}
                >
                  检查
                </Button>
                <Button
                  actionId={`workbench.dock.accept.${a.version}`}
                  density="compact"
                  emphasis="primary"
                  availability={a.structuralCheck === 'pass' ? { kind: 'enabled' } : { kind: 'disabled', reason: '先通过检查' }}
                  onActivate={() => onAccept(a.version)}
                >
                  接受
                </Button>
              </span>
            )}
          />
        </ListSection>
      ))}
    </div>
  );
}

export function BrowserPanel({ tabs }: { tabs: BrowserTab[] }) {
  if (tabs.length === 0) {
    return <Empty icon={<Globe2 size={22} aria-hidden />} description="没有受管浏览器标签页。模型浏览器动作会按会话惰性创建。" />;
  }
  return (
    <div style={sectionStyle} data-dock-panel="browser">
      {tabs.map((tab) => (
        <ListSection key={tab.id} title={tab.id}>
          <ListRow
            icon={<Globe2 size={15} aria-hidden />}
            label={<span style={titleStyle}>{tab.title}</span>}
            description={<span style={metaStyle}>{tab.url}</span>}
            control={
              <Tag tone={tab.lease === 'human' ? 'warning' : 'info'}>
                {tab.lease === 'human' ? '人工接管' : 'agent 持有'}
              </Tag>
            }
          />
        </ListSection>
      ))}
      <Alert
        tone="info"
        title="租约语义"
        description="人工接管期间模型动作不执行，返回有界 BROWSER_HUMAN_TAKEOVER_HELD；归还后续跑。"
      />
    </div>
  );
}

export function TerminalPanel({ terminals }: { terminals: TerminalSession[] }) {
  if (terminals.length === 0) {
    return <Empty icon={<SquareTerminal size={22} aria-hidden />} description="没有设备 PTY。长服务在设备侧持有，关闭查看不结束进程。" />;
  }
  return (
    <div style={sectionStyle} data-dock-panel="terminal">
      {terminals.map((term) => (
        <ListSection key={term.id} title={term.id}>
          <ListRow
            icon={<SquareTerminal size={15} aria-hidden />}
            label={<span style={{ ...titleStyle, fontFamily: 'var(--pt-mono)' }}>{term.label}</span>}
            description={<span style={metaStyle}>{term.workerOwned ? '设备 worker 持有（不经 Station 持久化）' : 'Station PTY'}</span>}
            control={<Tag tone={term.status === 'running' ? 'success' : 'neutral'}>{term.status}</Tag>}
          />
        </ListSection>
      ))}
    </div>
  );
}

export function MemoryPanel({
  memories,
  onReview,
}: {
  memories: MemoryCandidate[];
  onReview: (id: string, decision: 'confirmed' | 'rejected') => void;
}) {
  const pending = memories.filter((m) => m.status === 'candidate');
  if (pending.length === 0) {
    return <Empty icon={<Brain size={22} aria-hidden />} description="没有待决记忆候选。确认前候选不会进入任何 Turn。" />;
  }
  return (
    <div style={sectionStyle} data-dock-panel="memory">
      {pending.map((m) => (
        <ListSection key={m.id} title={`来自 ${m.sourceTurn}`}>
          <ListRow
            icon={<Brain size={15} aria-hidden />}
            label={<span style={titleStyle}>{m.summary}</span>}
            control={
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <Button
                  actionId={`workbench.memory.reject.${m.id}`}
                  density="compact"
                  emphasis="quiet"
                  tone="danger"
                  onActivate={() => onReview(m.id, 'rejected')}
                >
                  拒绝
                </Button>
                <Button
                  actionId={`workbench.memory.confirm.${m.id}`}
                  density="compact"
                  emphasis="primary"
                  onActivate={() => onReview(m.id, 'confirmed')}
                >
                  确认
                </Button>
              </span>
            }
          />
        </ListSection>
      ))}
    </div>
  );
}

export function CapabilitiesPanel({ capabilities }: { capabilities: Capability[] }) {
  return (
    <div style={sectionStyle} data-dock-panel="capabilities">
      <Alert
        tone="info"
        icon={<ShieldCheck size={16} aria-hidden />}
        title="Fail-closed 就绪"
        description="任一已绑定 client-native 能力未就绪，整个 Turn 在执行前拒绝，不降级为普通回答冒称执行。"
      />
      {capabilities.map((cap) => (
        <ListSection key={cap.id} title={cap.family}>
          <ListRow
            label={<span style={titleStyle}>{cap.label}</span>}
            description={
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={metaStyle}>{cap.id}</span>
                {cap.reasonCode ? <span style={metaStyle}>· {cap.reasonCode}</span> : null}
              </span>
            }
            control={
              <Tag tone={cap.readiness === 'ready' ? 'success' : 'warning'}>
                {cap.readiness === 'ready' ? 'READY' : 'BLOCKED'} · {cap.policy}
              </Tag>
            }
          />
        </ListSection>
      ))}
    </div>
  );
}
