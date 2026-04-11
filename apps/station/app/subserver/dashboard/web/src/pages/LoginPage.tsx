/**
 * Login page for dashboard admin authentication.
 * Renders a centered, themed login card with antd Form components.
 *
 * Replaced: 2026-04-10 — Upgraded from plain HTML form to antd Form
 * with proper validation, loading states, and theme token integration.
 */

import { Form, Input, Button, Typography, Alert, theme } from 'antd';
import { Shield } from 'lucide-react';
import { Flexbox } from 'react-layout-kit';
import { useAuthStore } from '../store/auth';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();
  const [form] = Form.useForm();
  const { token } = theme.useToken();

  const handleSubmit = async (values: { username: string; password: string }) => {
    await login(values.username, values.password);
  };

  return (
    <Flexbox
      align="center"
      justify="center"
      style={{
        height: '100vh',
        background: `linear-gradient(135deg, ${token.colorBgLayout} 0%, ${token.colorBgContainer} 100%)`,
      }}
    >
      <Flexbox
        gap={24}
        style={{
          width: 400,
          padding: 40,
          borderRadius: token.borderRadiusLG,
          background: token.colorBgElevated,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        {/* Brand identity section */}
        <Flexbox align="center" gap={12}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: token.colorPrimary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Shield size={24} color="#fff" />
          </div>
          <Title level={3} style={{ margin: 0 }}>Peers Station</Title>
          <Text type="secondary">Dashboard Administration</Text>
        </Flexbox>

        {/* Error feedback */}
        {error && (
          <Alert
            message={error}
            type="error"
            closable
            onClose={clearError}
            showIcon
          />
        )}

        {/* Login form */}
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
        >
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Please enter your username' }]}
          >
            <Input size="large" placeholder="Username" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password size="large" placeholder="Password" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={loading}
            >
              Sign In
            </Button>
          </Form.Item>
        </Form>

        <Text type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
          Access restricted to authorized administrators
        </Text>
      </Flexbox>
    </Flexbox>
  );
}
