/**
 * Agent Pilot — Create/Edit Issue modal
 */
import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Button, Flex } from 'antd';
import { Plus, Trash2, Copy } from 'lucide-react';
import type { Issue, ProjectStatus, Tag } from '../types';

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  projectId: string;
  statuses: ProjectStatus[];
  tags: Tag[];
  /** All issues in project, for parent selector (excludes current when editing) */
  allIssues?: Issue[];
  onCreateTag?: (name: string) => Promise<Tag>;
  initial?: Partial<Issue>;
  initialTagIds?: string[];
  defaultStatusId?: string;
  onDelete?: (id: string) => Promise<void>;
  onDuplicate?: (id: string) => Promise<void>;
  onOk: (values: {
    title: string;
    description?: string;
    status_id: string;
    priority?: string;
    assignee?: string;
    parent_issue_id?: string;
    tag_ids?: string[];
  }) => Promise<void>;
  onCancel: () => void;
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export function IssueFormModal({
  open,
  mode,
  projectId,
  statuses,
  tags,
  allIssues = [],
  onCreateTag,
  initial,
  initialTagIds = [],
  defaultStatusId,
  onDelete,
  onDuplicate,
  onOk,
  onCancel,
}: Props) {
  const [form] = Form.useForm();
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([]);
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => {
    setTagOptions(tags.map((t) => ({ label: t.name, value: t.id })));
  }, [tags]);

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name || !onCreateTag || !projectId) return;
    try {
      const t = await onCreateTag(name);
      setTagOptions((prev) => [...prev, { label: t.name, value: t.id }]);
      form.setFieldValue('tag_ids', [...(form.getFieldValue('tag_ids') || []), t.id]);
      setNewTagName('');
    } catch {
      // ignore
    }
  };

  const handleOk = async () => {
    const values = await form.validateFields();
    await onOk({
      title: values.title,
      description: values.description || undefined,
      status_id: values.status_id,
      priority: values.priority,
      assignee: values.assignee || undefined,
      parent_issue_id: values.parent_issue_id || undefined,
      tag_ids: values.tag_ids,
    });
    form.resetFields();
  };

  const handleDelete = async () => {
    if (!initial?.id || !onDelete) return;
    if (!confirm('Delete this issue?')) return;
    await onDelete(initial.id);
    onCancel();
  };

  const handleDuplicate = async () => {
    if (!initial?.id || !onDuplicate) return;
    await onDuplicate(initial.id);
    onCancel();
  };

  const showExtraButtons = mode === 'edit' && initial?.id && (onDelete || onDuplicate);
  const footer =
    mode === 'edit' && initial?.id ? (
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <div>{showExtraButtons && (
          <>
            {onDelete && (
              <Button danger icon={<Trash2 size={14} />} onClick={handleDelete}>
                Delete
              </Button>
            )}
            {onDuplicate && (
              <Button icon={<Copy size={14} />} onClick={handleDuplicate} style={{ marginLeft: onDelete ? 8 : 0 }}>
                Duplicate
              </Button>
            )}
          </>
        )}</div>
        <div>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="primary" onClick={handleOk} style={{ marginLeft: 8 }}>
            Save
          </Button>
        </div>
      </div>
    ) : undefined;

  return (
    <Modal
      title={mode === 'create' ? 'New Issue' : 'Edit Issue'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnClose
      okText={mode === 'create' ? 'Create' : 'Save'}
      footer={footer}
      afterOpenChange={(visible) => {
        if (visible) {
          form.setFieldsValue({
            title: initial?.title ?? '',
            description: initial?.description ?? '',
            status_id: initial?.status_id ?? defaultStatusId ?? statuses[0]?.id,
            priority: initial?.priority,
            assignee: initial?.assignee ?? '',
            parent_issue_id: initial?.parent_issue_id ?? undefined,
            tag_ids: initialTagIds,
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
        <Form.Item name="assignee" label="Assignee">
          <Input placeholder="Assignee name (e.g. john)" />
        </Form.Item>
        {allIssues.length > 0 && (
          <Form.Item name="parent_issue_id" label="Parent issue">
            <Select
              allowClear
              placeholder="None"
              options={allIssues
                .filter((i) => i.id !== initial?.id)
                .map((i) => ({ label: `${i.simple_id} ${i.title}`, value: i.id }))}
            />
          </Form.Item>
        )}
        <Form.Item name="tag_ids" label="Tags">
          <div>
            <Select
              mode="multiple"
              allowClear
              placeholder="Select tags"
              options={tagOptions}
              optionFilterProp="label"
              style={{ width: '100%', marginBottom: onCreateTag && projectId ? 8 : 0 }}
            />
            {onCreateTag && projectId && (
              <Flex gap={4} style={{ marginTop: 8 }}>
                <Input
                  placeholder="New tag name"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onPressEnter={(e) => {
                    e.preventDefault();
                    handleAddTag();
                  }}
                />
                <Button icon={<Plus size={14} />} onClick={handleAddTag}>
                  Add
                </Button>
              </Flex>
            )}
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}
