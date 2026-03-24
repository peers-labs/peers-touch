import { useState, useEffect, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Button,
  Input,
  Select,
  InputNumber,
  Form,
  Modal,
  message,
  Empty,
  Typography,
  Popconfirm,
  Tag,
  theme,
} from 'antd';
import { Plus, Trash2, Plug, Server } from 'lucide-react';
import { api } from '../../services/desktop_api';
import type { Connection } from './types';

const { Text } = Typography;

const AUTH_OPTIONS = [
  { value: 'password', label: 'Password' },
  { value: 'key', label: 'Private Key (inline)' },
  { value: 'key_file', label: 'Private Key File' },
  { value: 'agent', label: 'SSH Agent' },
];

export function RemoteCLISettings() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const { token } = theme.useToken();
  const [form] = Form.useForm();

  const loadConnections = useCallback(async () => {
    try {
      const data = await api.appletAction<{ connections: Connection[] }>(
        'remote-cli',
        'list-connections',
      );
      setConnections(data.connections || []);
    } catch {
      // Applet may not be active yet
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const action = editingId ? 'update-connection' : 'add-connection';
      const params: Record<string, any> = {
        name: values.name,
        host: values.host,
        port: values.port || 22,
        username: values.username,
        auth_type: values.auth_type,
        key_path: values.key_path || '',
        secret: values.secret || '',
      };
      if (editingId) {
        params.id = editingId;
      }
      await api.appletAction('remote-cli', action, params);
      message.success(editingId ? 'Connection updated' : 'Connection added');
      setModalOpen(false);
      setEditingId(null);
      form.resetFields();
      loadConnections();
    } catch (e: any) {
      message.error(e.message);
    }
  }, [editingId, form, loadConnections]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.appletAction('remote-cli', 'remove-connection', { id });
        message.success('Connection removed');
        loadConnections();
      } catch (e: any) {
        message.error(e.message);
      }
    },
    [loadConnections],
  );

  const handleTest = useCallback(async (id: string) => {
    setTesting(id);
    try {
      const result = await api.appletAction<{ ok: boolean; error?: string }>(
        'remote-cli',
        'test-connection',
        { id },
      );
      if (result.ok) {
        message.success('Connection successful');
      } else {
        message.error(`Connection failed: ${result.error}`);
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setTesting(null);
    }
  }, []);

  const openEdit = useCallback(
    (conn: Connection) => {
      setEditingId(conn.id);
      form.setFieldsValue({
        name: conn.name,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        auth_type: conn.auth_type,
        key_path: conn.key_path || '',
        secret: '',
      });
      setModalOpen(true);
    },
    [form],
  );

  const openAdd = useCallback(() => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ port: 22, auth_type: 'password' });
    setModalOpen(true);
  }, [form]);

  const authType = Form.useWatch('auth_type', form);

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal justify="space-between" align="center">
        <Text strong>SSH Connections</Text>
        <Button icon={<Plus size={14} />} size="small" onClick={openAdd}>
          Add Connection
        </Button>
      </Flexbox>

      {connections.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No connections configured"
        />
      ) : (
        <Flexbox gap={8}>
          {connections.map((conn) => (
            <Flexbox
              key={conn.id}
              horizontal
              align="center"
              gap={10}
              style={{
                padding: '10px 14px',
                background: token.colorFillQuaternary,
                borderRadius: 8,
              }}
            >
              <Server size={16} color={token.colorTextSecondary} />
              <Flexbox style={{ flex: 1 }}>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{conn.name}</span>
                <span style={{ fontSize: 11, color: token.colorTextDescription }}>
                  {conn.username}@{conn.host}:{conn.port}
                </span>
              </Flexbox>
              <Tag style={{ fontSize: 11 }}>{conn.auth_type}</Tag>
              <Button
                size="small"
                type="text"
                loading={testing === conn.id}
                icon={<Plug size={13} />}
                onClick={() => handleTest(conn.id)}
              >
                Test
              </Button>
              <Button size="small" type="text" onClick={() => openEdit(conn)}>
                Edit
              </Button>
              <Popconfirm
                title="Remove this connection?"
                onConfirm={() => handleDelete(conn.id)}
                okText="Remove"
              >
                <Button size="small" type="text" danger icon={<Trash2 size={13} />} />
              </Popconfirm>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      <Modal
        title={editingId ? 'Edit Connection' : 'Add Connection'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => {
          setModalOpen(false);
          setEditingId(null);
        }}
        okText="Save"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Name">
            <Input placeholder="My Server" />
          </Form.Item>
          <Flexbox horizontal gap={12}>
            <Form.Item
              name="host"
              label="Host"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="192.168.1.100" />
            </Form.Item>
            <Form.Item name="port" label="Port" style={{ width: 100 }}>
              <InputNumber min={1} max={65535} placeholder="22" style={{ width: '100%' }} />
            </Form.Item>
          </Flexbox>
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true }]}
          >
            <Input placeholder="root" />
          </Form.Item>
          <Form.Item name="auth_type" label="Auth Type">
            <Select options={AUTH_OPTIONS} />
          </Form.Item>
          {(authType === 'password' || authType === 'key') && (
            <Form.Item
              name="secret"
              label={authType === 'password' ? 'Password' : 'Private Key'}
            >
              {authType === 'password' ? (
                <Input.Password
                  placeholder={editingId ? '(unchanged)' : 'Enter password'}
                />
              ) : (
                <Input.TextArea
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                />
              )}
            </Form.Item>
          )}
          {authType === 'key_file' && (
            <>
              <Form.Item name="key_path" label="Key File Path" rules={[{ required: true }]}>
                <Input placeholder="~/.ssh/id_rsa" />
              </Form.Item>
              <Form.Item name="secret" label="Passphrase (optional)">
                <Input.Password placeholder="Key passphrase" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Flexbox>
  );
}
