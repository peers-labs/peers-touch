import {
  BookOpenText,
  Brain,
  ChevronDown,
  FileText,
  Paperclip,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { T } from './theme';

export type TurnAttributionKind =
  | 'skill'
  | 'memory'
  | 'knowledge'
  | 'attachment'
  | 'tool';

export type TurnAttributionOutcome = 'included' | 'omitted' | 'truncated';

export interface TurnAttributionEntry {
  id: string;
  kind: TurnAttributionKind;
  name: string;
  version: string;
  outcome: TurnAttributionOutcome;
  reason: string;
}

const KIND_META: Record<
  TurnAttributionKind,
  { label: string; icon: LucideIcon }
> = {
  skill: { label: 'Skill', icon: Sparkles },
  memory: { label: 'Memory', icon: Brain },
  knowledge: { label: 'Knowledge', icon: BookOpenText },
  attachment: { label: 'Attachment', icon: Paperclip },
  tool: { label: 'Tool', icon: Wrench },
};

const OUTCOME_COPY: Record<TurnAttributionOutcome, string> = {
  included: 'Included',
  omitted: 'Omitted',
  truncated: 'Partially included',
};

export function TurnAttribution({
  entries,
}: {
  entries: TurnAttributionEntry[];
}) {
  const [open, setOpen] = useState(false);
  const visible = entries.filter((entry) => entry.outcome !== 'omitted');
  if (visible.length === 0) return null;

  return (
    <div data-turn-attribution style={styles.root}>
      <div style={styles.badgeRow} aria-label="Turn sources">
        {visible.map((entry) => {
          const meta = KIND_META[entry.kind];
          const Icon = meta.icon;
          return (
            <button
              key={entry.id}
              type="button"
              style={styles.badge(entry.outcome)}
              aria-expanded={open}
              aria-label={`${meta.label}: ${entry.name}. ${OUTCOME_COPY[entry.outcome]}`}
              data-attribution-kind={entry.kind}
              data-attribution-outcome={entry.outcome}
              onClick={() => setOpen((value) => !value)}
            >
              <Icon size={12} />
              <span>{meta.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={open}
          style={styles.detailToggle}
          onClick={() => setOpen((value) => !value)}
        >
          <FileText size={12} />
          Turn sources
          <ChevronDown
            size={12}
            style={{
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 120ms ease',
            }}
          />
        </button>
      </div>

      {open && (
        <section
          aria-label="Historical Turn source details"
          style={styles.detail}
        >
          <div style={styles.detailHeader}>
            <span style={styles.detailTitle}>Turn sources</span>
            <span style={styles.pinnedNote}>
              Pinned to this response
            </span>
          </div>
          <div style={styles.detailLead}>
            These facts describe what this Turn actually used. Current Agent
            settings do not rewrite them.
          </div>
          <div style={styles.entryList}>
            {entries.map((entry) => {
              const meta = KIND_META[entry.kind];
              const Icon = meta.icon;
              return (
                <div
                  key={entry.id}
                  style={styles.entry}
                  data-attribution-detail-kind={entry.kind}
                  data-attribution-detail-outcome={entry.outcome}
                >
                  <span style={styles.entryIcon}>
                    <Icon size={13} />
                  </span>
                  <span style={styles.entryBody}>
                    <span style={styles.entryHeading}>
                      <span style={styles.entryName}>{entry.name}</span>
                      <span style={styles.version}>{entry.version}</span>
                    </span>
                    <span style={styles.reason}>{entry.reason}</span>
                  </span>
                  <span style={styles.outcome(entry.outcome)}>
                    {OUTCOME_COPY[entry.outcome]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

const styles = {
  root: {
    marginTop: 10,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
  },
  badge: (outcome: TurnAttributionOutcome): React.CSSProperties => ({
    minHeight: 26,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: `1px solid ${
      outcome === 'truncated' ? 'rgba(250,173,20,0.35)' : T.borderSoft
    }`,
    borderRadius: 6,
    background:
      outcome === 'truncated' ? 'rgba(250,173,20,0.07)' : T.surface,
    color: outcome === 'truncated' ? '#8a5b00' : T.textSecondary,
    padding: '0 7px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  }),
  detailToggle: {
    minHeight: 26,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: 0,
    borderRadius: 6,
    background: 'transparent',
    color: T.textTertiary,
    padding: '0 6px',
    fontSize: 11,
    cursor: 'pointer',
  },
  detail: {
    marginTop: 8,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: 8,
    background: T.surface,
    padding: 10,
  },
  detailHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  detailTitle: {
    fontSize: 12.5,
    fontWeight: 700,
    color: T.text,
  },
  pinnedNote: {
    color: T.textTertiary,
    fontSize: 10.5,
    whiteSpace: 'nowrap',
  },
  detailLead: {
    marginTop: 3,
    color: T.textSecondary,
    fontSize: 11,
    lineHeight: 1.45,
  },
  entryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    marginTop: 8,
  },
  entry: {
    minHeight: 46,
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 8,
    padding: '5px 6px',
    borderRadius: 7,
    background: T.white,
  },
  entryIcon: {
    width: 24,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    background: T.surface,
    color: T.textSecondary,
  },
  entryBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  entryHeading: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  entryName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: T.text,
    fontSize: 11.5,
    fontWeight: 650,
  },
  version: {
    flexShrink: 0,
    color: T.textTertiary,
    fontSize: 10,
  },
  reason: {
    minWidth: 0,
    color: T.textTertiary,
    fontSize: 10.5,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  outcome: (outcome: TurnAttributionOutcome): React.CSSProperties => ({
    minWidth: 58,
    textAlign: 'right',
    color:
      outcome === 'included'
        ? '#2f7a45'
        : outcome === 'truncated'
          ? '#8a5b00'
          : T.textTertiary,
    fontSize: 10.5,
    fontWeight: 650,
  }),
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
