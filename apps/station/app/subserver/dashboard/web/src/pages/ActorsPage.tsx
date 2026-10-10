/**
 * ActorsPage — Actor management interface with search, detail drawer,
 * session oversight, and password reset capabilities.
 *
 * Features:
 *   - Server-side paginated actor table with search filtering
 *   - Detail drawer showing actor profile, sessions tab, and password reset
 *   - Session revocation per-actor from within the drawer
 *
 * Created: 2026-04-10
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Input,
  Typography,
  Avatar,
  Drawer,
  Tabs,
  Descriptions,
  Form,
  Popconfirm,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { RefreshCw, Search, KeyRound, Wifi } from 'lucide-react';

import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import * as actorsApi from '../api/actors';
import { formatTime, formatRelativeTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;

// ── Constants ───────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ── Component ───────────────────────────────────────────────────────

export default function ActorsPage() {
  // ── List state ───────────────────────────────────────────────────
  const [actors, setActors] = useState<actorsApi.ActorDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Drawer state ─────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedActor, setSelectedActor] = useState<actorsApi.ActorDetail | null>(null);
  const [actorSessions, setActorSessions] = useState<actorsApi.ActorSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // ── Password reset form (inline in the drawer's Password Reset tab) ──
  const [resetting, setResetting] = useState(false);
  const [passwordForm] = Form.useForm();

  // ── Data loaders ─────────────────────────────────────────────────

  const loadActors = useCallback(async () => {
    setLoading(true);
    try {
      const result = await actorsApi.listActors(page, PAGE_SIZE, search);
      setActors(result.items || []);
      setTotal(result.total);
    } catch (err) {
      log.error('actors', 'Failed to load actors');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const loadActorSessions = useCallback(async (actorPTID: string) => {
    setSessionsLoading(true);
    try {
      const items = await actorsApi.getActorSessions(actorPTID);
      setActorSessions(items || []);
    } catch (err) {
      log.error('actors', 'Failed to load actor sessions');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => { loadActors(); }, [loadActors]);

  // ── Action handlers ──────────────────────────────────────────────

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleRefresh = () => {
    loadActors();
  };

  const handleRowClick = async (actor: actorsApi.ActorDetail) => {
    setSelectedActor(actor);
    setDrawerOpen(true);
    loadActorSessions(actor.ptid);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setSelectedActor(null);
    setActorSessions([]);
    passwordForm.resetFields();
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!selectedActor) return;

    try {
      await actorsApi.revokeActorSession(selectedActor.ptid, sessionId);
      message.success('Session revoked');
      loadActorSessions(selectedActor.ptid);
    } catch (err) {
      log.error('actors', 'Failed to revoke session');
      message.error('Failed to revoke session');
    }
  };

  const handleResetPassword = async (values: { new_password: string }) => {
    if (!selectedActor) return;

    setResetting(true);
    try {
      await actorsApi.resetActorPassword(selectedActor.ptid, values.new_password);
      message.success('Password reset successfully');
      passwordForm.resetFields();
    } catch (err) {
      log.error('actors', 'Failed to reset password');
      message.error('Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  // ── Column definitions: actor table ──────────────────────────────

  const actorColumns: ColumnsType<actorsApi.ActorDetail> = [
    {
      title: 'Avatar',
      dataIndex: 'avatar_url',
      key: 'avatar',
      width: 56,
      render: (_: string, record) => (
        <Avatar
          src={record.avatar_url || undefined}
          size="small"
          style={{ backgroundColor: '#1677ff' }}
        >
          {record.preferred_username?.charAt(0).toUpperCase()}
        </Avatar>
      ),
    },
    {
      title: 'Username',
      dataIndex: 'preferred_username',
      key: 'username',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      ellipsis: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => v ? <StatusBadge status={v} /> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Posts',
      dataIndex: 'post_count',
      key: 'posts',
      width: 80,
      align: 'right',
    },
    {
      title: 'Followers',
      dataIndex: 'follower_count',
      key: 'followers',
      width: 90,
      align: 'right',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created',
      render: (v: string) => v ? formatTime(v) : '—',
    },
  ];

  // ── Column definitions: sessions table within drawer ─────────────

  const sessionColumns: ColumnsType<actorsApi.ActorSession> = [
    {
      title: 'Device',
      dataIndex: 'device_type',
      key: 'device',
      render: (v: string) => <Text>{v || 'Unknown'}</Text>,
    },
    {
      title: 'IP',
      dataIndex: 'ip_address',
      key: 'ip',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: 'Last Active',
      dataIndex: 'last_active_at',
      key: 'last_active',
      render: (v: string) => v ? formatRelativeTime(v) : '—',
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      key: 'expires',
      render: (v: string) => v ? formatTime(v) : '—',
    },
    {
      title: 'Status',
      key: 'status',
      width: 80,
      render: (_, r) => <StatusBadge status={r.revoked ? 'revoked' : 'active'} />,
    },
    {
      title: '',
      key: 'action',
      width: 80,
      render: (_, record) => {
        if (record.revoked) return null;

        return (
          <Popconfirm
            title="Revoke this session?"
            description="The actor will be signed out of this device."
            onConfirm={() => handleRevokeSession(record.session_id)}
          >
            <Button type="text" danger size="small">Revoke</Button>
          </Popconfirm>
        );
      },
    },
  ];

  // ── Drawer tab configuration ─────────────────────────────────────

  const drawerTabs = [
    {
      key: 'sessions',
      label: (
        <span>
          <Wifi size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Sessions
        </span>
      ),
      children: (
        <Table
          dataSource={actorSessions}
          columns={sessionColumns}
          rowKey="session_id"
          size="small"
          loading={sessionsLoading}
          pagination={false}
          locale={{ emptyText: 'No sessions found' }}
        />
      ),
    },
    {
      key: 'password',
      label: (
        <span>
          <KeyRound size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Password Reset
        </span>
      ),
      children: (
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleResetPassword}
          disabled={resetting}
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Reset the password for this actor. They will need to use the new password on next login.
          </Text>
          <Form.Item
            name="new_password"
            label="New Password"
            rules={[
              { required: true, message: 'Please enter a new password' },
              { min: 8, message: 'Minimum 8 characters' },
            ]}
          >
            <Input.Password placeholder="Enter new password" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="Confirm Password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: 'Please confirm the password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="Confirm new password" autoComplete="new-password" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={resetting}
            icon={<KeyRound size={14} />}
          >
            Reset Password
          </Button>
        </Form>
      ),
    },
  ];

  // ── Render ───────────────────────────────────────────────────────

  return (
    <Flexbox gap={0}>
      <PageHeader
        title="Actors"
        subtitle="Manage registered actors and accounts"
        extra={
          <>
            <Input.Search
              placeholder="Search actors..."
              allowClear
              onSearch={handleSearch}
              style={{ width: 260 }}
              prefix={<Search size={14} />}
            />
            <Button
              icon={<RefreshCw size={14} />}
              onClick={handleRefresh}
            >
              Refresh
            </Button>
          </>
        }
      />

      {/* ── Actor table ─────────────────────────────────────────── */}
      <Flexbox style={{ padding: 24 }}>
        <Table
          dataSource={actors}
          columns={actorColumns}
          rowKey="ptid"
          size="small"
          loading={loading}
          onRow={(record) => ({
            onClick: () => handleRowClick(record),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            current: page,
            total,
            pageSize: PAGE_SIZE,
            onChange: (p) => setPage(p),
            showTotal: (t) => `Total ${t} actors`,
            showSizeChanger: false,
          }}
        />
      </Flexbox>

      {/* ── Actor detail drawer ─────────────────────────────────── */}
      <Drawer
        title={selectedActor ? `${selectedActor.preferred_username}` : 'Actor Detail'}
        open={drawerOpen}
        onClose={handleDrawerClose}
        width={560}
        destroyOnClose
      >
        {selectedActor && (
          <Flexbox gap={24}>
            {/* Actor profile section */}
            <Flexbox horizontal gap={16} align="flex-start">
              <Avatar
                src={selectedActor.avatar_url || undefined}
                size={64}
                style={{ backgroundColor: '#1677ff', flexShrink: 0 }}
              >
                {selectedActor.preferred_username?.charAt(0).toUpperCase()}
              </Avatar>

              <Flexbox gap={4}>
                <Text strong style={{ fontSize: 18 }}>
                  {selectedActor.name || selectedActor.preferred_username}
                </Text>
                <Text type="secondary">@{selectedActor.preferred_username}</Text>
                {selectedActor.summary && (
                  <Text style={{ marginTop: 4 }}>{selectedActor.summary}</Text>
                )}
              </Flexbox>
            </Flexbox>

            {/* Actor metadata */}
            <Descriptions
              column={2}
              size="small"
              bordered
              items={[
                {
                  key: 'ptid',
                  label: 'PTID',
                  children: <Text code copyable>{selectedActor.ptid}</Text>,
                  span: 2,
                },
                {
                  key: 'email',
                  label: 'Email',
                  children: selectedActor.email || '—',
                  span: 2,
                },
                {
                  key: 'status',
                  label: 'Status',
                  children: selectedActor.status
                    ? <StatusBadge status={selectedActor.status} />
                    : '—',
                },
                {
                  key: 'sessions',
                  label: 'Active Sessions',
                  children: selectedActor.session_count,
                },
                {
                  key: 'posts',
                  label: 'Posts',
                  children: selectedActor.post_count,
                },
                {
                  key: 'followers',
                  label: 'Followers',
                  children: selectedActor.follower_count,
                },
                {
                  key: 'following',
                  label: 'Following',
                  children: selectedActor.following_count,
                },
                {
                  key: 'created',
                  label: 'Created',
                  children: selectedActor.created_at
                    ? formatTime(selectedActor.created_at)
                    : '—',
                },
                {
                  key: 'last_login',
                  label: 'Last Login',
                  children: selectedActor.last_login_at
                    ? formatRelativeTime(selectedActor.last_login_at)
                    : 'Never',
                  span: 2,
                },
              ]}
            />

            {/* Sessions & password tabs */}
            <Tabs items={drawerTabs} />
          </Flexbox>
        )}
      </Drawer>
    </Flexbox>
  );
}
