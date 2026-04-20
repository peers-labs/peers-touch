/**
 * Main dashboard layout with sidebar navigation and content area.
 * Uses the hash router to switch between different dashboard pages.
 *
 * Replaced: 2026-04-10 — Upgraded from plain HTML layout to themed
 * antd/react-layout-kit layout with icons, dropdown user menu, and
 * proper PageRouter-based content switching.
 */

import { theme, Tooltip, Dropdown, Avatar, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  LayoutDashboard, Users, Key, Globe, Server,
  HardDrive, Shield, Monitor, FileText, LogOut,
  Settings, UserCircle, Network,
} from 'lucide-react';
import { useHashRouter } from '../hooks/useHashRouter';
import { useAuthStore } from '../store/auth';
import { PAGES, type Page } from '../utils/constants';
import PageRouter from './PageRouter';

const { Text } = Typography;

/** Sidebar navigation item shape. */
interface NavItem {
  key: Page;
  icon: React.ReactNode;
  label: string;
}

/**
 * Top-level navigation entries.
 * Each entry maps to a page key, a lucide-react icon, and a display label.
 */
const NAV_ITEMS: NavItem[] = [
  { key: PAGES.OVERVIEW,    icon: <LayoutDashboard size={20} />, label: 'Overview' },
  { key: PAGES.TRANSPORT,   icon: <Network size={20} />,         label: 'Transport' },
  { key: PAGES.ACTORS,      icon: <Users size={20} />,           label: 'Actors' },
  { key: PAGES.SESSIONS,    icon: <Key size={20} />,             label: 'Sessions' },
  { key: PAGES.NODES,       icon: <Network size={20} />,         label: 'Nodes' },
  { key: PAGES.SUBSERVERS,  icon: <Server size={20} />,          label: 'Services' },
  { key: PAGES.FEDERATION,  icon: <Globe size={20} />,           label: 'Federation' },
  { key: PAGES.STORAGE,     icon: <HardDrive size={20} />,       label: 'Storage' },
  { key: PAGES.SECURITY,    icon: <Shield size={20} />,          label: 'Security' },
  { key: PAGES.SYSTEM,      icon: <Monitor size={20} />,         label: 'System' },
  { key: PAGES.LOGS,        icon: <FileText size={20} />,        label: 'Logs' },
];

export default function DashboardLayout() {
  const { page, navigateTo } = useHashRouter();
  const { admin, logout } = useAuthStore();
  const { token } = theme.useToken();

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'profile',
      label: admin?.display_name || admin?.username || 'Admin',
      disabled: true,
    },
    { type: 'divider' },
    { key: 'settings', icon: <Settings size={14} />, label: 'Settings' },
    { key: 'logout', icon: <LogOut size={14} />, label: 'Logout', danger: true },
  ];

  const onDropdownClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'logout') logout();
    if (key === 'settings') navigateTo(PAGES.SECURITY);
  };

  return (
    <Flexbox horizontal style={{ height: '100vh', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <Flexbox
        gap={4}
        style={{
          width: 220,
          minWidth: 220,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          padding: '16px 8px',
          overflow: 'auto',
        }}
      >
        {/* Brand header */}
        <Flexbox
          align="center"
          gap={8}
          horizontal
          style={{ padding: '8px 12px', marginBottom: 8 }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: token.colorPrimary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Monitor size={18} color="#fff" />
          </div>
          <Text strong style={{ fontSize: 14 }}>Station Dashboard</Text>
        </Flexbox>

        {/* Navigation items */}
        <Flexbox gap={2} style={{ flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            const isActive = page === item.key;

            return (
              <Tooltip
                key={item.key}
                title={item.label}
                placement="right"
                mouseEnterDelay={0.5}
              >
                <Flexbox
                  horizontal
                  align="center"
                  gap={10}
                  onClick={() => navigateTo(item.key)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: token.borderRadius,
                    cursor: 'pointer',
                    background: isActive ? token.colorPrimaryBg : 'transparent',
                    color: isActive ? token.colorPrimary : token.colorText,
                    fontWeight: isActive ? 600 : 400,
                    transition: 'all 0.2s',
                    fontSize: 13,
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Flexbox>
              </Tooltip>
            );
          })}
        </Flexbox>

        {/* User section with dropdown menu */}
        <Dropdown
          menu={{ items: dropdownItems, onClick: onDropdownClick }}
          trigger={['click']}
        >
          <Flexbox
            horizontal
            align="center"
            gap={10}
            style={{
              padding: '10px 12px',
              borderRadius: token.borderRadius,
              cursor: 'pointer',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              marginTop: 8,
            }}
          >
            <Avatar
              size={28}
              style={{ background: token.colorPrimary, flexShrink: 0 }}
            >
              <UserCircle size={16} />
            </Avatar>

            <Flexbox style={{ overflow: 'hidden', flex: 1 }}>
              <Text strong style={{ fontSize: 12 }} ellipsis>
                {admin?.display_name || admin?.username}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {admin?.role === 'super' ? 'Super Admin' : 'Admin'}
              </Text>
            </Flexbox>
          </Flexbox>
        </Dropdown>
      </Flexbox>

      {/* ── Content area ── */}
      <Flexbox style={{ flex: 1, overflow: 'auto', background: token.colorBgLayout }}>
        <PageRouter page={page} />
      </Flexbox>
    </Flexbox>
  );
}
