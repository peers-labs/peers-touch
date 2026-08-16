import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Loader2, Plus, Server, Trash2 } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/desktop_api';
import type { StationEntry, StationProbeResult } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { dispatchStationActiveChanged } from './stationRegistryEvents';

type StationHealthStatus = 'unknown' | 'checking' | 'online' | 'offline';

interface StationHealth {
  status: StationHealthStatus;
  lastProbe?: string;
}

type DesignToken = ReturnType<typeof theme.useToken>['token'];

const PANEL_WIDTH = 312;
const COPY_CONFIRM_MS = 1200;
const TRIGGER_WIDTH = 180;
const TRIGGER_STATUS_SLOT_SIZE = 16;

/**
 * StationPicker — a popover card that lets the user manage and switch
 * between known Station endpoints. Designed to sit alongside the
 * LanguageSwitcher in the Onboarding/Login bottom-right area.
 */
export function StationPicker() {
  const { token } = theme.useToken();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<StationEntry[]>([]);
  const [healthByUrl, setHealthByUrl] = useState<Record<string, StationHealth>>({});
  const [activeUrl, setActiveUrl] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const [hoveredUrl, setHoveredUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const probeRequestRef = useRef(0);
  const copyResetTimerRef = useRef<number | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; openRight: boolean }>({ top: 0, left: 0, openRight: true });

  const probeStations = useCallback(async (
    stationEntries: StationEntry[],
    selectedUrl: string,
    requestId: number,
  ) => {
    const orderedEntries = [...stationEntries].sort((a, b) => {
      if (a.url === selectedUrl) return -1;
      if (b.url === selectedUrl) return 1;
      return 0;
    });

    setHealthByUrl((prev) => {
      const next = { ...prev };
      for (const entry of orderedEntries) {
        next[entry.url] = { ...next[entry.url], status: 'checking' };
      }
      return next;
    });

    await Promise.all(orderedEntries.map(async (entry) => {
      try {
        const result = await api.stationProbe(entry.url);
        if (probeRequestRef.current !== requestId) return;

        setEntries((current) => mergeProbeResult(current, entry.url, result));
        setHealthByUrl((prev) => ({
          ...prev,
          [entry.url]: {
            status: result.online ? 'online' : 'offline',
            lastProbe: new Date().toISOString(),
          },
        }));
      } catch (err) {
        if (probeRequestRef.current !== requestId) return;
        log.warn('StationPicker', 'Failed to probe station', { url: entry.url, error: err });
        setHealthByUrl((prev) => ({
          ...prev,
          [entry.url]: {
            status: 'offline',
            lastProbe: new Date().toISOString(),
          },
        }));
      }
    }));
  }, []);

  const loadStations = useCallback(async (probeFresh = false) => {
    const requestId = ++probeRequestRef.current;
    try {
      const result = await api.stationList();
      if (probeRequestRef.current !== requestId) return;

      const nextEntries = result.entries ?? [];
      const nextActiveUrl = result.active_url ?? '';
      setEntries(nextEntries);
      setActiveUrl(nextActiveUrl);
      setHealthByUrl((prev) => seedHealthFromEntries(prev, nextEntries));

      if (probeFresh && nextEntries.length > 0) {
        await probeStations(nextEntries, nextActiveUrl, requestId);
      }
    } catch (err) {
      log.error('StationPicker', 'Failed to load station list', { error: err });
    }
  }, [probeStations]);

  useEffect(() => {
    void loadStations(false);
  }, [loadStations]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right;
    const openRight = spaceRight >= PANEL_WIDTH;
    setPanelPos({
      top: rect.top - 4,
      left: openRight ? rect.left : rect.right,
      openRight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadStations(true);
    updatePosition();

    const handleClickOutside = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', updatePosition);
    return () => {
      probeRequestRef.current += 1;
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition, loadStations]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleSetActive = async (url: string) => {
    try {
      await api.stationSetActive(url);
      setActiveUrl(url);
      const entry = entries.find((item) => item.url === url);
      dispatchStationActiveChanged({ url, label: entry?.label });
      if (entry) {
        const requestId = ++probeRequestRef.current;
        void probeStations([entry], url, requestId);
      }
    } catch (err) {
      log.error('StationPicker', 'Failed to set active station', { error: err });
    }
  };

  const handleAdd = async () => {
    const url = inputValue.trim();
    if (!url) return;

    setAdding(true);
    try {
      await api.stationAdd(url);
      setInputValue('');
      await loadStations(true);
    } catch (err) {
      log.error('StationPicker', 'Failed to add station', { error: err });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (url: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    try {
      await api.stationRemove(url);
      await loadStations(true);
    } catch (err) {
      log.error('StationPicker', 'Failed to remove station', { error: err });
    }
  };

  const handleCopy = async (url: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    try {
      await writeClipboardText(url);
      setCopiedUrl(url);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedUrl(null);
        copyResetTimerRef.current = null;
      }, COPY_CONFIRM_MS);
    } catch (err) {
      log.error('StationPicker', 'Failed to copy station URL', { url, error: err });
    }
  };

  const handleInputKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void handleAdd();
  };

  const handleRowKeyDown = (url: string, e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void handleSetActive(url);
    }
  };

  const selectedUrl = activeUrl || (entries.length === 1 ? entries[0]?.url ?? '' : '');
  const activeEntry = entries.find((e) => e.url === selectedUrl);
  const activeHealth = selectedUrl ? healthByUrl[selectedUrl]?.status ?? statusFromEntry(activeEntry) : 'unknown';
  const displayLabel = activeEntry?.label || extractHost(selectedUrl) || t('common.stationPicker.fallbackLabel');

  return (
    <>
      <div ref={triggerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <StationPickerTrigger
          token={token}
          open={open}
          hovered={triggerHovered}
          label={displayLabel}
          status={activeHealth}
          statusText={statusLabel(activeHealth, t)}
          triggerLabel={t('common.stationPicker.triggerLabel')}
          onToggle={() => setOpen(!open)}
          onMouseEnter={() => setTriggerHovered(true)}
          onMouseLeave={() => setTriggerHovered(false)}
        />
      </div>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            transform: panelPos.openRight ? 'translate(0, -100%)' : 'translate(-100%, -100%)',
            width: PANEL_WIDTH,
            background: token.colorBgElevated,
            borderRadius: 18,
            boxShadow: `0 18px 48px rgba(15, 23, 42, 0.16), 0 0 0 1px ${token.colorBorderSecondary}`,
            padding: 10,
            zIndex: 10000,
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 6px 10px',
          }}>
            <div>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: token.colorTextTertiary,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}>
                {t('common.stationPicker.title')}
              </div>
              <div style={{ marginTop: 2, fontSize: 11, color: token.colorTextQuaternary }}>
                {t('common.stationPicker.subtitle')}
              </div>
            </div>
          </div>

          <div style={{ maxHeight: 228, overflowY: 'auto', paddingRight: 2 }}>
            {entries.map((entry) => {
              const isActive = entry.url === activeUrl;
              const health = healthByUrl[entry.url]?.status ?? statusFromEntry(entry);
              const rowHovered = hoveredUrl === entry.url;
              return (
                <StationRow
                  key={entry.url}
                  entry={entry}
                  isActive={isActive}
                  isHovered={rowHovered}
                  status={health}
                  token={token}
                  statusText={statusLabel(health, t)}
                  selectedText={t('common.stationPicker.selected')}
                  isCopied={copiedUrl === entry.url}
                  copyLabel={t('common.stationPicker.copyLabel', { station: entry.label || extractHost(entry.url) })}
                  copiedLabel={t('common.stationPicker.copiedLabel')}
                  removeLabel={t('common.stationPicker.removeLabel', { station: entry.label || extractHost(entry.url) })}
                  onClick={() => void handleSetActive(entry.url)}
                  onKeyDown={(e) => handleRowKeyDown(entry.url, e)}
                  onMouseEnter={() => setHoveredUrl(entry.url)}
                  onMouseLeave={() => setHoveredUrl(null)}
                  onCopy={(e) => void handleCopy(entry.url, e)}
                  onRemove={(e) => void handleRemove(entry.url, e)}
                />
              );
            })}

            {entries.length === 0 && (
              <div style={{
                padding: '18px 10px',
                fontSize: 12,
                color: token.colorTextQuaternary,
                textAlign: 'center',
              }}>
                {t('common.stationPicker.empty')}
              </div>
            )}
          </div>

          <div style={{
            height: 1,
            background: token.colorBorderSecondary,
            margin: '10px 4px',
          }} />

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px',
            background: inputFocused ? token.colorBgContainer : token.colorFillQuaternary,
            border: `1px solid ${inputFocused ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
            borderRadius: 12,
            boxShadow: inputFocused ? `0 0 0 3px ${token.colorPrimaryBg}` : 'none',
            transition: 'background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease',
          }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={t('common.stationPicker.placeholder')}
              disabled={adding}
              aria-label={t('common.stationPicker.inputLabel')}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '7px 8px',
                fontSize: 12,
                fontFamily: 'inherit',
                background: 'transparent',
                border: 'none',
                color: token.colorText,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={adding || !inputValue.trim()}
              aria-label={t('common.stationPicker.addLabel')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                background: token.colorPrimary,
                border: 'none',
                borderRadius: 9,
                cursor: adding || !inputValue.trim() ? 'not-allowed' : 'pointer',
                opacity: adding || !inputValue.trim() ? 0.5 : 1,
                transition: 'opacity 0.15s',
                flexShrink: 0,
              }}
            >
              {adding ? (
                <Loader2 size={14} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Plus size={14} color="#fff" />
              )}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function StationPickerTrigger(props: {
  token: DesignToken;
  open: boolean;
  hovered: boolean;
  label: string;
  status: StationHealthStatus;
  statusText: string;
  triggerLabel: string;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const {
    token,
    open,
    hovered,
    label,
    status,
    statusText,
    triggerLabel,
    onToggle,
    onMouseEnter,
    onMouseLeave,
  } = props;

  return (
    <button
      type="button"
      data-station-picker-trigger
      onClick={onToggle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-label={triggerLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: TRIGGER_WIDTH,
        padding: '6px 10px',
        background: hovered || open ? token.colorFillQuaternary : token.colorBgContainer,
        border: `1px solid ${open ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
        borderRadius: 10,
        boxShadow: open ? `0 0 0 3px ${token.colorPrimaryBg}` : 'none',
        cursor: 'pointer',
        color: hovered || open ? token.colorText : token.colorTextSecondary,
        fontSize: 12,
        fontFamily: 'inherit',
        transition: 'background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, color 0.16s ease',
      }}
    >
      <Server size={14} style={{ flexShrink: 0 }} />
      <span style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        textAlign: 'left',
      }}>
        {label}
      </span>
      <StationTriggerStatus
        status={status}
        token={token}
        label={statusText}
      />
    </button>
  );
}

