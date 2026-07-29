import { useState } from 'react';
import {
  Cpu,
  Database,
  FileText,
  Globe,
  HardDrive,
  LayoutDashboard,
  Lock,
  Monitor,
  Network,
  Radio,
  Server,
  Shield,
  Users,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Activity,
  Zap,
  Settings,
  ChevronRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Token Palette — mirrors desktop shell design tokens
// ---------------------------------------------------------------------------

const T = {
  primary: '#6b5bd6',
  primaryLight: '#8b7fe8',
  primaryBg: '#f3f1fd',
  bg: '#ffffff',
  pageBg: '#f7f8fa',
  navBg: '#1a1a2e',
  navHover: '#252545',
  navActive: '#6b5bd6',
  navText: '#a0a0c0',
  navTextActive: '#ffffff',
  border: '#e8e8e8',
  borderLight: '#f0f0f0',
  text: '#1a1a2e',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  success: '#10b981',
  successBg: '#ecfdf5',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  danger: '#ef4444',
  dangerBg: '#fef2f2',
  info: '#3b82f6',
  infoBg: '#eff6ff',
  radius: 8,
  radiusLg: 12,
  shadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  shadowMd: '0 4px 6px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.04)',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

// ---------------------------------------------------------------------------
// Navigation Definition
// ---------------------------------------------------------------------------

type PageId =
  | 'overview'
  | 'transport'
  | 'actors'
  | 'sessions'
  | 'nodes'
  | 'services'
  | 'storage'
  | 'oss'
  | 'security'
  | 'access-gates'
  | 'system'
  | 'logs'
  | 'federation';

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'transport', label: 'Transport', icon: Radio },
  { id: 'actors', label: 'Actors', icon: Users },
  { id: 'sessions', label: 'Sessions', icon: Monitor },
  { id: 'nodes', label: 'Nodes', icon: Network },
  { id: 'services', label: 'Services', icon: Server },
  { id: 'storage', label: 'Storage', icon: Database },
  { id: 'oss', label: 'OSS', icon: HardDrive },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'access-gates', label: 'Access Gates', icon: Lock },
  { id: 'system', label: 'System', icon: Cpu },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'federation', label: 'Federation', icon: Globe },
];

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_OVERVIEW = {
  stats: [
    { label: 'Total Actors', value: '2,847', change: '+12', icon: Users },
    { label: 'Active Actors', value: '1,203', change: '+5.2%', icon: Activity },
    { label: 'New Today', value: '34', change: '+8', icon: ArrowUpRight },
    { label: 'Peer Nodes', value: '18', change: '+2', icon: Network },
    { label: 'Services', value: '7', change: 'stable', icon: Server },
    { label: 'Posts (7d)', value: '14,582', change: '+22%', icon: FileText },
  ],
  recentActors: [
    { ptid: 'pt:actor:a8f2c91d', name: 'Alice Chen', created: '2026-07-21 09:14', status: 'active' },
    { ptid: 'pt:actor:b3e7d4a0', name: 'Bob Martinez', created: '2026-07-21 08:42', status: 'active' },
    { ptid: 'pt:actor:c1f9e82b', name: 'Carla Wang', created: '2026-07-20 22:31', status: 'active' },
    { ptid: 'pt:actor:d4a6b3c7', name: 'David Kumar', created: '2026-07-20 18:05', status: 'pending' },
    { ptid: 'pt:actor:e9c2f1d8', name: 'Eva Johansson', created: '2026-07-20 16:49', status: 'active' },
  ],
  recentAudit: [
    { time: '09:14:22', admin: 'root', action: 'actor.approve', resource: 'pt:actor:a8f2c91d', detail: 'Auto-approved via open gate' },
    { time: '08:55:01', admin: 'root', action: 'service.restart', resource: 'transport-relay', detail: 'Scheduled maintenance' },
    { time: '08:42:18', admin: 'root', action: 'actor.approve', resource: 'pt:actor:b3e7d4a0', detail: 'Auto-approved via open gate' },
    { time: '07:30:00', admin: 'system', action: 'backup.complete', resource: 'pg-main', detail: 'Daily backup successful' },
    { time: '06:00:00', admin: 'system', action: 'cert.renew', resource: 'tls-primary', detail: 'Certificate renewed, expires 2026-10-19' },
  ],
};

const MOCK_TRANSPORT = {
  stats: [
    { label: 'Active Sessions', value: '342', icon: Monitor },
    { label: 'Messages (1h)', value: '8,941', icon: Zap },
    { label: 'Outbox Depth', value: '12', icon: Clock },
    { label: 'Attachments Queued', value: '3', icon: HardDrive },
  ],
  sse: {
    connections: 284,
    eventsPerSec: 47,
    avgLatency: '12ms',
    status: 'healthy',
  },
  recentMessages: [
    { id: 'msg:f8a2c1d3', from: 'pt:actor:a8f2c91d', to: 'pt:actor:b3e7d4a0', type: 'text', size: '1.2 KB', time: '09:14:22', delivered: true },
    { id: 'msg:e7b3d2e4', from: 'pt:actor:c1f9e82b', to: 'pt:actor:e9c2f1d8', type: 'image', size: '842 KB', time: '09:13:58', delivered: true },
    { id: 'msg:d6c4e3f5', from: 'pt:actor:f7d8a9e1', to: 'pt:actor:a8f2c91d', type: 'text', size: '0.4 KB', time: '09:13:41', delivered: true },
    { id: 'msg:c5d5f4a6', from: 'pt:actor:b3e7d4a0', to: 'pt:actor:h5e7f9a1', type: 'file', size: '4.5 MB', time: '09:12:09', delivered: false },
    { id: 'msg:b4e6a5b7', from: 'pt:actor:e9c2f1d8', to: 'pt:actor:c1f9e82b', type: 'text', size: '0.8 KB', time: '09:11:44', delivered: true },
    { id: 'msg:a3f7b6c8', from: 'pt:actor:h5e7f9a1', to: 'pt:actor:f7d8a9e1', type: 'voice', size: '128 KB', time: '09:10:22', delivered: true },
  ],
  outbox: [
    { id: 'out:001', target: 'peer:node:2e7g6b05', messages: 8, oldest: '2m ago', reason: 'Peer degraded' },
    { id: 'out:002', target: 'peer:node:3f8h7c16', messages: 4, oldest: '15m ago', reason: 'Peer offline' },
  ],
};

const MOCK_ACTORS = [
  { ptid: 'pt:actor:a8f2c91d', name: 'Alice Chen', created: '2026-07-21 09:14', status: 'active' },
  { ptid: 'pt:actor:b3e7d4a0', name: 'Bob Martinez', created: '2026-07-21 08:42', status: 'active' },
  { ptid: 'pt:actor:c1f9e82b', name: 'Carla Wang', created: '2026-07-20 22:31', status: 'active' },
  { ptid: 'pt:actor:d4a6b3c7', name: 'David Kumar', created: '2026-07-20 18:05', status: 'pending' },
  { ptid: 'pt:actor:e9c2f1d8', name: 'Eva Johansson', created: '2026-07-20 16:49', status: 'active' },
  { ptid: 'pt:actor:f7d8a9e1', name: 'Frank Liu', created: '2026-07-20 14:22', status: 'active' },
  { ptid: 'pt:actor:g2b4c6d8', name: 'Grace Okafor', created: '2026-07-19 11:38', status: 'suspended' },
  { ptid: 'pt:actor:h5e7f9a1', name: 'Henry Patel', created: '2026-07-19 09:15', status: 'active' },
];

