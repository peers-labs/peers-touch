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
  useMemo,
  useRef,
  useState,
} from 'react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import {
  AgentCommandCapabilityKind,
  CapabilityReadinessState,
  type AgentCommandCapabilitySnapshot,
} from '../../gen/proto/domain/agent/capability_pb';
import type {
  AgentCommandCapabilityProjectionState,
} from '../../store/agentCapabilities';

type PaletteView = 'all' | 'help' | 'tools' | 'skills';
type StaticCommandId = Exclude<PaletteView, 'all'> | 'clear';
type PalettePlacement = {
  bottom: number;
  left: number;
  width: number;
};

const PALETTE_WIDTH = 336;
const PALETTE_VIEWPORT_INSET = 8;
const PALETTE_TRIGGER_GAP = 10;

const STATIC_COMMANDS: Array<{
  id: StaticCommandId;
  icon: typeof HelpCircle;
}> = [
  { id: 'help', icon: HelpCircle },
  { id: 'tools', icon: Wrench },
  { id: 'skills', icon: Sparkles },
  { id: 'clear', icon: CircleSlash2 },
];

function shortSnapshotID(snapshotID: string): string {
  return snapshotID.length > 18
    ? `${snapshotID.slice(0, 18)}...`
    : snapshotID;
}

function capabilityToken(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function AgentCommandPalette({
  agentName,
  onClear,
  onClose,
  onInsertCapability,
  onOpenExtensions,
  open,
  projectionState,
  snapshot,
  triggerRef,
}: {
  agentName: string;
  onClear: () => void;
  onClose: () => void;
  onInsertCapability: (token: string) => void;
  onOpenExtensions: () => void;
  open: boolean;
  projectionState: AgentCommandCapabilityProjectionState;
  snapshot?: AgentCommandCapabilitySnapshot;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const panelRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PaletteView>('all');
  const [placement, setPlacement] = useState<PalettePlacement | null>(null);

  useEffect(() => {
    if (!open) return;
    setView('all');
    const firstFrame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLElement>('[data-palette-focusable="true"]')
          ?.focus();
      });
    });
    return () => cancelAnimationFrame(firstFrame);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const updatePlacement = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(
        PALETTE_WIDTH,
        Math.max(0, window.innerWidth - PALETTE_VIEWPORT_INSET * 2),
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
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [onClose, open, triggerRef]);

  const items = useMemo(() => (snapshot?.items ?? []).filter((item) => {
    if (view === 'skills') {
      return item.kind === AgentCommandCapabilityKind.SKILL;
    }
    if (view === 'tools') {
      return item.kind === AgentCommandCapabilityKind.TOOL;
    }
    return true;
  }), [snapshot?.items, view]);

  if (!open) return null;

  const capabilitySnapshotReady = projectionState === 'ready';
  const focusFirst = () => {
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('[data-palette-focusable="true"]')
        ?.focus();
    });
  };
  const closeAndRestore = () => {
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
      closeAndRestore();
    }
  };
  const selectStaticCommand = (id: StaticCommandId) => {
    if (id === 'clear') {
      onClose();
      onClear();
      return;
    }
    setView(id);
    focusFirst();
  };

  const stateColor = projectionState === 'ready'
    ? token.colorSuccessText
    : projectionState === 'empty'
      ? token.colorTextSecondary
      : token.colorWarningText;
  const snapshotLabel = snapshot?.snapshotId
    ? t('chat.input.commands.snapshotVersion', {
        snapshot: shortSnapshotID(snapshot.snapshotId),
      })
    : t('chat.input.commands.snapshotUnavailable');

  return (
    <>
      <button
        aria-hidden
        tabIndex={-1}
        type="button"
        onClick={closeAndRestore}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 29,
          border: 0,
          background: 'transparent',
          padding: 0,
        }}
      />
      <div
        ref={panelRef}
        role="menu"
        aria-label={t('chat.input.commands.title')}
        data-pt-agent-command-palette
        data-capability-projection-state={projectionState}
        data-capability-snapshot-id={snapshot?.snapshotId}
        data-command-palette-view={view}
        onKeyDown={handlePanelKeyDown}
        style={{
          position: 'fixed',
          bottom: placement?.bottom ?? PALETTE_VIEWPORT_INSET,
          left: placement?.left ?? PALETTE_VIEWPORT_INSET,
          zIndex: 30,
          width: placement?.width ?? `calc(100vw - ${PALETTE_VIEWPORT_INSET * 2}px)`,
          maxHeight: 408,
          overflowY: 'auto',
          visibility: placement ? 'visible' : 'hidden',
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          background: token.colorBgElevated,
          padding: 5,
        }}
      >
        <div
          style={{
            minHeight: 42,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 6px 6px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {view !== 'all' && (
            <button
              data-palette-focusable="true"
              type="button"
              aria-label={t('chat.input.commands.back')}
              onClick={() => {
                setView('all');
                focusFirst();
              }}
              style={iconButtonStyle(token.colorTextSecondary)}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ color: token.colorText, fontSize: 13, fontWeight: 700 }}>
              {view === 'all'
                ? t('chat.input.commands.title')
                : `/${view}`}
            </div>
            <div
              style={{
                color: token.colorTextTertiary,
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {agentName}
            </div>
          </div>
        </div>

        {view === 'help' ? (
          <section style={{ padding: '8px 7px' }}>
            {STATIC_COMMANDS.map(({ id }) => (
              <div
                key={id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '64px minmax(0, 1fr)',
                  gap: 8,
                  padding: '5px 0',
                  color: token.colorTextSecondary,
                  fontSize: 12,
                }}
              >
                <code style={{ color: token.colorText }}>/{id}</code>
                <span>{t(`chat.input.commands.command.${id}.description`)}</span>
              </div>
            ))}
          </section>
        ) : (
          <>
            {view === 'all' && (
              <section
                aria-label={t('chat.input.commands.commandsLabel')}
                style={sectionStyle}
              >
                <div style={sectionTitleStyle(token.colorTextTertiary)}>
                  {t('chat.input.commands.commandsLabel')}
                </div>
                {STATIC_COMMANDS.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    data-palette-focusable="true"
                    data-command-id={id}
                    role="menuitem"
                    type="button"
                    onClick={() => selectStaticCommand(id)}
                    style={itemStyle(token.colorText)}
                  >
                    <Icon size={15} />
                    <span style={itemTextStyle}>
                      <strong style={{ fontSize: 12.5 }}>/{id}</strong>
                      <span style={descriptionStyle(token.colorTextSecondary)}>
                        {t(`chat.input.commands.command.${id}.description`)}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            )}

            <section
              aria-label={t('chat.input.commands.snapshotLabel')}
              style={sectionStyle}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  margin: '3px 5px 5px',
                  padding: '7px 8px',
                  borderRadius: token.borderRadiusSM,
                  background: token.colorFillQuaternary,
                }}
              >
                {view === 'skills'
                  ? <Sparkles size={14} />
                  : view === 'tools'
                    ? <Wrench size={14} />
                    : <ListTree size={14} />}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      color: stateColor,
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {snapshotLabel}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      color: token.colorTextSecondary,
                      fontSize: 11,
                    }}
                  >
                    {t(`chat.input.commands.state.${projectionState}`)}
                  </span>
                </span>
              </div>

              {items.length === 0 ? (
                <div
                  style={{
                    padding: '10px 8px',
                    color: token.colorTextSecondary,
                    fontSize: 12,
                  }}
                >
                  <span>
                    {t(`chat.input.commands.empty.${view}`)}
                  </span>
                  {projectionState === 'empty' && (
                    <button
                      data-palette-focusable="true"
                      role="menuitem"
                      type="button"
                      onClick={onOpenExtensions}
                      style={{
                        ...itemStyle(token.colorText),
                        marginTop: 6,
                        width: '100%',
                      }}
                    >
                      <BookOpenText size={13} />
                      <span>{t('chat.input.commands.openExtensions')}</span>
                    </button>
                  )}
                </div>
              ) : items.map((item) => {
                const isSkill =
                  item.kind === AgentCommandCapabilityKind.SKILL;
                const Icon = isSkill ? Sparkles : Wrench;
                const enabled =
                  capabilitySnapshotReady
                  && item.readiness === CapabilityReadinessState.READY;
                const label =
                  item.displayMetadata?.name.trim()
                  || item.sourceInstanceId
                  || item.capabilityId;
                return (
                  <button
                    key={`${item.capabilityId}@${item.capabilityVersion}`}
                    data-palette-focusable="true"
                    data-command-capability-id={item.capabilityId}
                    data-command-capability-kind={
                      isSkill ? 'skill' : 'tool'
                    }
                    disabled={!enabled}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      const nextToken = capabilityToken(label);
                      if (nextToken) onInsertCapability(nextToken);
                    }}
                    style={{
                      ...itemStyle(token.colorText),
                      opacity: enabled ? 1 : 0.52,
                      cursor: enabled ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <Icon size={15} />
                    <span style={itemTextStyle}>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <strong style={{ fontSize: 12.5 }}>{label}</strong>
                        <span
                          style={{
                            color: token.colorTextTertiary,
                            fontSize: 10.5,
                          }}
                        >
                          v{item.capabilityVersion}
                        </span>
                      </span>
                      <span style={descriptionStyle(token.colorTextSecondary)}>
                        {item.displayMetadata?.description
                          || t('chat.input.commands.noDescription')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          </>
        )}
      </div>
    </>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  paddingTop: 5,
};

const itemTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  textAlign: 'left',
};

function sectionTitleStyle(color: string): React.CSSProperties {
  return {
    color,
    fontSize: 10.5,
    fontWeight: 700,
    padding: '3px 7px',
    textTransform: 'uppercase',
  };
}

function itemStyle(color: string): React.CSSProperties {
  return {
    minHeight: 44,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    border: 0,
    borderRadius: 7,
    background: 'transparent',
    color,
    padding: '6px 8px',
    cursor: 'pointer',
  };
}

function descriptionStyle(color: string): React.CSSProperties {
  return {
    color,
    fontSize: 11,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

function iconButtonStyle(color: string): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    border: 0,
    borderRadius: 7,
    background: 'transparent',
    color,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  };
}