function StationTriggerStatus(props: {
  status: StationHealthStatus;
  token: DesignToken;
  label: string;
}) {
  const { status, token, label } = props;

  if (status === 'unknown') {
    return (
      <span
        aria-hidden="true"
        style={{ width: TRIGGER_STATUS_SLOT_SIZE, height: TRIGGER_STATUS_SLOT_SIZE, flexShrink: 0 }}
      />
    );
  }

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      width: TRIGGER_STATUS_SLOT_SIZE,
      height: TRIGGER_STATUS_SLOT_SIZE,
      flexShrink: 0,
    }}>
      <StationStatusDot status={status} token={token} label={label} compact />
    </span>
  );
}

function StationRow(props: {
  entry: StationEntry;
  isActive: boolean;
  isHovered: boolean;
  status: StationHealthStatus;
  token: DesignToken;
  statusText: string;
  selectedText: string;
  isCopied: boolean;
  copyLabel: string;
  copiedLabel: string;
  removeLabel: string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onCopy: (event: ReactMouseEvent) => void;
  onRemove: (event: ReactMouseEvent) => void;
}) {
  const {
    entry,
    isActive,
    isHovered,
    status,
    token,
    statusText,
    selectedText,
    isCopied,
    copyLabel,
    copiedLabel,
    removeLabel,
    onClick,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
    onCopy,
    onRemove,
  } = props;
  const title = entry.label || extractHost(entry.url);
  const subtitle = entry.label ? extractHost(entry.url) : entry.url;
  const showRemove = !isActive && isHovered;
  const showCopy = isActive || isHovered || isCopied;
  const background = isActive
    ? token.colorPrimaryBg
    : isHovered
      ? token.colorFillQuaternary
      : 'transparent';
  const borderColor = isActive ? token.colorPrimaryBorder : 'transparent';

  return (
    <div
      role="button"
      data-station-url={entry.url}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        minHeight: 48,
        padding: '8px 9px',
        marginBottom: 4,
        background,
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        cursor: 'pointer',
        color: isActive ? token.colorText : token.colorTextSecondary,
        fontFamily: 'inherit',
        textAlign: 'left',
        outline: 'none',
        transition: 'background 0.14s ease, border-color 0.14s ease, color 0.14s ease',
      }}
    >
      <StationStatusDot status={status} token={token} label={statusText} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}>
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: isActive ? 650 : 520,
          }}>
            {title}
          </span>
          {isActive && (
            <span style={{
              flexShrink: 0,
              padding: '1px 6px',
              borderRadius: 999,
              background: token.colorBgContainer,
              color: token.colorPrimary,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '16px',
            }}>
              {selectedText}
            </span>
          )}
        </div>
        <div style={{
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 11,
          color: token.colorTextQuaternary,
        }}>
          {subtitle}
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
      }}>
        <StationIconAction
          token={token}
          visible={showCopy}
          active={isCopied}
          label={isCopied ? copiedLabel : copyLabel}
          onClick={onCopy}
          icon={isCopied
            ? <Check size={13} />
            : <Copy size={13} />}
        />
        {!isActive && (
          <StationIconAction
            token={token}
            visible={showRemove}
            label={removeLabel}
            onClick={onRemove}
            icon={<Trash2 size={13} />}
          />
        )}
      </div>
    </div>
  );
}

