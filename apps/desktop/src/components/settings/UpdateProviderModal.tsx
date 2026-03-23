import { useState } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { useProviderStore } from '../../store/provider';
import type { ProviderDetail } from '../../services/api';

interface UpdateProviderModalProps {
  open: boolean;
  detail: ProviderDetail;
  onClose: () => void;
}

export function UpdateProviderModal({ open, detail, onClose }: UpdateProviderModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { updateProvider } = useProviderStore();

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      // TODO: Add a dedicated update-profile endpoint for custom providers.
      // For now we call updateProvider which only updates api_key/base_url/enabled.
      await updateProvider(detail.id, detail.api_key, detail.base_url, detail.enabled);
      void values; // future: send name/description/logo update
      message.success('Provider updated');
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Edit Provider"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={loading}
      okText="Update"
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 16 }}
        initialValues={{
          id: detail.id,
          name: detail.name,
          description: detail.description,
          logo: detail.logo || '',
        }}
      >
        <Form.Item label="Provider ID">
          <Input value={detail.id} disabled />
        </Form.Item>
        <Form.Item
          name="name"
          label="Provider Name"
          rules={[{ required: true, message: 'Required' }]}
        >
          <Input placeholder="Display name for the provider" />
        </Form.Item>
        <Form.Item name="description" label="Provider Description">
          <Input.TextArea placeholder="Provider description (optional)" rows={2} />
        </Form.Item>
        <Form.Item name="logo" label="Provider Logo">
          <Input placeholder="https://example.com/logo.png" allowClear />
        </Form.Item>
      </Form>
    </Modal>
  );
}
