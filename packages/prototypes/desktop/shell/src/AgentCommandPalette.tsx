import {
  ArrowLeft,
  BookOpenText,
  CircleSlash2,
  HelpCircle,
  ListTree,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { T } from './theme';

export type AgentCapabilityProjectionState =
  | 'ready'
  | 'stale'
  | 'unavailable'
  | 'empty';

export interface AgentCapabilityCommand {
  id: string;
  kind: 'skill' | 'mcp';
  name: string;
  token: string;
  description: string;
  version: string;
}

type PaletteView = 'all' | 'help' | 'tools' | 'skills';
type PalettePlacement = {
  bottom: number;
  left: number;
  width: number;
};

const PALETTE_WIDTH = 336;
const PALETTE_VIEWPORT_INSET = 8;
const PALETTE_TRIGGER_GAP = 10;

interface StaticCommand {
  id: Exclude<PaletteView, 'all'> | 'clear';
  token: string;
  name: string;
  description: string;
}

const STATIC_COMMANDS: StaticCommand[] = [
  {
    id: 'help',
    token: 'help',
    name: '/help',
    description: 'Explain the deterministic command set.',
  },
  {
    id: 'tools',
    token: 'tools',
    name: '/tools',
    description: 'Inspect the selected Agent tool snapshot.',
  },
  {
    id: 'skills',
    token: 'skills',
    name: '/skills',
    description: 'Inspect the selected Agent skill snapshot.',
  },
  {
    id: 'clear',
    token: 'clear',
    name: '/clear',
    description: 'Start a new Topic and preserve this history.',
  },
];

const STATE_COPY: Record<
  AgentCapabilityProjectionState,
  { label: string; detail: string; tone: 'ready' | 'warning' | 'muted' }
> = {
  ready: {
    label: 'Station snapshot v18',
    detail: 'Ready and pinned to this Agent.',
    tone: 'ready',
  },
  stale: {
    label: 'Stale Station snapshot v17',
    detail: 'Capability actions are disabled. Text chat remains available.',
    tone: 'warning',
  },
  unavailable: {
    label: 'Station snapshot unavailable',
    detail: 'No capability action is available. Text chat remains available.',
    tone: 'warning',
  },
  empty: {
    label: 'Station snapshot v18',
    detail: 'No Skills or Tools are bound to this Agent.',
    tone: 'muted',
  },
};

export function AgentCommandPalette({
  agentName,
  compact,
  items,
  onClear,
  onClose,
  onInsertCapability,
  onOpenExtensions,
  open,
  projectionState,
  triggerRef,
}: {
  agentName: string;
  compact: boolean;
  items: AgentCapabilityCommand[];
  onClear: () => void;
  onClose: () => void;
  onInsertCapability: (token: string) => void;
  onOpenExtensions: () => void;
  open: boolean;
  projectionState: AgentCapabilityProjectionState;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PaletteView>('all');
  const [placement, setPlacement] = useState<PalettePlacement | null>(null);

  useEffect(() => {
    if (!open) return;
    setView('all');
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('[data-palette-focusable="true"]')
        ?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, open, triggerRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const updatePlacement = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const requestedWidth = compact
        ? Math.min(PALETTE_WIDTH, window.innerWidth - PALETTE_VIEWPORT_INSET * 2)
        : PALETTE_WIDTH;
      const width = Math.max(
        0,
        Math.min(
          requestedWidth,
          window.innerWidth - PALETTE_VIEWPORT_INSET * 2,
        ),
      );
      const left = Math.min(
        Math.max(trigger.left, PALETTE_VIEWPORT_INSET),
        window.innerWidth - width - PALETTE_VIEWPORT_INSET,
      );
      setPlacement({
        bottom: window.innerHeight - trigger.top + PALETTE_TRIGGER_GAP,
        left,
        width,
      });
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [compact, open, triggerRef]);

  if (!open) return null;

  const commandItems = items.filter((item) => {
    if (view === 'skills') return item.kind === 'skill';
    if (view === 'tools') return item.kind === 'mcp';
    return true;
  });
  const capabilityEnabled = projectionState === 'ready';
  const stateCopy = STATE_COPY[projectionState];

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const nodes = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(
        '[data-palette-focusable="true"]:not(:disabled)',
      ) ?? []),
    ];
    if (nodes.length === 0) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      nodes[(current + 1) % nodes.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      nodes[current <= 0 ? nodes.length - 1 : current - 1]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      nodes[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    }
  };

  const selectStatic = (command: StaticCommand) => {
    if (command.id === 'clear') {
      onClose();
      onClear();
      return;
    }
    setView(command.id);
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('[data-palette-focusable="true"]')
        ?.focus();
    });
  };

  return (
    <>
      <button
        aria-hidden
        tabIndex={-1}
        type="button"
        style={styles.scrim}
        onClick={() => {
          onClose();
          triggerRef.current?.focus();
        }}
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label="Commands and Skills"
        data-capability-projection-state={projectionState}
        style={{
          ...styles.panel,
          bottom: placement?.bottom ?? PALETTE_VIEWPORT_INSET,
          left: placement?.left ?? PALETTE_VIEWPORT_INSET,
          width: placement?.width ?? `calc(100vw - ${PALETTE_VIEWPORT_INSET * 2}px)`,
          visibility: placement ? 'visible' : 'hidden',
        }}
        onKeyDown={moveFocus}
      >
        <div style={styles.header}>
          {view !== 'all' && (
            <button
              data-palette-focusable="true"
              type="button"
              style={styles.back}
              aria-label="Back to all commands"
              onClick={() => setView('all')}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={styles.title}>
              {view === 'all' ? 'Commands & Skills' : `/${view}`}
            </div>
            <div style={styles.agentName}>{agentName}</div>
          </div>
        </div>

        {view === 'help' ? (
          <div style={styles.helpPanel}>
            <div style={styles.helpLead}>
              Commands are local projections. Visibility never grants Tool
              authority or bypasses approval.
            </div>
            {STATIC_COMMANDS.map((command) => (
              <div key={command.id} style={styles.helpRow}>
                <code style={styles.token}>{command.name}</code>
                <span>{command.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {view === 'all' && (
              <section aria-label="Commands" style={styles.section}>
                <div style={styles.sectionTitle}>Commands</div>
                {STATIC_COMMANDS.map((command) => (
                  <button
                    key={command.id}
                    data-palette-focusable="true"
                    type="button"
                    role="menuitem"
                    style={styles.item}
                    onClick={() => selectStatic(command)}
                  >
                    {command.id === 'help' && <HelpCircle size={15} />}
                    {command.id === 'tools' && <Wrench size={15} />}
                    {command.id === 'skills' && <Sparkles size={15} />}
                    {command.id === 'clear' && <CircleSlash2 size={15} />}
                    <span style={styles.itemText}>
                      <span style={styles.itemName}>{command.name}</span>
                      <span style={styles.itemDescription}>
                        {command.description}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            )}

            <section aria-label="Station capability snapshot" style={styles.section}>
              <div style={styles.snapshot}>
                <span style={styles.snapshotIcon}>
                  {view === 'skills' ? (
                    <Sparkles size={14} />
                  ) : view === 'tools' ? (
                    <Wrench size={14} />
                  ) : (
                    <ListTree size={14} />
                  )}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      ...styles.snapshotLabel,
                      color:
                        stateCopy.tone === 'ready'
                          ? '#2f7a45'
                          : stateCopy.tone === 'warning'
                            ? '#9a6700'
                            : T.textSecondary,
                    }}
                  >
                    {stateCopy.label}
                  </span>
                  <span style={styles.snapshotDetail}>{stateCopy.detail}</span>
                </span>
              </div>

              {commandItems.length === 0 ? (
                <div style={styles.empty}>
                  <span>
                    {view === 'skills'
                      ? 'No Skills in this snapshot.'
                      : view === 'tools'
                        ? 'No Tools in this snapshot.'
                        : 'No capabilities in this snapshot.'}
                  </span>
                  {projectionState === 'empty' && (
                    <button
                      data-palette-focusable="true"
                      role="menuitem"
                      type="button"
                      style={styles.secondaryAction}
                      onClick={onOpenExtensions}
                    >
                      <BookOpenText size={13} />
                      Open Agent extensions
                    </button>
                  )}
                </div>
              ) : (
                commandItems.map((item) => (
                  <button
                    key={item.id}
                    data-palette-focusable="true"
                    disabled={!capabilityEnabled}
                    role="menuitem"
                    type="button"
                    style={{
                      ...styles.item,
                      ...(capabilityEnabled ? {} : styles.itemDisabled),
                    }}
                    onClick={() => onInsertCapability(item.token)}
                  >
                    {item.kind === 'skill' ? (
                      <Sparkles size={15} />
                    ) : (
                      <Wrench size={15} />
                    )}
                    <span style={styles.itemText}>
                      <span style={styles.itemHeading}>
                        <span style={styles.itemName}>{item.name}</span>
                        <span style={styles.version}>v{item.version}</span>
                      </span>
                      <span style={styles.itemDescription}>
                        {item.description}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: 'fixed',
    inset: 0,
    zIndex: 19,
    border: 0,
    background: 'transparent',
    padding: 0,
  },
  panel: {
    position: 'fixed',
    maxHeight: 408,
    overflowY: 'auto',
    background: T.white,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: 10,
    boxShadow: T.shadowMd,
    padding: 5,
    zIndex: 20,
  },
  header: {
    minHeight: 42,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 6px 6px',
    borderBottom: `1px solid ${T.border}`,
  },
  back: {
    width: 28,
    height: 28,
    border: 0,
    borderRadius: 7,
    background: 'transparent',
    color: T.textSecondary,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  title: {
    fontSize: 12.5,
    lineHeight: 1.35,
    fontWeight: 700,
    color: T.text,
  },
  agentName: {
    fontSize: 10.5,
    lineHeight: 1.35,
    color: T.textTertiary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingTop: 5,
  },
  sectionTitle: {
    padding: '4px 8px 3px',
    fontSize: 10.5,
    fontWeight: 700,
    color: T.textTertiary,
    textTransform: 'uppercase',
  },
  item: {
    width: '100%',
    minHeight: 48,
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: T.textSecondary,
    padding: '7px 8px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  itemDisabled: {
    cursor: 'not-allowed',
    opacity: 0.52,
  },
  itemText: {
    minWidth: 0,
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  itemHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  itemName: {
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: 650,
    color: T.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemDescription: {
    fontSize: 11,
    lineHeight: 1.35,
    color: T.textTertiary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  version: {
    flexShrink: 0,
    fontSize: 10.5,
    color: T.textTertiary,
  },
  snapshot: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    margin: '1px 3px 4px',
    padding: '8px 9px',
    borderRadius: 8,
    background: T.surface,
  },
  snapshotIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.textSecondary,
    background: T.white,
    flexShrink: 0,
  },
  snapshotLabel: {
    display: 'block',
    fontSize: 11.5,
    lineHeight: 1.4,
    fontWeight: 650,
  },
  snapshotDetail: {
    display: 'block',
    marginTop: 1,
    fontSize: 10.5,
    lineHeight: 1.4,
    color: T.textTertiary,
  },
  empty: {
    minHeight: 64,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 7,
    padding: '8px 10px',
    color: T.textTertiary,
    fontSize: 11.5,
  },
  secondaryAction: {
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: 7,
    background: T.white,
    color: T.textSecondary,
    padding: '0 9px',
    fontSize: 11.5,
    cursor: 'pointer',
  },
  helpPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    padding: '9px 8px 7px',
  },
  helpLead: {
    paddingBottom: 4,
    color: T.textSecondary,
    fontSize: 11.5,
    lineHeight: 1.5,
  },
  helpRow: {
    display: 'grid',
    gridTemplateColumns: '56px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'start',
    color: T.textSecondary,
    fontSize: 11.5,
    lineHeight: 1.45,
  },
  token: {
    color: T.primary,
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: 11,
  },
};
