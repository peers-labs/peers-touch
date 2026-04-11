/**
 * SecurityPage — Centralized security management hub.
 * Provides admin account management (create/enable/disable/delete),
 * password change form, dashboard session oversight, and audit log review.
 *
 * This is the most critical administrative page in the dashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Modal, Form, Input, Space, Typography, message, Popconfirm, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Flexbox } from 'react-layout-kit';
import { UserPlus, Shield, KeyRound, ScrollText } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import * as adminsApi from '../api/admins';
import * as authApi from '../api/auth';
import * as systemApi from '../api/system';
import { useAuthStore } from '../store/auth';
import { formatTime, formatRelativeTime } from '../utils/format';
import { log } from '../utils/logger';

const { Text } = Typography;

export default function SecurityPage() {
  // ── Admin management state ──────────────────────────────────────────
  const [admins, setAdmins] = useState<adminsApi.DashboardAdmin[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const { admin: currentAdmin } = useAuthStore();

  // ── Password change ─────────────────────────────────────────────────
  const [passwordForm] = Form.useForm();

  // ── Audit logs ──────────────────────────────────────────────────────
  const [auditLogs, setAuditLogs] = useState<systemApi.AuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);

  // ── Dashboard sessions ──────────────────────────────────────────────
  const [dashSessions, setDashSessions] = useState<systemApi.DashboardSession[]>([]);

  // ── Data loaders ────────────────────────────────────────────────────

  const loadAdmins = useCallback(async () => {
    try {
      const items = await adminsApi.listAdmins();
      setAdmins(items || []);
    } catch (err) {
      log.error('security', 'Failed to load admins');
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    try {
      const result = await systemApi.getAuditLogs(auditPage, 20);
      setAuditLogs(result.items || []);
      setAuditTotal(result.total);
    } catch (err) {
      log.error('security', 'Failed to load audit logs');
    }
  }, [auditPage]);

  const loadDashSessions = useCallback(async () => {
    try {
      const result = await systemApi.getDashboardSessions();
      setDashSessions(result.items || []);
    } catch (err) {
      log.error('security', 'Failed to load dashboard sessions');
    }
  }, []);

  useEffect(() => { loadAdmins(); loadDashSessions(); }, [loadAdmins, loadDashSessions]);
  useEffect(() => { loadAuditLogs(); }, [loadAuditLogs]);

  // ── Action handlers ─────────────────────────────────────────────────

  const handleCreateAdmin = async (values: adminsApi.CreateAdminRequest) => {
    try {
      await adminsApi.createAdmin(values);
      message.success('Admin created successfully');
      setCreateModalOpen(false);
      createForm.resetFields();
      loadAdmins();
    } catch (err) {
      message.error('Failed to create admin');
    }
  };

  const handleChangePassword = async (values: { old_password: string; new_password: string }) => {
    try {
      await authApi.changePassword(values.old_password, values.new_password);
      message.success('Password changed. Please log in again.');
      passwordForm.resetFields();
    } catch (err) {
      message.error('Failed to change password');
    }
  };

  // ── Column definitions ──────────────────────────────────────────────

  const adminColumns: ColumnsType<adminsApi.DashboardAdmin> = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: 'Display Name',
      dataIndex: 'display_name',
      key: 'display_name',
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (v: string) => <Tag color={v === 'super' ? 'gold' : 'blue'}>{v}</Tag>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => <StatusBadge status={r.disabled ? 'disabled' : 'enabled'} />,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created',
      render: (v: string) => formatTime(v),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => {
        // Prevent self-modification for safety
        if (record.id === currentAdmin?.id) {
          return <Text type="secondary">Current</Text>;
        }

        return (
          <Space>
            {record.disabled ? (
              <Popconfirm
                title="Enable this admin?"
                onConfirm={async () => { await adminsApi.enableAdmin(record.id); loadAdmins(); }}
              >
                <Button type="link" size="small">Enable</Button>
              </Popconfirm>
            ) : (
              <Popconfirm
                title="Disable this admin?"
                onConfirm={async () => { await adminsApi.disableAdmin(record.id); loadAdmins(); }}
              >
                <Button type="link" size="small" danger>Disable</Button>
              </Popconfirm>
            )}

            <Popconfirm
              title="Delete this admin permanently?"
              description="This action cannot be undone."
              onConfirm={async () => { await adminsApi.deleteAdmin(record.id); loadAdmins(); }}
            >
              <Button type="link" size="small" danger>Delete</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const dashSessionColumns: ColumnsType<systemApi.DashboardSession> = [
    { title: 'Admin', dataIndex: 'username', key: 'username' },
    { title: 'IP', dataIndex: 'ip_address', key: 'ip', render: (v: string) => <Text code>{v}</Text> },
    { title: 'Last Active', dataIndex: 'last_active_at', key: 'last_active', render: (v: string) => formatRelativeTime(v) },
    { title: 'Expires', dataIndex: 'expires_at', key: 'expires', render: (v: string) => formatTime(v) },
    {
      title: '',
      key: 'action',
      width: 80,
      render: (_, r) => (
        <Popconfirm
          title="Revoke this session?"
          onConfirm={async () => { await systemApi.revokeDashboardSession(r.session_id); loadDashSessions(); }}
        >
          <Button type="text" danger size="small">Revoke</Button>
        </Popconfirm>
      ),
    },
  ];

  const auditColumns: ColumnsType<systemApi.AuditLog> = [
    { title: 'Admin', dataIndex: 'username', key: 'username' },
    { title: 'Action', dataIndex: 'action', key: 'action', render: (v: string) => <Tag>{v}</Tag> },
    { title: 'Resource', dataIndex: 'resource', key: 'resource' },
    { title: 'Detail', dataIndex: 'detail', key: 'detail', ellipsis: true },
    { title: 'IP', dataIndex: 'ip_address', key: 'ip' },
    { title: 'Time', dataIndex: 'created_at', key: 'time', render: (v: string) => formatTime(v) },
  ];

  // ── Tab configuration ───────────────────────────────────────────────

  const tabItems = [
    {
      key: 'admins',
      label: (
        <span>
          <Shield size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Administrators
        </span>
      ),
      children: (
        <Flexbox gap={16}>
          <Flexbox horizontal justify="flex-end">
            <Button
              type="primary"
              icon={<UserPlus size={14} />}
              onClick={() => setCreateModalOpen(true)}
            >
              Add Admin
            </Button>
          </Flexbox>

          <Table
            dataSource={admins}
            columns={adminColumns}
            rowKey="id"
            size="small"
            pagination={false}
          />
        </Flexbox>
      ),
    },
    {
      key: 'password',
      label: (
        <span>
          <KeyRound size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Change Password
        </span>
      ),
      children: (
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleChangePassword}
          style={{ maxWidth: 400 }}
        >
          <Form.Item
            name="old_password"
            label="Current Password"
            rules={[{ required: true, message: 'Please enter current password' }]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="new_password"
            label="New Password"
            rules={[
              { required: true, message: 'Please enter new password' },
              { min: 8, message: 'Minimum 8 characters' },
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="Confirm Password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: 'Please confirm new password' },
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
            <Input.Password />
          </Form.Item>

          <Button type="primary" htmlType="submit">Change Password</Button>
        </Form>
      ),
    },
    {
      key: 'sessions',
      label: 'Dashboard Sessions',
      children: (
        <Table
          dataSource={dashSessions}
          columns={dashSessionColumns}
          rowKey="session_id"
          size="small"
          pagination={false}
        />
      ),
    },
    {
      key: 'audit',
      label: (
        <span>
          <ScrollText size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Audit Logs
        </span>
      ),
      children: (
        <Table
          dataSource={auditLogs}
          columns={auditColumns}
          rowKey="id"
          size="small"
          pagination={{
            current: auditPage,
            total: auditTotal,
            pageSize: 20,
            onChange: setAuditPage,
            showTotal: (t) => `Total ${t}`,
          }}
        />
      ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Flexbox gap={0}>
      <PageHeader title="Security" subtitle="Admin management, authentication and audit" />

      <Flexbox style={{ padding: 24 }}>
        <Tabs items={tabItems} />
      </Flexbox>

      {/* Create admin modal */}
      <Modal
        title="Create Admin"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={() => createForm.submit()}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreateAdmin}>
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Username is required' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Password is required' },
              { min: 8, message: 'Minimum 8 characters' },
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="display_name"
            label="Display Name"
            rules={[{ required: true, message: 'Display name is required' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item name="did" label="DID (optional)">
            <Input placeholder="Optional: Decentralized Identifier" />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
}
