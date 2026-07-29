import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { Check, X, AlertCircle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let listeners: Array<(item: ToastItem) => void> = [];
let nextId = 0;

export function toast(type: ToastType, message: string) {
  const item: ToastItem = { id: nextId++, type, message };
  listeners.forEach((fn) => fn(item));
}

toast.success = (message: string) => toast('success', message);
toast.error = (message: string) => toast('error', message);
toast.info = (message: string) => toast('info', message);

const COLORS: Record<ToastType, string> = {
  success: '#34a853',
  error: '#ea4335',
  info: '#4a6cf7',
};

const ICONS: Record<ToastType, typeof Check> = {
  success: Check,
  error: X,
  info: AlertCircle,
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (item: ToastItem) => {
      setItems((prev) => [...prev, item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }, 2200);
    };
    listeners.push(handler);
    return () => { listeners = listeners.filter((l) => l !== handler); };
  }, []);

  if (!items.length) return null;

  return (
    <div style={S.host}>
      {items.map((item) => {
        const Icon = ICONS[item.type];
        return (
          <div key={item.id} style={{ ...S.pill, background: COLORS[item.type] }}>
            <Icon size={14} color="#fff" />
            <span style={S.text}>{item.message}</span>
          </div>
        );
      })}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  host: {
    position: 'absolute',
    top: 14,
    right: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    zIndex: 9999,
    pointerEvents: 'none',
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,.12)',
    pointerEvents: 'auto',
  },
  text: {
    fontSize: 13,
    fontWeight: 500,
    color: '#fff',
    whiteSpace: 'nowrap',
  },
};
