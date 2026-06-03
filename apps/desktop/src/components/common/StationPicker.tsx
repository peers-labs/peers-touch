import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Server, Plus, Trash2, Check, Loader2, Circle } from 'lucide-react';
import { theme } from 'antd';
import { api } from '../../services/desktop_api';
import type { StationEntry } from '../../services/desktop_api';
import { log } from '../../utils/logger';

/**
 * StationPicker — a popover card that lets the user manage and switch
 * between known Station endpoints. Designed to sit alongside the
 * LanguageSwitcher in the Onboarding/Login bottom-right area.
 */
export function StationPicker() {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<StationEntry[]>([]);
  const [activeUrl, setActiveUrl] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [probing, setProbing] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const loadStations = useCallback(async () => {
    try {
      const result = await api.stationList();
      setEntries(result.entries ?? []);
      setActiveUrl(result.active_url ?? '');
    } catch (err) {
      log.error('StationPicker', 'Failed to load station list', { error: err });
    }
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelPos({
      top: rect.top - 4,
      left: rect.right,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    loadStations();
    updatePosition();

    const handleClickOutside = (e: MouseEvent) => {
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
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition, loadStations]);

  const handleSetActive = async (url: string) => {
    try {
      await api.stationSetActive(url);
      setActiveUrl(url);
    } catch (err) {
      log.error('StationPicker', 'Failed to set active station', { error: err });
    }
  };

  const handleAdd = async () => {
    const url = inputValue.trim();
    if (!url) return;

    setProbing(true);
    try {
      await api.stationAdd(url);
      setInputValue('');
      await loadStations();
    } catch (err) {
      log.error('StationPicker', 'Failed to add station', { error: err });
    } finally {
      setProbing(false);
    }
  };

  const handleRemove = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.stationRemove(url);
      await loadStations();
    } catch (err) {
      log.error('StationPicker', 'Failed to remove station', { error: err });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  // Display label for the trigger button
  const activeEntry = entries.find((e) => e.url === activeUrl);
  const displayLabel = activeEntry?.label || extractHost(activeUrl) || 'Station';

  return (
    <>
      <div ref={triggerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button
          onClick={() => setOpen(!open)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            background: 'transparent',
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            cursor: 'pointer',
            color: token.colorTextSecondary,
            fontSize: 13,
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = token.colorBorder;
            e.currentTarget.style.color = token.colorText;
            e.currentTarget.style.background = token.colorFillQuaternary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = token.colorBorderSecondary;
            e.currentTarget.style.color = token.colorTextSecondary;
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Server size={14} />
          <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayLabel}
          </span>
        </button>
      </div>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            transform: 'translate(-100%, -100%)',
            width: 280,
            background: token.colorBgElevated,
            borderRadius: 12,
            boxShadow: `0 8px 24px rgba(0,0,0,0.12), 0 0 0 1px ${token.colorBorderSecondary}`,
            padding: 8,
            zIndex: 10000,
          }}
        >
          {/* Header */}
          <div style={{
            padding: '6px 8px 8px',
            fontSize: 12,
            fontWeight: 500,
            color: token.colorTextTertiary,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            Station
          </div>

          {/* Station list */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {entries.map((entry) => {
              const isActive = entry.url === activeUrl;
              return (
                <button
                  key={entry.url}
                  onClick={() => handleSetActive(entry.url)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 10px',
                    background: isActive ? token.colorFillSecondary : 'transparent',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    color: isActive ? token.colorText : token.colorTextSecondary,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    fontWeight: isActive ? 500 : 400,
                    transition: 'all 0.1s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = token.colorFillQuaternary;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {/* Online indicator */}
                  <Circle
                    size={8}
                    fill={entry.online ? token.colorSuccess : token.colorTextQuaternary}
                    stroke="none"
                  />

                  {/* Label + URL */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {entry.label || extractHost(entry.url)}
                    </div>
                    {entry.label && (
                      <div style={{
                        fontSize: 11,
                        color: token.colorTextQuaternary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {entry.url}
                      </div>
                    )}
                  </div>

                  {/* Active check */}
                  {isActive && <Check size={14} style={{ flexShrink: 0 }} />}

                  {/* Remove button (only non-active) */}
                  {!isActive && (
                    <Trash2
                      size={12}
                      style={{ flexShrink: 0, opacity: 0.4, cursor: 'pointer' }}
                      onClick={(e) => handleRemove(entry.url, e)}
                      onMouseEnter={(e) => { (e.currentTarget as SVGElement).style.opacity = '1'; }}
                      onMouseLeave={(e) => { (e.currentTarget as SVGElement).style.opacity = '0.4'; }}
                    />
                  )}
                </button>
              );
            })}

            {entries.length === 0 && (
              <div style={{
                padding: '12px 10px',
                fontSize: 12,
                color: token.colorTextQuaternary,
                textAlign: 'center',
              }}>
                No stations configured
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{
            height: 1,
            background: token.colorBorderSecondary,
            margin: '6px 4px',
          }} />

          {/* Add station input */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 4px',
          }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="http://station:18080"
              disabled={probing}
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: 12,
                fontFamily: 'inherit',
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 6,
                color: token.colorText,
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = token.colorPrimary; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = token.colorBorderSecondary; }}
            />
            <button
              onClick={handleAdd}
              disabled={probing || !inputValue.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                background: token.colorPrimary,
                border: 'none',
                borderRadius: 6,
                cursor: probing || !inputValue.trim() ? 'not-allowed' : 'pointer',
                opacity: probing || !inputValue.trim() ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {probing ? (
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

function extractHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.port ? `:${u.port}` : '');
  } catch {
    return url || '';
  }
}