function StationIconAction(props: {
  token: DesignToken;
  visible: boolean;
  active?: boolean;
  label: string;
  icon: ReactNode;
  onClick: (event: ReactMouseEvent) => void;
}) {
  const { token, visible, active = false, label, icon, onClick } = props;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        border: 'none',
        borderRadius: 8,
        background: visible ? token.colorFillSecondary : 'transparent',
        color: active ? token.colorSuccess : visible ? token.colorTextSecondary : 'transparent',
        cursor: visible ? 'pointer' : 'default',
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'background 0.14s ease, color 0.14s ease',
      }}
    >
      {icon}
    </button>
  );
}

function StationStatusDot(props: {
  status: StationHealthStatus;
  token: DesignToken;
  label: string;
  compact?: boolean;
}) {
  const { status, token, label, compact = false } = props;
  const size = compact ? 7 : 9;
  const palette = statusPalette(status, token);

  if (status === 'checking') {
    return (
      <Loader2
        size={compact ? 12 : 14}
        aria-label={label}
        style={{
          flexShrink: 0,
          color: palette.fill,
          animation: 'spin 1s linear infinite',
        }}
      />
    );
  }

  return (
    <span
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: compact ? 12 : 16,
        height: compact ? 12 : 16,
        flexShrink: 0,
        borderRadius: 999,
        background: palette.halo,
      }}
    >
      <span style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: palette.fill,
        boxShadow: status === 'online' ? `0 0 0 2px ${token.colorBgElevated}` : 'none',
      }} />
    </span>
  );
}

