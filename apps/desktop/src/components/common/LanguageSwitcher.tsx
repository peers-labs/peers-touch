import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { theme } from 'antd';
import { getAvailableLanguages, changeLanguage } from '../../i18n';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const languages = getAvailableLanguages();

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
  }, [open, updatePosition]);

  if (languages.length < 2) return null;

  const current = languages.find((l) => l.code === i18n.language);
  const displayName = current?.native_name ?? current?.name ?? i18n.language;

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
          <Globe size={14} />
          <span>{displayName}</span>
          <ChevronDown size={12} style={{ opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
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
            minWidth: 160,
            background: token.colorBgElevated,
            borderRadius: 10,
            boxShadow: `0 4px 16px rgba(0,0,0,0.1), 0 0 0 1px ${token.colorBorderSecondary}`,
            padding: 4,
            zIndex: 10000,
          }}
        >
          {languages.map((lang) => {
            const isActive = lang.code === i18n.language;
            return (
              <button
                key={lang.code}
                onClick={() => {
                  changeLanguage(lang.code);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '8px 12px',
                  background: isActive ? token.colorFillSecondary : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: isActive ? token.colorText : token.colorTextSecondary,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  fontWeight: isActive ? 500 : 400,
                  transition: 'all 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = token.colorFillQuaternary;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span>{lang.native_name ?? lang.name ?? lang.code}</span>
                {isActive && <Check size={14} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