const MOCK_SESSIONS = [
  { actor: 'Alice Chen', device: 'Desktop', userAgent: 'Peers-Desktop/1.4.2 (macOS 15.2)', lastActive: '2 min ago', ip: '192.168.1.42' },
  { actor: 'Bob Martinez', device: 'Mobile', userAgent: 'Peers-Mobile/2.1.0 (iOS 19.0)', lastActive: '5 min ago', ip: '10.0.0.88' },
  { actor: 'Carla Wang', device: 'Desktop', userAgent: 'Peers-Desktop/1.4.2 (Windows 11)', lastActive: '12 min ago', ip: '172.16.0.15' },
  { actor: 'Eva Johansson', device: 'Desktop', userAgent: 'Peers-Desktop/1.4.1 (Linux 6.8)', lastActive: '18 min ago', ip: '192.168.2.71' },
  { actor: 'Frank Liu', device: 'Mobile', userAgent: 'Peers-Mobile/2.1.0 (Android 16)', lastActive: '25 min ago', ip: '10.0.1.33' },
  { actor: 'Henry Patel', device: 'Web', userAgent: 'Chrome/127.0 (macOS 15.2)', lastActive: '31 min ago', ip: '192.168.1.99' },
];

const MOCK_NODES = [
  { peerId: 'peer:node:7f3a2c91', address: 'station-alpha.peers.network:8443', lastSeen: '30s ago', status: 'online' },
  { peerId: 'peer:node:8b4d3e72', address: 'station-beta.example.com:8443', lastSeen: '45s ago', status: 'online' },
  { peerId: 'peer:node:9c5e4f83', address: 'relay-eu.peers.network:8443', lastSeen: '1m ago', status: 'online' },
  { peerId: 'peer:node:1d6f5a94', address: 'station-gamma.local:8443', lastSeen: '2m ago', status: 'online' },
  { peerId: 'peer:node:2e7g6b05', address: 'relay-asia.peers.network:8443', lastSeen: '5m ago', status: 'degraded' },
  { peerId: 'peer:node:3f8h7c16', address: 'station-delta.corp.io:8443', lastSeen: '15m ago', status: 'offline' },
];

const MOCK_SERVICES = [
  { name: 'actor-server', type: 'DDD Subserver', status: 'running', port: 8081 },
  { name: 'transport-relay', type: 'DDD Subserver', status: 'running', port: 8082 },
  { name: 'ai-chat-server', type: 'DDD Subserver', status: 'running', port: 8083 },
  { name: 'oss-server', type: 'DDD Subserver', status: 'running', port: 8084 },
  { name: 'access-gate-server', type: 'DDD Subserver', status: 'running', port: 8085 },
  { name: 'federation-server', type: 'DDD Subserver', status: 'running', port: 8086 },
  { name: 'agent-server', type: 'DDD Subserver', status: 'stopped', port: 8087 },
];

const MOCK_STORAGE = {
  driver: 'PostgreSQL 16.3',
  host: 'localhost:5432',
  database: 'peers_station',
  poolSize: 25,
  activeConns: 8,
  idleConns: 17,
  tables: [
    { name: 'actors', rows: 2847 },
    { name: 'sessions', rows: 1842 },
    { name: 'messages', rows: 482910 },
    { name: 'attachments', rows: 12458 },
    { name: 'audit_logs', rows: 89231 },
    { name: 'federation_memberships', rows: 34 },
    { name: 'access_gate_invites', rows: 156 },
  ],
};

const MOCK_OSS = {
  buckets: [
    { name: 'avatars', objects: 2841, size: '1.2 GB', created: '2026-01-15', access: 'public-read' },
    { name: 'attachments', objects: 12458, size: '28.4 GB', created: '2026-01-15', access: 'private' },
    { name: 'media', objects: 5621, size: '45.8 GB', created: '2026-02-01', access: 'private' },
    { name: 'backups', objects: 365, size: '12.1 GB', created: '2026-01-15', access: 'private' },
    { name: 'federation-sync', objects: 891, size: '2.3 GB', created: '2026-03-20', access: 'federation' },
  ],
  objects: [
    { key: 'avatars/a8f2c91d.webp', bucket: 'avatars', size: '48 KB', modified: '2026-07-21 09:14', contentType: 'image/webp' },
    { key: 'attachments/msg-f8a2c1d3/photo.jpg', bucket: 'attachments', size: '842 KB', modified: '2026-07-21 09:13', contentType: 'image/jpeg' },
    { key: 'media/post-a1b2c3/video.mp4', bucket: 'media', size: '12.4 MB', modified: '2026-07-20 18:22', contentType: 'video/mp4' },
    { key: 'backups/2026-07-21-daily.tar.gz', bucket: 'backups', size: '2.1 GB', modified: '2026-07-21 07:30', contentType: 'application/gzip' },
    { key: 'federation-sync/alpha/manifest.json', bucket: 'federation-sync', size: '4.2 KB', modified: '2026-07-21 09:00', contentType: 'application/json' },
  ],
  audit: [
    { time: '2026-07-21 09:14', actor: 'pt:actor:a8f2c91d', operation: 'PUT', key: 'avatars/a8f2c91d.webp', status: 'success' },
    { time: '2026-07-21 09:13', actor: 'pt:actor:c1f9e82b', operation: 'PUT', key: 'attachments/msg-f8a2c1d3/photo.jpg', status: 'success' },
    { time: '2026-07-21 08:45', actor: 'system', operation: 'DELETE', key: 'backups/2026-07-07-daily.tar.gz', status: 'success' },
    { time: '2026-07-21 07:30', actor: 'system', operation: 'PUT', key: 'backups/2026-07-21-daily.tar.gz', status: 'success' },
    { time: '2026-07-20 23:00', actor: 'federation-sync', operation: 'SYNC', key: 'federation-sync/alpha/*', status: 'partial' },
  ],
  usage: {
    totalCapacity: '200 GB',
    used: '89.8 GB',
    percentage: 44.9,
    breakdown: [
      { bucket: 'media', size: '45.8 GB', pct: 51 },
      { bucket: 'attachments', size: '28.4 GB', pct: 32 },
      { bucket: 'backups', size: '12.1 GB', pct: 13 },
      { bucket: 'federation-sync', size: '2.3 GB', pct: 3 },
      { bucket: 'avatars', size: '1.2 GB', pct: 1 },
    ],
  },
  workers: [
    { name: 'thumbnail-generator', status: 'running', processed: 12841, pending: 3, lastRun: '12s ago' },
    { name: 'backup-archiver', status: 'idle', processed: 365, pending: 0, lastRun: '7h ago' },
    { name: 'federation-replicator', status: 'running', processed: 891, pending: 12, lastRun: '30s ago' },
    { name: 'garbage-collector', status: 'idle', processed: 2104, pending: 0, lastRun: '2h ago' },
  ],
};

const MOCK_SECURITY = {
  admins: [
    { username: 'root', role: 'super_admin', lastLogin: '2026-07-21 09:00', mfa: true },
    { username: 'ops-bot', role: 'service_account', lastLogin: '2026-07-21 08:55', mfa: false },
    { username: 'alice-admin', role: 'admin', lastLogin: '2026-07-20 14:30', mfa: true },
  ],
  dashboardSessions: [
    { user: 'root', ip: '192.168.1.1', started: '2026-07-21 09:00', expires: '2026-07-21 21:00' },
    { user: 'alice-admin', ip: '10.0.0.42', started: '2026-07-20 14:30', expires: '2026-07-21 02:30' },
  ],
};

const MOCK_ACCESS_GATES = {
  currentPolicy: 'open' as const,
  inviteCodes: [
    { code: 'PEERS-ALPHA-2026', uses: 12, maxUses: 50, created: '2026-06-01', expires: '2026-08-01', status: 'active' },
    { code: 'TEAM-ONBOARD-Q3', uses: 8, maxUses: 20, created: '2026-07-01', expires: '2026-09-30', status: 'active' },
    { code: 'BETA-TESTER-001', uses: 50, maxUses: 50, created: '2026-03-15', expires: '2026-06-15', status: 'exhausted' },
    { code: 'FRIENDS-INVITE', uses: 3, maxUses: 10, created: '2026-07-10', expires: '2026-12-31', status: 'active' },
  ],
};

