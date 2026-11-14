import {
  useEffect, useRef, type HTMLAttributes, type ReactNode,
} from 'react';
import { Tag } from './feedback';

/**
 * TerminalSurface — presentational shell output surface.
 *
 * It owns NO PTY and spawns no process: the caller feeds an append-only line
 * stream plus a process status. This keeps the primitive reusable by the
 * Desktop workbench, Station console surfaces and prototypes alike.
 *
 * Contract:
 * - lines are rendered verbatim in a bounded, auto-scrolling mono viewport;
 * - stdin lines echo with a prompt tone, stderr uses the danger text token;
 * - the status tag is derived from the real process state, never from the
 *   last output line;
 * - role="log" + aria-live makes streamed output observable without forcing
 *   focus into the surface (input is a separate concern).
 */

export type TerminalStreamKind = 'stdin' | 'stdout' | 'stderr' | 'system';
export type TerminalStatus = 'running' | 'exited' | 'killed' | 'unknown';

export interface TerminalLine {
  id: string;
  stream: TerminalStreamKind;
  text: string;
}

export interface TerminalSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** Append-only output stream, oldest first. */
  lines: readonly TerminalLine[];
  status: TerminalStatus;
  /** Present only once the process has exited. 0 is success-toned. */
  exitCode?: number;
  /** Header command line, e.g. `pnpm test`. */
  command?: string;
  /** Working directory label shown in the header meta row. */
  cwd?: string;
  /** Optional header actions (kill / restart / copy). */
  actions?: ReactNode;
  runningLabel?: string;
  exitedLabel?: string;
  killedLabel?: string;
  unknownLabel?: string;
  exitLabel?: string;
  /** Placeholder shown before the first line arrives. */
  emptyLabel?: string;
  /** Max viewport height; defaults to the bounded 240px console surface. */
  maxHeight?: number | string;
  /** App-owned class merged onto the scrollable viewport (layout). */
  viewportClassName?: string;
}

const STATUS_TONE: Record<TerminalStatus, 'info' | 'success' | 'warning' | 'neutral'> = {
  running: 'info',
  exited: 'success',
  killed: 'warning',
  unknown: 'neutral',
};

function statusLabel(status: TerminalStatus, exitCode: number | undefined, labels: {
  running: string; exited: string; killed: string; unknown: string; exit: string;
}): string {
  if (status === 'exited' && typeof exitCode === 'number') {
    return `${labels.exited} · ${labels.exit} ${exitCode}`;
  }
  if (status === 'running') return labels.running;
  if (status === 'exited') return labels.exited;
  if (status === 'killed') return labels.killed;
  return labels.unknown;
}

export function TerminalSurface({
  lines,
  status,
  exitCode,
  command,
  cwd,
  actions,
  runningLabel = 'Running',
  exitedLabel = 'Exited',
  killedLabel = 'Killed',
  unknownLabel = 'Unknown',
  exitLabel = 'exit',
  emptyLabel = 'No output yet',
  maxHeight = 240,
  className = '',
  viewportClassName = '',
  ...props
}: TerminalSurfaceProps) {
  const viewportRef = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true);

  // Track whether the reader is pinned to the tail; scrolling up suspends
  // auto-scroll so streamed output never yanks the viewport away.
  const handleScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const tone = status === 'exited' && exitCode !== 0 ? 'danger' : STATUS_TONE[status];

  return (
    <div {...props} className={`pt-terminal ${className}`}>
      <div className="pt-terminal__bar">
        <span className="pt-terminal__command" title={command}>{command ?? 'shell'}</span>
        {cwd && <span className="pt-terminal__cwd" title={cwd}>{cwd}</span>}
        <span className="pt-terminal__spacer" />
        <Tag tone={tone} data-pt-terminal-status={status}>
          {statusLabel(status, exitCode, {
            running: runningLabel, exited: exitedLabel, killed: killedLabel,
            unknown: unknownLabel, exit: exitLabel,
          })}
        </Tag>
        {actions && <span className="pt-terminal__actions">{actions}</span>}
      </div>
      <pre
        ref={viewportRef}
        className={`pt-terminal__viewport ${viewportClassName}`}
        style={{ maxHeight }}
        role="log"
        aria-live="polite"
        aria-label={command ?? 'terminal output'}
        onScroll={handleScroll}
      >
        {lines.length === 0
          ? <span className="pt-terminal__empty">{emptyLabel}</span>
          : lines.map((line) => (
            <span
              key={line.id}
              className={`pt-terminal__line pt-terminal__line--${line.stream}`}
              data-stream={line.stream}
            >
              {line.stream === 'stdin' ? <span className="pt-terminal__prompt">$ </span> : null}
              {line.text || ' '}
            </span>
          ))}
      </pre>
    </div>
  );
}
