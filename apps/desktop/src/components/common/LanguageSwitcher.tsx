// Compact language switcher button with dropdown.
// Used on LoginPage (top-right corner) and can be reused in Settings.
// Reads available languages from i18n service, switches on selection.
// 2026-04-09: Initial creation for i18n architecture landing.

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { theme } from 'antd';
import { getAvailableLanguages, changeLanguage } from '../../i18n';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const languages = getAvailableLanguages();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (languages.length < 2) return null;

  const current = languages.find((l) => l.code === i18n.language);
  const displayName = current?.native_name ?? current?.name ?? i18n.language;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
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
        <ChevronDown size={12} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            minWidth: 160,
            background: token.colorBgElevated,
            borderRadius: 10,
            boxShadow: `0 4px 16px rgba(0,0,0,0.1), 0 0 0 1px ${token.colorBorderSecondary}`,
            padding: 4,
            zIndex: 1000,
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
                  if (!isActive) {
                    e.currentTarget.style.background = token.colorFillQuaternary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span>{lang.native_name ?? lang.name ?? lang.code}</span>
                {isActive && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