const MOCK_SYSTEM = {
  info: [
    { label: 'Go Version', value: 'go1.23.1' },
    { label: 'Hostname', value: 'peers-station-prod-01' },
    { label: 'CPU Cores', value: '8' },
    { label: 'Memory', value: '16.0 GB (4.2 GB used)' },
    { label: 'Goroutines', value: '847' },
    { label: 'Uptime', value: '14d 6h 32m' },
  ],
  routes: [
    { method: 'GET', path: '/api/v1/actors', handler: 'ActorServer.List' },
    { method: 'POST', path: '/api/v1/actors/signup', handler: 'ActorServer.Signup' },
    { method: 'GET', path: '/api/v1/sessions', handler: 'SessionServer.List' },
    { method: 'POST', path: '/api/v1/transport/send', handler: 'TransportRelay.Send' },
    { method: 'GET', path: '/api/v1/federation/peers', handler: 'FederationServer.ListPeers' },
    { method: 'POST', path: '/api/v1/oss/upload', handler: 'OSSServer.Upload' },
    { method: 'GET', path: '/health', handler: 'FrameServer.Health' },
    { method: 'GET', path: '/metrics', handler: 'FrameServer.Metrics' },
  ],
};

const MOCK_LOGS = [
  { time: '2026-07-21 09:14:22', level: 'info', admin: 'root', action: 'actor.approve', resource: 'pt:actor:a8f2c91d', detail: 'Auto-approved via open gate' },
  { time: '2026-07-21 08:55:01', level: 'warn', admin: 'root', action: 'service.restart', resource: 'transport-relay', detail: 'Scheduled maintenance window' },
  { time: '2026-07-21 08:42:18', level: 'info', admin: 'root', action: 'actor.approve', resource: 'pt:actor:b3e7d4a0', detail: 'Auto-approved via open gate' },
  { time: '2026-07-21 07:30:00', level: 'info', admin: 'system', action: 'backup.complete', resource: 'pg-main', detail: 'Daily backup successful, 2.1GB' },
  { time: '2026-07-21 06:00:00', level: 'info', admin: 'system', action: 'cert.renew', resource: 'tls-primary', detail: 'Certificate renewed, expires 2026-10-19' },
  { time: '2026-07-20 23:15:44', level: 'error', admin: 'system', action: 'federation.sync_fail', resource: 'peer:node:3f8h7c16', detail: 'Connection timeout after 30s' },
  { time: '2026-07-20 22:31:09', level: 'info', admin: 'root', action: 'actor.approve', resource: 'pt:actor:c1f9e82b', detail: 'Auto-approved via open gate' },
  { time: '2026-07-20 18:05:33', level: 'info', admin: 'root', action: 'actor.create', resource: 'pt:actor:d4a6b3c7', detail: 'Pending manual review' },
];

const MOCK_FEDERATION = {
  myFederations: [
    {
      id: 'fed:circle:alpha-network',
      name: 'Alpha Research Network',
      endpoint: 'https://alpha.peers.network/federation',
      status: 'active' as const,
      stationCount: 12,
      actorCount: 3420,
      role: 'creator' as const,
      createdAt: '2026-02-15',
      description: 'Primary research collaboration federation for distributed AI labs',
      seedNodes: ['station-alpha.peers.network', 'relay-eu.peers.network'],
    },
    {
      id: 'fed:circle:open-social',
      name: 'Open Social Commons',
      endpoint: 'https://commons.social/federation',
      status: 'active' as const,
      stationCount: 47,
      actorCount: 18920,
      role: 'member' as const,
      createdAt: '2026-03-01',
      description: 'Open federation for social networking interoperability',
      seedNodes: ['commons.social', 'relay-global.peers.network'],
    },
    {
      id: 'fed:circle:dev-testing',
      name: 'Dev & Testing Ring',
      endpoint: 'https://dev.internal.local/federation',
      status: 'degraded' as const,
      stationCount: 4,
      actorCount: 89,
      role: 'creator' as const,
      createdAt: '2026-05-20',
      description: 'Internal development and QA federation ring',
      seedNodes: ['dev.internal.local', 'staging.internal.local'],
    },
    {
      id: 'fed:circle:media-coop',
      name: 'Media Cooperative',
      endpoint: 'https://media-coop.org/federation',
      status: 'active' as const,
      stationCount: 8,
      actorCount: 2150,
      role: 'member' as const,
      createdAt: '2026-04-10',
      description: 'Cooperative media sharing and distribution federation',
      seedNodes: ['media-coop.org', 'cdn-relay.media-coop.org'],
    },
  ],
  memberStations: [
    { stationName: 'Station Alpha', peerId: 'peer:node:7f3a2c91', federation: 'Alpha Research Network', joinedAt: '2026-02-15', status: 'active', actorCount: 892 },
    { stationName: 'Station Beta', peerId: 'peer:node:8b4d3e72', federation: 'Alpha Research Network', joinedAt: '2026-02-18', status: 'active', actorCount: 445 },
    { stationName: 'Relay EU', peerId: 'peer:node:9c5e4f83', federation: 'Alpha Research Network', joinedAt: '2026-02-20', status: 'active', actorCount: 0 },
    { stationName: 'Station Gamma', peerId: 'peer:node:1d6f5a94', federation: 'Open Social Commons', joinedAt: '2026-03-05', status: 'active', actorCount: 1203 },
    { stationName: 'Relay Asia', peerId: 'peer:node:2e7g6b05', federation: 'Dev & Testing Ring', joinedAt: '2026-05-21', status: 'degraded', actorCount: 34 },
    { stationName: 'Station Delta', peerId: 'peer:node:3f8h7c16', federation: 'Dev & Testing Ring', joinedAt: '2026-05-22', status: 'offline', actorCount: 55 },
    { stationName: 'Media Hub 1', peerId: 'peer:node:4g9i8d27', federation: 'Media Cooperative', joinedAt: '2026-04-12', status: 'active', actorCount: 678 },
    { stationName: 'Media Hub 2', peerId: 'peer:node:5h0j9e38', federation: 'Media Cooperative', joinedAt: '2026-04-15', status: 'pending', actorCount: 0 },
  ],
  health: [
    {
      federation: 'Alpha Research Network',
      latency: '14ms',
      throughput: '2,841 msg/min',
      lastSync: '12s ago',
      relayStatus: 'healthy',
      uptime: '99.97%',
    },
    {
      federation: 'Open Social Commons',
      latency: '48ms',
      throughput: '12,450 msg/min',
      lastSync: '8s ago',
      relayStatus: 'healthy',
      uptime: '99.92%',
    },
    {
      federation: 'Dev & Testing Ring',
      latency: '120ms',
      throughput: '45 msg/min',
      lastSync: '5m ago',
      relayStatus: 'degraded',
      uptime: '94.20%',
    },
    {
      federation: 'Media Cooperative',
      latency: '32ms',
      throughput: '890 msg/min',
      lastSync: '20s ago',
      relayStatus: 'healthy',
      uptime: '99.85%',
    },
  ],
  governance: {
    admins: [
      { name: 'root', federation: 'Alpha Research Network', role: 'owner', since: '2026-02-15' },
      { name: 'alice-admin', federation: 'Alpha Research Network', role: 'admin', since: '2026-03-01' },
      { name: 'root', federation: 'Dev & Testing Ring', role: 'owner', since: '2026-05-20' },
      { name: 'root', federation: 'Media Cooperative', role: 'member_admin', since: '2026-04-10' },
    ],
    policies: [
      { federation: 'Alpha Research Network', joinPolicy: 'invite-only', syncInterval: '30s', maxStations: 50 },
      { federation: 'Open Social Commons', joinPolicy: 'open', syncInterval: '15s', maxStations: 200 },
      { federation: 'Dev & Testing Ring', joinPolicy: 'closed', syncInterval: '60s', maxStations: 10 },
      { federation: 'Media Cooperative', joinPolicy: 'invite-only', syncInterval: '30s', maxStations: 25 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Shared UI Components
// ---------------------------------------------------------------------------

function PageHeader({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ size?: number }>; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ width: 36, height: 36, borderRadius: T.radius, background: T.primaryBg, color: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} />
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.text }}>{title}</h1>
      </div>
      <p style={{ margin: '8px 0 0 46px', fontSize: 13, color: T.textSecondary }}>{subtitle}</p>
    </div>
  );
}