function seedHealthFromEntries(
  previous: Record<string, StationHealth>,
  entries: StationEntry[],
): Record<string, StationHealth> {
  const next: Record<string, StationHealth> = {};
  for (const entry of entries) {
    next[entry.url] = previous[entry.url] ?? {
      status: statusFromEntry(entry),
      lastProbe: entry.last_probe,
    };
  }
  return next;
}

function mergeProbeResult(
  entries: StationEntry[],
  url: string,
  result: StationProbeResult,
): StationEntry[] {
  return entries.map((entry) => {
    if (entry.url !== url) return entry;
    return {
      ...entry,
      label: result.label ?? entry.label,
      peer_id: result.peer_id ?? entry.peer_id,
      peers_count: result.peers_count ?? entry.peers_count,
      online: result.online,
      last_probe: new Date().toISOString(),
    };
  });
}

function statusFromEntry(entry?: StationEntry): StationHealthStatus {
  if (!entry || !entry.last_probe) return 'unknown';
  return entry.online ? 'online' : 'offline';
}

function statusPalette(status: StationHealthStatus, token: DesignToken): { fill: string; halo: string } {
  const palettes: Record<StationHealthStatus, { fill: string; halo: string }> = {
    online: { fill: token.colorSuccess, halo: token.colorSuccessBg },
    checking: { fill: token.colorPrimary, halo: token.colorPrimaryBg },
    offline: { fill: token.colorError, halo: token.colorErrorBg },
    unknown: { fill: token.colorTextQuaternary, halo: token.colorFillSecondary },
  };
  return palettes[status];
}

function statusLabel(status: StationHealthStatus, t: (key: string) => string): string {
  return t(`common.stationPicker.status.${status}`);
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('clipboard copy command failed');
  } finally {
    document.body.removeChild(textarea);
  }
}

function extractHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.port ? `:${u.port}` : '');
  } catch {
    return url || '';
  }
}
