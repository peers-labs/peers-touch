/**
 * Agent Pilot — Create/Edit Issue modal
 */
import { Modal, Form, Input, Select } from 'antd';
import type { Issue, ProjectStatus } from '../types';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  statuses: ProjectStatus[];
  initial?: Partial<Issue>;
  defaultStatusId?: string;
  onOk: (values: { title: string; description?: string; status_id: string; priority?: string }) => Promise<void>;
  onCancel: () => void;
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export function IssueFormModal({
  open,
  mode,
  statuses,
  initial,
  defaultStatusId,
  onOk,
  onCancel,
}: Props) {
  const [form] = Form.useForm();

  const handleOk = async () => {
    const values = await form.validateFields();
    await onOk({
      title: values.title,
      description: values.description || undefined,
      status_id: values.status_id,
      priority: values.priority,
    });
    form.resetFields();
  };

  return (
    <Modal
      title={mode === 'create' ? 'New Issue' : 'Edit Issue'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnClose
      okText={mode === 'create' ? 'Create' : 'Save'}
      afterOpenChange={(visible) => {
        if (visible) {
          form.setFieldsValue({
            title: initial?.title ?? '',
            description: initial?.description ?? '',
            status_id: initial?.status_id ?? defaultStatusId ?? statuses[0]?.id,
            priority: initial?.priority,
          });
        }
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="title"
          label="Title"
          rules={[{ required: true, message: 'Title is required' }]}
        >
          <Input placeholder="Issue title" />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="Optional description" />
        </Form.Item>
        <Form.Item name="status_id" label="Status">
          <Select
            options={statuses.map((s) => ({ label: s.name, value: s.id }))}
            placeholder="Select status"
          />
        </Form.Item>
        <Form.Item name="priority" label="Priority">
          <Select
            allowClear
            options={PRIORITIES.map((p) => ({ label: p, value: p }))}
            placeholder="Optional"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