function StatCard({ label, value, change, icon: Icon }: { label: string; value: string; change?: string; icon: React.ComponentType<{ size?: number }> }) {
  return (
    <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 16, boxShadow: T.shadow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: T.textSecondary, fontWeight: 500 }}>{label}</span>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: T.primaryBg, color: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={14} />
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: T.text }}>{value}</div>
      {change && <div style={{ fontSize: 11, color: T.primary, fontWeight: 600, marginTop: 4 }}>{change}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    active: { bg: T.successBg, text: T.success },
    online: { bg: T.successBg, text: T.success },
    running: { bg: T.successBg, text: T.success },
    healthy: { bg: T.successBg, text: T.success },
    pending: { bg: T.warningBg, text: T.warning },
    degraded: { bg: T.warningBg, text: T.warning },
    offline: { bg: T.dangerBg, text: T.danger },
    stopped: { bg: T.dangerBg, text: T.danger },
    suspended: { bg: T.dangerBg, text: T.danger },
    exhausted: { bg: '#f3f4f6', text: '#6b7280' },
    creator: { bg: T.primaryBg, text: T.primary },
    member: { bg: T.infoBg, text: T.info },
  };
  const c = colors[status] || { bg: '#f3f4f6', text: '#6b7280' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `2px solid ${T.border}`, color: T.textSecondary, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '10px 12px', color: T.text }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radiusLg, padding: 20, boxShadow: T.shadow, ...style }}>
      {children}
    </div>
  );
}

