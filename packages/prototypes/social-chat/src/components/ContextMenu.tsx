import { useEffect, useRef, useState, type ReactNode } from 'react';
import { T } from '../theme';

interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuDivider {
  key: string;
  type: 'divider';
}

type MenuItemType = MenuItem | MenuDivider;

interface ContextMenuProps {
  items: MenuItemType[];
  onAction: (key: string) => void;
  children: ReactNode;
}

export function ContextMenu({ items, onAction, children }: ContextMenuProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - T.menuMinWidth - 16);
    const y = Math.min(e.clientY, window.innerHeight - items.length * T.menuItemHeight - 32);
    setPosition({ x, y });
    setVisible(true);
  };

  useEffect(() => {
    if (!visible) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVisible(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [visible]);

  return (
    <>
      <div onContextMenu={handleContextMenu}>{children}</div>
      {visible && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            zIndex: 9999,
            minWidth: T.menuMinWidth,
            padding: T.menuPadding,
            background: T.bgElevated,
            borderRadius: T.menuRadius,
            boxShadow: T.menuShadow,
          }}
        >
          {items.map((item) => {
            if ('type' in item && item.type === 'divider') {
              return (
                <div
                  key={item.key}
                  style={{ height: 1, background: T.borderSubtle, margin: `${T.space1}px ${T.space2}px` }}
                />
              );
            }
            const menuItem = item as MenuItem;
            return (
              <div
                key={menuItem.key}
                onClick={() => {
                  if (menuItem.disabled) return;
                  onAction(menuItem.key);
                  setVisible(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: T.space2,
                  height: T.menuItemHeight,
                  padding: `0 ${T.space3}px`,
                  borderRadius: T.radiusSm,
                  fontSize: T.fontMd,
                  color: menuItem.danger ? T.textDanger : menuItem.disabled ? T.textQuaternary : T.text,
                  cursor: menuItem.disabled ? 'not-allowed' : 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!menuItem.disabled) (e.currentTarget.style.background = T.bgHover);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {menuItem.icon && (
                  <span style={{ display: 'flex', width: 16, height: 16, opacity: 0.8 }}>
                    {menuItem.icon}
                  </span>
                )}
                <span>{menuItem.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
