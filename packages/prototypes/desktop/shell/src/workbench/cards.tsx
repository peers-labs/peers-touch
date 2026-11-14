/**
 * Conversation-reading-path cards for the governed tool turn.
 *
 * Structured input and tool approval stay inside the message stream (Agent UI
 * Identity contract). Every card is a causal chain: trigger → evidence →
 * decision → terminal receipt/result; a denial is never rendered as success.
 */
import {
  Alert,
  Badge,
  Button,
  Card,
  Tag,
} from '@peers-touch/ui';
import {
  Check,
  CircleSlash,
  FileCheck2,
  FlaskConical,
  Globe2,
  ShieldQuestion,
  SquareTerminal,
} from 'lucide-react';
import type { ToolCallSpec } from './model';

const mono: React.CSSProperties = {
  fontFamily: 'var(--pt-mono)',
  fontSize: 12,
  lineHeight: 1.7,
};

const wrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--pt-space-sm)' };

function ToolGlyph({ family }: { family: ToolCallSpec['risk'] }) {
  return family === 'client-browser'
    ? <Globe2 size={15} aria-hidden />
    : <SquareTerminal size={15} aria-hidden />;
}

function riskTone(risk: ToolCallSpec['risk']) {
  return risk === 'client-browser' ? 'info' : 'warning';
}

function ReceiptLine({ call }: { call: ToolCallSpec }) {
  if (!call.receipt) return null;
  const approved = call.receipt.decision === 'approved';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--pt-space-xs)',
        color: approved ? 'var(--pt-secondary)' : 'var(--pt-danger)',
        fontSize: 12,
      }}
    >
      {approved ? <Check size={13} aria-hidden /> : <CircleSlash size={13} aria-hidden />}
      <span>
        {approved ? '已批准，revision' : '已拒绝'} {call.receipt.revision} · {call.receipt.decidedAt}
      </span>
    </div>
  );
}

/** Pending MANUAL approval: evidence first, one ink primary + one quiet deny. */
export function ApprovalCard({
  call,
  onDecide,
}: {
  call: ToolCallSpec;
  onDecide: (approved: boolean) => void;
}) {
  return (
    <Card
      data-workbench-card="approval"
      heading={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ToolGlyph family={call.risk} />
          {call.tool}
        </span>
      }
      actions={<Tag tone={riskTone(call.risk)}>{call.risk} · MANUAL</Tag>}
    >
      <div style={wrap}>
        <div style={{ color: 'var(--pt-text)', fontSize: 13 }}>{call.summary}</div>
        <dl
          style={{
            margin: 0,
            display: 'grid',
            gridTemplateColumns: '88px 1fr',
            gap: '2px var(--pt-space-sm)',
            background: 'var(--pt-subtle)',
            borderRadius: 'var(--pt-radius-md)',
            padding: 'var(--pt-space-sm)',
          }}
        >
          {call.evidence.map((row) => (
            <div key={row.label} style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--pt-muted)', fontSize: 11, margin: 0 }}>{row.label}</dt>
              <dd style={{ margin: 0, ...mono, color: 'var(--pt-text)', wordBreak: 'break-all' }}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        {call.status === 'pending' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--pt-space-xs)' }}>
            <Button
              actionId="workbench.approval.deny"
              emphasis="quiet"
              tone="danger"
              onActivate={() => onDecide(false)}
            >
              拒绝
            </Button>
            <Button
              actionId="workbench.approval.approve"
              emphasis="primary"
              leading={<ShieldQuestion size={15} aria-hidden />}
              onActivate={() => onDecide(true)}
            >
              批准本次调用
            </Button>
          </div>
        ) : (
          <ReceiptLine call={call} />
        )}
      </div>
    </Card>
  );
}

/** Terminal bounded result of an approved call. */
export function ToolResultCard({ call }: { call: ToolCallSpec }) {
  if (call.status !== 'approved' || !call.result) return null;
  const failed = typeof call.result.exitCode === 'number' && call.result.exitCode !== 0;
  return (
    <Card data-workbench-card="tool-result" flat>
      <div style={wrap}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ToolGlyph family={call.risk} />
          <span style={{ fontSize: 12, color: 'var(--pt-secondary)' }}>{call.tool} · 有界结果</span>
          {typeof call.result.exitCode === 'number' ? (
            <Tag tone={failed ? 'danger' : 'success'}>exit {call.result.exitCode}</Tag>
          ) : (
            <Tag tone="info">observation</Tag>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--pt-muted)' }}>
            {call.result.durationMs} ms · {call.result.bounded ? 'bounded' : 'unbounded'}
          </span>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 'var(--pt-space-sm)',
            borderRadius: 'var(--pt-radius-sm)',
            background: 'var(--pt-canvas)',
            border: `1px solid var(--pt-border)`,
            color: failed ? 'var(--pt-danger)' : 'var(--pt-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            ...mono,
          }}
        >
          {call.result.output}
        </pre>
      </div>
    </Card>
  );
}

/** Bounded fail-closed result returned while a human holds the browser. */
export function LeaseHeldCard() {
  return (
    <Alert
      data-workbench-card="lease-held"
      tone="info"
      icon={<Globe2 size={16} aria-hidden />}
      title="人工接管中"
      description="模型浏览器动作未执行：BROWSER_HUMAN_TAKEOVER_HELD 作为有界工具结果返回，等待归还后继续。"
    />
  );
}

/** Versioned agent output with separate structural check and accept actions. */
export function ArtifactCardView({
  version,
  title,
  status,
  accepted,
  onCheck,
  onAccept,
}: {
  version: number;
  title: string;
  status: 'none' | 'pass' | 'fail';
  accepted: boolean;
  onCheck: (pass: boolean) => void;
  onAccept: () => void;
}) {
  return (
    <Card
      data-workbench-card="artifact"
      heading={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <FileCheck2 size={15} aria-hidden />
          成果 · v{version}
        </span>
      }
      actions={<Badge label={accepted ? 'current' : 'draft'} />}
    >
      <div style={wrap}>
        <div style={{ fontSize: 13, color: 'var(--pt-text)' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-xs)' }}>
          {status === 'pass' ? (
            <Tag tone="success">结构检查通过</Tag>
          ) : status === 'fail' ? (
            <Tag tone="danger">结构检查失败</Tag>
          ) : (
            <Tag>未检查</Tag>
          )}
          {accepted ? <Tag tone="neutral">已接受 · current</Tag> : null}
        </div>
        {accepted ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--pt-space-xs)',
              justifyContent: 'flex-end',
              color: 'var(--pt-secondary)',
              fontSize: 12,
            }}
          >
            <Check size={13} aria-hidden />
            已接受为 current 版本 · 终态不可在此更改
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--pt-space-xs)' }}>
            <Button
              actionId="workbench.artifact.check-fail"
              emphasis="quiet"
              tone="danger"
              onActivate={() => onCheck(false)}
            >
              标记检查失败
            </Button>
            <Button
              actionId="workbench.artifact.check"
              emphasis="secondary"
              leading={<FlaskConical size={15} aria-hidden />}
              availability={status === 'pass' ? { kind: 'disabled', reason: '结构检查已通过' } : { kind: 'enabled' }}
              onActivate={() => onCheck(true)}
            >
              运行结构检查
            </Button>
            <Button
              actionId="workbench.artifact.accept"
              emphasis="primary"
              availability={status === 'pass' ? { kind: 'enabled' } : { kind: 'disabled', reason: '结构检查通过后才能接受' }}
              onActivate={onAccept}
            >
              接受为当前版本
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