function TabBar({ tabs, active, onSelect }: { tabs: string[]; active: string; onSelect: (t: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${T.border}`, marginBottom: 20 }}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onSelect(tab)}
          style={{
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: active === tab ? 600 : 400,
            color: active === tab ? T.primary : T.textSecondary,
            background: 'none',
            border: 'none',
            borderBottom: active === tab ? `2px solid ${T.primary}` : '2px solid transparent',
            marginBottom: -2,
            cursor: 'pointer',
            fontFamily: T.font,
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Overview
// ---------------------------------------------------------------------------

function OverviewPage() {
  return (
    <div>
      <PageHeader icon={LayoutDashboard} title="Overview" subtitle="Station operational summary and recent activity" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {MOCK_OVERVIEW.stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} change={s.change} icon={s.icon} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: T.text }}>Recent Actors</h3>
          <DataTable
            columns={['PTID', 'Name', 'Created', 'Status']}
            rows={MOCK_OVERVIEW.recentActors.map((a) => [
              <code style={{ fontSize: 11, color: T.primary }}>{a.ptid}</code>,
              a.name,
              a.created,
              <StatusBadge status={a.status} />,
            ])}
          />
        </Card>
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: T.text }}>Recent Audit</h3>
          <DataTable
            columns={['Time', 'Admin', 'Action', 'Resource']}
            rows={MOCK_OVERVIEW.recentAudit.map((a) => [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{a.time}</span>,
              a.admin,
              <code style={{ fontSize: 11 }}>{a.action}</code>,
              <span style={{ fontSize: 11, color: T.textSecondary }}>{a.resource}</span>,
            ])}
          />
        </Card>
      </div>

      {/* Active Alerts */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.text }}>Active Alerts</h3>
          <span style={{ fontSize: 11, color: T.textMuted }}>2 unresolved</span>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: T.warningBg, borderRadius: T.radius, border: `1px solid ${T.warning}20` }}>
            <AlertTriangle size={14} color={T.warning} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Federation peer unreachable</div>
              <div style={{ fontSize: 11, color: T.textSecondary }}>station-delta.corp.io has not responded for 15 minutes</div>
            </div>
            <span style={{ fontSize: 10, color: T.textMuted }}>15m ago</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: T.warningBg, borderRadius: T.radius, border: `1px solid ${T.warning}20` }}>
            <AlertTriangle size={14} color={T.warning} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Agent server stopped</div>
              <div style={{ fontSize: 11, color: T.textSecondary }}>agent-server subserver is not running — requires manual start</div>
            </div>
            <span style={{ fontSize: 10, color: T.textMuted }}>2h ago</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Transport
// ---------------------------------------------------------------------------

function TransportPage() {
  return (
    <div>
      <PageHeader icon={Radio} title="Transport" subtitle="Friend chat messaging, relay, and realtime connections" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {MOCK_TRANSPORT.stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: T.text }}>SSE Realtime Info</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <div style={{ padding: 10, background: T.pageBg, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2 }}>Active Connections</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{MOCK_TRANSPORT.sse.connections}</div>
            </div>
            <div style={{ padding: 10, background: T.pageBg, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2 }}>Events / sec</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{MOCK_TRANSPORT.sse.eventsPerSec}</div>
            </div>
            <div style={{ padding: 10, background: T.pageBg, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2 }}>Avg Latency</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{MOCK_TRANSPORT.sse.avgLatency}</div>
            </div>
            <div style={{ padding: 10, background: T.pageBg, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2 }}>Status</div>
              <div style={{ marginTop: 4 }}><StatusBadge status={MOCK_TRANSPORT.sse.status} /></div>
            </div>
          </div>
        </Card>

        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: T.text }}>Outbox Queue</h3>
          {MOCK_TRANSPORT.outbox.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>Outbox empty</div>
          ) : (
            <DataTable
              columns={['Target', 'Messages', 'Oldest', 'Reason']}
              rows={MOCK_TRANSPORT.outbox.map((o) => [
                <code style={{ fontSize: 10 }}>{o.target}</code>,
                <span style={{ fontWeight: 600 }}>{o.messages}</span>,
                o.oldest,
                <span style={{ fontSize: 11, color: T.warning }}>{o.reason}</span>,
              ])}
            />
          )}
        </Card>
      </div>

      <Card>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: T.text }}>Recent Messages</h3>
        <DataTable
          columns={['ID', 'From', 'To', 'Type', 'Size', 'Time', 'Delivered']}
          rows={MOCK_TRANSPORT.recentMessages.map((m) => [
            <code style={{ fontSize: 10, color: T.textMuted }}>{m.id}</code>,
            <code style={{ fontSize: 10 }}>{m.from}</code>,
            <code style={{ fontSize: 10 }}>{m.to}</code>,
            <span style={{ fontSize: 11, fontWeight: 500 }}>{m.type}</span>,
            m.size,
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{m.time}</span>,
            m.delivered ? <CheckCircle2 size={13} color={T.success} /> : <Clock size={13} color={T.warning} />,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Actors
// ---------------------------------------------------------------------------

function ActorsPage() {
  return (
    <div>
      <PageHeader icon={Users} title="Actors" subtitle="Registered actors on this Station" />
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: T.textSecondary }}>Showing 8 of 2,847 actors</span>
          <button style={{ ...buttonStyle, background: T.primary, color: '#fff' }}>
            <Plus size={14} /> Add Actor
          </button>
        </div>
        <DataTable
          columns={['PTID', 'Display Name', 'Created At', 'Status']}
          rows={MOCK_ACTORS.map((a) => [
            <code style={{ fontSize: 11, color: T.primary }}>{a.ptid}</code>,
            a.name,
            a.created,
            <StatusBadge status={a.status} />,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Sessions
// ---------------------------------------------------------------------------

function SessionsPage() {
  return (
    <div>
      <PageHeader icon={Monitor} title="Sessions" subtitle="Active client sessions and connected devices" />

      {/* Device breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard label="Total Sessions" value="6" icon={Monitor} />
        <StatCard label="Desktop" value="3" change="50%" icon={Monitor} />
        <StatCard label="Mobile" value="2" change="33%" icon={Monitor} />
        <StatCard label="Web" value="1" change="17%" icon={Monitor} />
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: T.textSecondary }}>6 active sessions</span>
          <button style={{ ...buttonStyle, background: T.dangerBg, color: T.danger }}>
            <XCircle size={13} /> Revoke All
          </button>
        </div>
        <DataTable
          columns={['Actor', 'Device', 'User Agent', 'Last Active', 'IP', 'Actions']}
          rows={MOCK_SESSIONS.map((s) => [
            s.actor,
            <StatusBadge status={s.device === 'Desktop' ? 'active' : s.device === 'Mobile' ? 'pending' : 'degraded'} />,
            <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{s.userAgent}</span>,
            s.lastActive,
            <code style={{ fontSize: 11 }}>{s.ip}</code>,
            <ActionBtn label="Revoke" color={T.danger} />,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Nodes
// ---------------------------------------------------------------------------

function NodesPage() {
  return (
    <div>
      <PageHeader icon={Network} title="Nodes" subtitle="Peer nodes connected to this Station" />
      <Card>
        <DataTable
          columns={['Peer ID', 'Address', 'Last Seen', 'Status']}
          rows={MOCK_NODES.map((n) => [
            <code style={{ fontSize: 11, color: T.primary }}>{n.peerId}</code>,
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{n.address}</span>,
            n.lastSeen,
            <StatusBadge status={n.status} />,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Services
// ---------------------------------------------------------------------------

function ServicesPage() {
  return (
    <div>
      <PageHeader icon={Server} title="Services" subtitle="Station sub-server instances and their operational state" />
      <Card>
        <DataTable
          columns={['Name', 'Type', 'Port', 'Status']}
          rows={MOCK_SERVICES.map((s) => [
            <span style={{ fontWeight: 600 }}>{s.name}</span>,
            s.type,
            <code style={{ fontSize: 11 }}>{s.port}</code>,
            <StatusBadge status={s.status} />,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Storage
// ---------------------------------------------------------------------------

function StoragePage() {
  return (
    <div>
      <PageHeader icon={Database} title="Storage" subtitle="Database connection info, pool stats, and table metrics" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Connection Info</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              ['Driver', MOCK_STORAGE.driver],
              ['Host', MOCK_STORAGE.host],
              ['Database', MOCK_STORAGE.database],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: T.textSecondary }}>{label}</span>
                <code style={{ fontSize: 12 }}>{value}</code>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Pool Stats</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              ['Pool Size', String(MOCK_STORAGE.poolSize)],
              ['Active', String(MOCK_STORAGE.activeConns)],
              ['Idle', String(MOCK_STORAGE.idleConns)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: T.textSecondary }}>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Table Row Counts</h3>
        <DataTable
          columns={['Table', 'Rows']}
          rows={MOCK_STORAGE.tables.map((t) => [
            <code style={{ fontSize: 12 }}>{t.name}</code>,
            t.rows.toLocaleString(),
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: OSS
// ---------------------------------------------------------------------------

function OSSPage() {
  const [tab, setTab] = useState('Buckets');
  return (
    <div>
      <PageHeader icon={HardDrive} title="OSS" subtitle="Object storage service — buckets, objects, audit, and federation sync" />
      <Card>
        <TabBar tabs={['Buckets', 'Objects', 'Audit', 'Usage', 'Workers', 'Federation']} active={tab} onSelect={setTab} />

        {tab === 'Buckets' && (
          <DataTable
            columns={['Name', 'Objects', 'Size', 'Created', 'Access']}
            rows={MOCK_OSS.buckets.map((b) => [
              <span style={{ fontWeight: 600 }}>{b.name}</span>,
              b.objects.toLocaleString(),
              b.size,
              b.created,
              <StatusBadge status={b.access === 'public-read' ? 'active' : b.access === 'federation' ? 'degraded' : 'pending'} />,
            ])}
          />
        )}

        {tab === 'Objects' && (
          <DataTable
            columns={['Key', 'Bucket', 'Size', 'Modified', 'Content-Type']}
            rows={MOCK_OSS.objects.map((o) => [
              <code style={{ fontSize: 11, color: T.primary }}>{o.key}</code>,
              o.bucket,
              o.size,
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{o.modified}</span>,
              <code style={{ fontSize: 10, color: T.textSecondary }}>{o.contentType}</code>,
            ])}
          />
        )}

        {tab === 'Audit' && (
          <DataTable
            columns={['Time', 'Actor', 'Operation', 'Key', 'Status']}
            rows={MOCK_OSS.audit.map((a) => [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{a.time}</span>,
              <code style={{ fontSize: 10 }}>{a.actor}</code>,
              <span style={{ fontWeight: 600, color: a.operation === 'DELETE' ? T.danger : a.operation === 'PUT' ? T.success : T.info, fontSize: 11 }}>{a.operation}</span>,
              <code style={{ fontSize: 10 }}>{a.key}</code>,
              <StatusBadge status={a.status === 'success' ? 'active' : 'degraded'} />,
            ])}
          />
        )}

        {tab === 'Usage' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{MOCK_OSS.usage.used}</div>
                <div style={{ fontSize: 12, color: T.textSecondary }}>of {MOCK_OSS.usage.totalCapacity} ({MOCK_OSS.usage.percentage}%)</div>
              </div>
              <div style={{ width: 200, height: 8, background: T.borderLight, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${MOCK_OSS.usage.percentage}%`, height: '100%', background: T.primary, borderRadius: 4 }} />
              </div>
            </div>
            <DataTable
              columns={['Bucket', 'Size', 'Share']}
              rows={MOCK_OSS.usage.breakdown.map((b) => [
                <span style={{ fontWeight: 600 }}>{b.bucket}</span>,
                b.size,
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 60, height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${b.pct}%`, height: '100%', background: T.primary, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11 }}>{b.pct}%</span>
                </div>,
              ])}
            />
          </div>
        )}

        {tab === 'Workers' && (
          <DataTable
            columns={['Worker', 'Status', 'Processed', 'Pending', 'Last Run']}
            rows={MOCK_OSS.workers.map((w) => [
              <span style={{ fontWeight: 600 }}>{w.name}</span>,
              <StatusBadge status={w.status === 'running' ? 'active' : 'pending'} />,
              w.processed.toLocaleString(),
              <span style={{ fontWeight: 600, color: w.pending > 0 ? T.warning : T.text }}>{w.pending}</span>,
              w.lastRun,
            ])}
          />
        )}

        {tab === 'Federation' && (
          <div>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: T.textSecondary }}>
              Cross-federation object replication status for synced buckets
            </p>
            <DataTable
              columns={['Bucket', 'Objects Synced', 'Pending', 'Last Sync', 'Status']}
              rows={[
                [<span style={{ fontWeight: 600 }}>federation-sync</span>, '879', '12', '30s ago', <StatusBadge status="active" />],
                [<span style={{ fontWeight: 600 }}>avatars (public mirror)</span>, '2,841', '0', '5m ago', <StatusBadge status="active" />],
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Security
// ---------------------------------------------------------------------------

function SecurityPage() {
  return (
    <div>
      <PageHeader icon={Shield} title="Security" subtitle="Admin accounts, dashboard sessions, and security events" />
      <div style={{ display: 'grid', gap: 16 }}>
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Admin Accounts</h3>
          <DataTable
            columns={['Username', 'Role', 'Last Login', 'MFA']}
            rows={MOCK_SECURITY.admins.map((a) => [
              <span style={{ fontWeight: 600 }}>{a.username}</span>,
              <code style={{ fontSize: 11 }}>{a.role}</code>,
              a.lastLogin,
              a.mfa ? <CheckCircle2 size={14} color={T.success} /> : <XCircle size={14} color={T.danger} />,
            ])}
          />
        </Card>
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Dashboard Sessions</h3>
          <DataTable
            columns={['User', 'IP', 'Started', 'Expires']}
            rows={MOCK_SECURITY.dashboardSessions.map((s) => [
              s.user,
              <code style={{ fontSize: 11 }}>{s.ip}</code>,
              s.started,
              s.expires,
            ])}
          />
        </Card>
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Security Events</h3>
          <DataTable
            columns={['Time', 'Event', 'Source', 'Severity', 'Detail']}
            rows={[
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-21 09:00</span>,
                <code style={{ fontSize: 11 }}>auth.login</code>,
                <code style={{ fontSize: 10 }}>192.168.1.1</code>,
                <LevelBadge level="info" />,
                'root logged in successfully',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-21 03:14</span>,
                <code style={{ fontSize: 11 }}>auth.failed</code>,
                <code style={{ fontSize: 10 }}>45.33.12.99</code>,
                <LevelBadge level="warn" />,
                'Failed login attempt for user "admin" (3/5)',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-20 22:45</span>,
                <code style={{ fontSize: 11 }}>cert.expiry_warn</code>,
                <code style={{ fontSize: 10 }}>system</code>,
                <LevelBadge level="info" />,
                'TLS certificate expires in 90 days',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-20 14:30</span>,
                <code style={{ fontSize: 11 }}>auth.login</code>,
                <code style={{ fontSize: 10 }}>10.0.0.42</code>,
                <LevelBadge level="info" />,
                'alice-admin logged in successfully',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-19 08:22</span>,
                <code style={{ fontSize: 11 }}>rate_limit.hit</code>,
                <code style={{ fontSize: 10 }}>203.0.113.50</code>,
                <LevelBadge level="warn" />,
                'Rate limit exceeded on /api/v1/actors/signup (50 req/min)',
              ],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Access Gates
// ---------------------------------------------------------------------------

function AccessGatesPage() {
  const policies = ['Open', 'Invite', 'Fixed', 'Closed'];
  return (
    <div>
      <PageHeader icon={Lock} title="Access Gates" subtitle="Actor registration policy and invite code management" />
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Gate Policy</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {policies.map((p) => (
            <button
              key={p}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: `1px solid ${p.toLowerCase() === MOCK_ACCESS_GATES.currentPolicy ? T.primary : T.border}`,
                background: p.toLowerCase() === MOCK_ACCESS_GATES.currentPolicy ? T.primaryBg : T.bg,
                color: p.toLowerCase() === MOCK_ACCESS_GATES.currentPolicy ? T.primary : T.textSecondary,
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: T.font,
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 12, color: T.textSecondary }}>
          Current policy: <strong>Open</strong> — anyone can register without an invite code
        </p>
      </Card>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Invite Codes</h3>
          <button style={{ ...buttonStyle, background: T.primary, color: '#fff' }}>
            <Plus size={14} /> Generate Code
          </button>
        </div>
        <DataTable
          columns={['Code', 'Uses', 'Created', 'Expires', 'Status']}
          rows={MOCK_ACCESS_GATES.inviteCodes.map((c) => [
            <code style={{ fontSize: 11, fontWeight: 600 }}>{c.code}</code>,
            `${c.uses} / ${c.maxUses}`,
            c.created,
            c.expires,
            <StatusBadge status={c.status} />,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: System
// ---------------------------------------------------------------------------

function SystemPage() {
  return (
    <div>
      <PageHeader icon={Cpu} title="System" subtitle="Runtime environment, resource usage, and registered HTTP routes" />
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>System Info</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {MOCK_SYSTEM.info.map((item) => (
            <div key={item.label} style={{ padding: 12, background: T.pageBg, borderRadius: T.radius }}>
              <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Resource usage bars */}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>Resource Usage</h3>
        <div style={{ display: 'grid', gap: 14 }}>
          {[
            { label: 'CPU', value: 23, detail: '23% (1.84 / 8 cores)' },
            { label: 'Memory', value: 26, detail: '4.2 GB / 16.0 GB' },
            { label: 'Disk', value: 44, detail: '89.8 GB / 200 GB' },
            { label: 'Network I/O', value: 12, detail: '12 Mbps out, 4 Mbps in' },
          ].map((res) => (
            <div key={res.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{res.label}</span>
                <span style={{ fontSize: 11, color: T.textSecondary }}>{res.detail}</span>
              </div>
              <div style={{ width: '100%', height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${res.value}%`, height: '100%', background: res.value > 80 ? T.danger : res.value > 60 ? T.warning : T.primary, borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Registered Routes</h3>
        <DataTable
          columns={['Method', 'Path', 'Handler']}
          rows={MOCK_SYSTEM.routes.map((r) => [
            <span style={{ fontWeight: 600, color: r.method === 'GET' ? T.info : T.success, fontSize: 11 }}>{r.method}</span>,
            <code style={{ fontSize: 12 }}>{r.path}</code>,
            <span style={{ fontSize: 12, color: T.textSecondary }}>{r.handler}</span>,
          ])}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page: Logs
// ---------------------------------------------------------------------------

function LogsPage() {
  const [filter, setFilter] = useState('all');
  const levels = ['all', 'info', 'warn', 'error'];

  const filteredLogs = filter === 'all' ? MOCK_LOGS : MOCK_LOGS.filter((l) => l.level === filter);

  return (
    <div>
      <PageHeader icon={FileText} title="Logs" subtitle="Audit log and system event trail" />
      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setFilter(l)}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: `1px solid ${filter === l ? T.primary : T.border}`,
                background: filter === l ? T.primaryBg : T.bg,
                color: filter === l ? T.primary : T.textSecondary,
                fontWeight: 500,
                fontSize: 12,
                cursor: 'pointer',
                textTransform: 'capitalize',
                fontFamily: T.font,
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <DataTable
          columns={['Time', 'Level', 'Admin', 'Action', 'Resource', 'Detail']}
          rows={filteredLogs.map((l) => [
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{l.time}</span>,
            <LevelBadge level={l.level} />,
            l.admin,
            <code style={{ fontSize: 11 }}>{l.action}</code>,
            <span style={{ fontSize: 11, color: T.textSecondary }}>{l.resource}</span>,
            <span style={{ fontSize: 11 }}>{l.detail}</span>,
          ])}
        />
      </Card>
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    info: { bg: T.infoBg, text: T.info },
    warn: { bg: T.warningBg, text: T.warning },
    error: { bg: T.dangerBg, text: T.danger },
  };
  const c = colors[level] || colors.info;
  return (
    <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: c.bg, color: c.text, textTransform: 'uppercase' }}>
      {level}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page: Federation (detailed — primary design focus)
// ---------------------------------------------------------------------------

function FederationPage() {
  const [activeTab, setActiveTab] = useState('My Federations');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedFederation, setSelectedFederation] = useState<string | null>(null);

  const tabs = ['My Federations', 'Member Stations', 'Federation Health', 'Admin & Governance'];

  return (
    <div>
      <PageHeader icon={Globe} title="Federation" subtitle="Manage federation memberships, peer stations, health monitoring, and governance" />

      {/* Quick federation summary bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ padding: '10px 14px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius }}>
          <div style={{ fontSize: 10, color: T.textMuted }}>Total Federations</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>4</div>
        </div>
        <div style={{ padding: '10px 14px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius }}>
          <div style={{ fontSize: 10, color: T.textMuted }}>Created by Me</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>2</div>
        </div>
        <div style={{ padding: '10px 14px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius }}>
          <div style={{ fontSize: 10, color: T.textMuted }}>Total Peer Stations</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>71</div>
        </div>
        <div style={{ padding: '10px 14px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius }}>
          <div style={{ fontSize: 10, color: T.textMuted }}>Federated Actors</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>24,579</div>
        </div>
        <div style={{ padding: '10px 14px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radius }}>
          <div style={{ fontSize: 10, color: T.textMuted }}>Network Status</div>
          <div style={{ marginTop: 4 }}><StatusBadge status="active" /></div>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onSelect={setActiveTab} />

      {activeTab === 'My Federations' && (
        <FederationMyFederationsTab
          showCreateForm={showCreateForm}
          onToggleCreate={() => setShowCreateForm(!showCreateForm)}
          selectedFederation={selectedFederation}
          onSelectFederation={setSelectedFederation}
        />
      )}
      {activeTab === 'Member Stations' && <FederationMemberStationsTab />}
      {activeTab === 'Federation Health' && <FederationHealthTab />}
      {activeTab === 'Admin & Governance' && <FederationGovernanceTab />}
    </div>
  );
}

// --- Federation Sub-Tab: My Federations ---

function FederationMyFederationsTab({
  showCreateForm,
  onToggleCreate,
  selectedFederation,
  onSelectFederation,
}: {
  showCreateForm: boolean;
  onToggleCreate: () => void;
  selectedFederation: string | null;
  onSelectFederation: (id: string | null) => void;
}) {
  const selected = MOCK_FEDERATION.myFederations.find((f) => f.id === selectedFederation);

  return (
    <div>
      {/* Action bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: T.textSecondary }}>
          {MOCK_FEDERATION.myFederations.length} federations (
          {MOCK_FEDERATION.myFederations.filter((f) => f.role === 'creator').length} created,{' '}
          {MOCK_FEDERATION.myFederations.filter((f) => f.role === 'member').length} joined)
        </span>
        <button style={{ ...buttonStyle, background: T.primary, color: '#fff' }} onClick={onToggleCreate}>
          <Plus size={14} /> Create Federation
        </button>
      </div>

      {/* Create form (inline) */}
      {showCreateForm && (
        <Card style={{ marginBottom: 16, border: `2px solid ${T.primary}` }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: T.primary }}>Create New Federation</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <FormField label="Federation Name" placeholder="e.g. My Research Network" />
            <FormField label="Endpoint URL" placeholder="https://your-station.example.com/federation" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <FormField label="Description" placeholder="Brief description of this federation's purpose" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <FormField label="Seed Nodes (comma-separated)" placeholder="node1.example.com, node2.example.com" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...buttonStyle, background: T.primary, color: '#fff' }}>Create</button>
            <button style={{ ...buttonStyle, background: T.pageBg, color: T.textSecondary }} onClick={onToggleCreate}>Cancel</button>
          </div>
        </Card>
      )}

      {/* Federation cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {MOCK_FEDERATION.myFederations.map((fed) => (
          <div
            key={fed.id}
            onClick={() => onSelectFederation(fed.id === selectedFederation ? null : fed.id)}
            style={{
              background: T.bg,
              border: `1px solid ${fed.id === selectedFederation ? T.primary : T.border}`,
              borderRadius: T.radiusLg,
              padding: 16,
              cursor: 'pointer',
              boxShadow: fed.id === selectedFederation ? `0 0 0 2px ${T.primaryBg}` : T.shadow,
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 2 }}>{fed.name}</div>
                <div style={{ fontSize: 11, color: T.textMuted, fontFamily: 'monospace' }}>{fed.id}</div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <StatusBadge status={fed.status} />
                <StatusBadge status={fed.role} />
              </div>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: T.textSecondary, lineHeight: 1.4 }}>{fed.description}</p>
            <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
              <span style={{ color: T.textMuted }}>
                <strong style={{ color: T.text }}>{fed.stationCount}</strong> stations
              </span>
              <span style={{ color: T.textMuted }}>
                <strong style={{ color: T.text }}>{fed.actorCount.toLocaleString()}</strong> actors
              </span>
              <span style={{ color: T.textMuted }}>Since {fed.createdAt}</span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.primary }}>
              <span>View details</span>
              <ChevronRight size={12} />
            </div>
          </div>
        ))}
      </div>

      {/* Detail panel for selected federation */}
      {selected && (
        <Card style={{ border: `1px solid ${T.primary}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>{selected.name}</h3>
              <code style={{ fontSize: 11, color: T.textMuted }}>{selected.id}</code>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...buttonStyle, background: T.pageBg, color: T.textSecondary }}>
                <RefreshCw size={13} /> Sync Now
              </button>
              <button style={{ ...buttonStyle, background: T.pageBg, color: T.textSecondary }}>
                <Settings size={13} /> Settings
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <InfoBlock label="Endpoint" value={selected.endpoint} mono />
            <InfoBlock label="Status" value={selected.status} />
            <InfoBlock label="Stations" value={String(selected.stationCount)} />
            <InfoBlock label="Actors" value={selected.actorCount.toLocaleString()} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <InfoBlock label="Role" value={selected.role} />
            <InfoBlock label="Created" value={selected.createdAt} />
            <InfoBlock label="Sync Interval" value="30s" />
            <InfoBlock label="Protocol" value="peers-federation/v1" mono />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 6 }}>Description</div>
            <p style={{ margin: 0, fontSize: 13, color: T.text, lineHeight: 1.5, padding: '8px 10px', background: T.pageBg, borderRadius: 6 }}>
              {selected.description}
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 6 }}>Seed Nodes</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {selected.seedNodes.map((node) => (
                <code key={node} style={{ fontSize: 11, padding: '3px 8px', background: T.pageBg, borderRadius: 4, color: T.text }}>{node}</code>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 8 }}>Member Stations</div>
            <DataTable
              columns={['Station', 'Peer ID', 'Joined', 'Status', 'Actors']}
              rows={MOCK_FEDERATION.memberStations
                .filter((s) => s.federation === selected.name)
                .map((s) => [
                  <span style={{ fontWeight: 600 }}>{s.stationName}</span>,
                  <code style={{ fontSize: 10 }}>{s.peerId}</code>,
                  s.joinedAt,
                  <StatusBadge status={s.status} />,
                  String(s.actorCount),
                ])}
            />
          </div>

          {/* Per-federation recent activity */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 8 }}>Recent Activity</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {[
                { time: '09:14', event: 'Sync completed successfully', type: 'success' },
                { time: '09:10', event: 'Actor pt:actor:a8f2c91d federated to 3 peers', type: 'info' },
                { time: '08:55', event: 'Heartbeat acknowledged by all member stations', type: 'success' },
                { time: '08:30', event: 'Scheduled object replication batch processed', type: 'info' },
              ].map((activity, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: T.pageBg, borderRadius: 4, fontSize: 12 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{activity.time}</span>
                  <span style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, background: activity.type === 'success' ? T.success : T.info }} />
                  <span style={{ color: T.text }}>{activity.event}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// --- Federation Sub-Tab: Member Stations ---

function FederationMemberStationsTab() {
  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: T.textSecondary }}>
            {MOCK_FEDERATION.memberStations.length} member stations across all federations
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...buttonStyle, background: T.successBg, color: T.success }}>
              <CheckCircle2 size={13} /> Approve Pending
            </button>
            <button style={{ ...buttonStyle, background: T.dangerBg, color: T.danger }}>
              <XCircle size={13} /> Reject All Pending
            </button>
          </div>
        </div>
        <DataTable
          columns={['Station Name', 'Peer ID', 'Federation', 'Joined', 'Status', 'Actors', 'Actions']}
          rows={MOCK_FEDERATION.memberStations.map((s) => [
            <span style={{ fontWeight: 600 }}>{s.stationName}</span>,
            <code style={{ fontSize: 10 }}>{s.peerId}</code>,
            <span style={{ fontSize: 12 }}>{s.federation}</span>,
            s.joinedAt,
            <StatusBadge status={s.status} />,
            String(s.actorCount),
            <div style={{ display: 'flex', gap: 4 }}>
              {s.status === 'pending' && (
                <>
                  <ActionBtn label="Approve" color={T.success} />
                  <ActionBtn label="Reject" color={T.danger} />
                </>
              )}
              {s.status !== 'pending' && <ActionBtn label="Remove" color={T.danger} />}
            </div>,
          ])}
        />
      </Card>

      {/* Join a remote federation */}
      <Card>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Join a Remote Federation</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: T.textSecondary }}>
          Provide the federation endpoint URL to initiate a join request. The remote federation admin must approve your station.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <FormField label="Federation Endpoint" placeholder="https://remote-station.example.com/federation" />
          <FormField label="Invite Code (optional)" placeholder="INVITE-CODE" />
          <button style={{ ...buttonStyle, background: T.primary, color: '#fff', height: 36 }}>
            <Globe size={13} /> Request Join
          </button>
        </div>
      </Card>
    </div>
  );
}

// --- Federation Sub-Tab: Health ---

function FederationHealthTab() {
  return (
    <div>
      {/* Overall metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Total Federations" value="4" icon={Globe} />
        <StatCard label="Healthy" value="3" change="75%" icon={CheckCircle2} />
        <StatCard label="Degraded" value="1" icon={AlertTriangle} />
        <StatCard label="Avg Latency" value="53ms" icon={Zap} />
      </div>

      {/* Per-federation health cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {MOCK_FEDERATION.health.map((h) => (
          <Card key={h.federation}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{h.federation}</h4>
              <StatusBadge status={h.relayStatus} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <HealthMetric label="Latency" value={h.latency} />
              <HealthMetric label="Throughput" value={h.throughput} />
              <HealthMetric label="Last Sync" value={h.lastSync} />
              <HealthMetric label="Uptime" value={h.uptime} />
            </div>
          </Card>
        ))}
      </div>

      {/* Federation Activity Log */}
      <Card>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Federation Activity Log</h3>
        <DataTable
          columns={['Time', 'Federation', 'Event', 'Detail', 'Status']}
          rows={[
            [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>09:14:08</span>,
              'Alpha Research Network',
              <code style={{ fontSize: 11 }}>sync.complete</code>,
              'Full state sync with 12 peers',
              <StatusBadge status="active" />,
            ],
            [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>09:12:44</span>,
              'Open Social Commons',
              <code style={{ fontSize: 11 }}>actor.federated</code>,
              'Actor pt:actor:a8f2c91d replicated to 3 peers',
              <StatusBadge status="active" />,
            ],
            [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>09:10:02</span>,
              'Dev & Testing Ring',
              <code style={{ fontSize: 11 }}>sync.timeout</code>,
              'Peer station-delta.corp.io unreachable',
              <StatusBadge status="degraded" />,
            ],
            [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>09:08:55</span>,
              'Media Cooperative',
              <code style={{ fontSize: 11 }}>object.replicated</code>,
              'Batch of 14 media objects synced',
              <StatusBadge status="active" />,
            ],
            [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>09:05:30</span>,
              'Alpha Research Network',
              <code style={{ fontSize: 11 }}>peer.joined</code>,
              'New station peer:node:x1y2z3 handshake complete',
              <StatusBadge status="active" />,
            ],
            [
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>08:58:11</span>,
              'Dev & Testing Ring',
              <code style={{ fontSize: 11 }}>relay.degraded</code>,
              'Relay latency exceeded 100ms threshold',
              <StatusBadge status="degraded" />,
            ],
          ]}
        />
      </Card>
    </div>
  );
}

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 8, background: T.pageBg, borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{value}</div>
    </div>
  );
}

// --- Federation Sub-Tab: Admin & Governance ---

function FederationGovernanceTab() {
  return (
    <div>
      <div style={{ display: 'grid', gap: 16 }}>
        {/* Admin list */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Federation Administrators</h3>
            <button style={{ ...buttonStyle, background: T.primary, color: '#fff' }}>
              <Plus size={14} /> Add Admin
            </button>
          </div>
          <DataTable
            columns={['Admin', 'Federation', 'Role', 'Since', 'Actions']}
            rows={MOCK_FEDERATION.governance.admins.map((a) => [
              <span style={{ fontWeight: 600 }}>{a.name}</span>,
              a.federation,
              <StatusBadge status={a.role === 'owner' ? 'creator' : 'member'} />,
              a.since,
              <div style={{ display: 'flex', gap: 4 }}>
                {a.role !== 'owner' && <ActionBtn label="Transfer" color={T.warning} />}
                {a.role !== 'owner' && <ActionBtn label="Remove" color={T.danger} />}
              </div>,
            ])}
          />
        </Card>

        {/* Policies */}
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Federation Policies</h3>
          <DataTable
            columns={['Federation', 'Join Policy', 'Sync Interval', 'Max Stations']}
            rows={MOCK_FEDERATION.governance.policies.map((p) => [
              <span style={{ fontWeight: 600 }}>{p.federation}</span>,
              <PolicyBadge policy={p.joinPolicy} />,
              <code style={{ fontSize: 11 }}>{p.syncInterval}</code>,
              String(p.maxStations),
            ])}
          />
        </Card>

        {/* Transfer ownership section */}
        <Card>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Transfer Admin Ownership</h3>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: T.textSecondary }}>
            Transfer primary ownership of a federation you created to another admin. This action is irreversible.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
            <FormField label="Federation" placeholder="Select federation..." />
            <FormField label="New Owner" placeholder="Select admin..." />
            <button style={{ ...buttonStyle, background: T.warningBg, color: T.warning, height: 36 }}>
              <AlertTriangle size={13} /> Transfer
            </button>
          </div>
        </Card>

        {/* Governance Audit Trail */}
        <Card>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Governance Audit Trail</h3>
          <DataTable
            columns={['Time', 'Admin', 'Action', 'Federation', 'Detail']}
            rows={[
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-21 09:00</span>,
                'root',
                <code style={{ fontSize: 11 }}>policy.update</code>,
                'Dev & Testing Ring',
                'Changed join policy from open to closed',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-20 14:30</span>,
                'alice-admin',
                <code style={{ fontSize: 11 }}>station.approve</code>,
                'Alpha Research Network',
                'Approved station peer:node:x1y2z3',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-19 11:00</span>,
                'root',
                <code style={{ fontSize: 11 }}>admin.add</code>,
                'Alpha Research Network',
                'Added alice-admin as federation admin',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-18 16:45</span>,
                'root',
                <code style={{ fontSize: 11 }}>federation.create</code>,
                'Dev & Testing Ring',
                'Created new federation for internal QA',
              ],
              [
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>2026-07-15 09:22</span>,
                'root',
                <code style={{ fontSize: 11 }}>station.remove</code>,
                'Alpha Research Network',
                'Removed inactive station peer:node:old123',
              ],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function PolicyBadge({ policy }: { policy: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    open: { bg: T.successBg, text: T.success },
    'invite-only': { bg: T.warningBg, text: T.warning },
    closed: { bg: T.dangerBg, text: T.danger },
  };
  const c = colors[policy] || { bg: '#f3f4f6', text: '#6b7280' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>
      {policy}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function FormField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.textSecondary, marginBottom: 4 }}>{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          fontSize: 13,
          fontFamily: T.font,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function InfoBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ padding: 10, background: T.pageBg, borderRadius: 6 }}>
      <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function ActionBtn({ label, color }: { label: string; color: string }) {
  return (
    <button
      style={{
        padding: '3px 8px',
        border: `1px solid ${color}20`,
        borderRadius: 4,
        background: `${color}10`,
        color: color,
        fontSize: 11,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: T.font,
      }}
    >
      {label}
    </button>
  );
}

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: T.font,
};

// ---------------------------------------------------------------------------
// Main Layout & Router
// ---------------------------------------------------------------------------

export function DashboardPrototype() {
  const [activePage, setActivePage] = useState<PageId>('overview');

  const renderPage = () => {
    switch (activePage) {
      case 'overview':
        return <OverviewPage />;
      case 'transport':
        return <TransportPage />;
      case 'actors':
        return <ActorsPage />;
      case 'sessions':
        return <SessionsPage />;
      case 'nodes':
        return <NodesPage />;
      case 'services':
        return <ServicesPage />;
      case 'storage':
        return <StoragePage />;
      case 'oss':
        return <OSSPage />;
      case 'security':
        return <SecurityPage />;
      case 'access-gates':
        return <AccessGatesPage />;
      case 'system':
        return <SystemPage />;
      case 'logs':
        return <LogsPage />;
      case 'federation':
        return <FederationPage />;
      default:
        return <OverviewPage />;
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: T.font, background: T.pageBg, color: T.text }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          background: T.navBg,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Server size={16} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.navTextActive }}>Station</div>
            <div style={{ fontSize: 10, color: T.navText }}>Dashboard</div>
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '9px 12px',
                  marginBottom: 2,
                  border: 'none',
                  borderRadius: 6,
                  background: isActive ? T.navActive : 'transparent',
                  color: isActive ? T.navTextActive : T.navText,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: T.font,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom info */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #2a2a4e', fontSize: 10, color: T.navText }}>
          <div>peers-station-prod-01</div>
          <div style={{ marginTop: 2 }}>v1.4.2 | uptime 14d</div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, marginLeft: 220, padding: 28, minWidth: 0 }}>
        {renderPage()}
      </main>
    </div>
  );
}
