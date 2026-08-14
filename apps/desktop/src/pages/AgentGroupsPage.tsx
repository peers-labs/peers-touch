// Agent Groups page — lists, creates, and manages agent collaboration groups.

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Card, Modal, Form, Input, Select, Tag, Empty, Popconfirm, Avatar, theme } from 'antd';
import { PlusOutlined, DeleteOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';

import { useAgentGroupsStore, type AgentGroup, type OrchestrationMode } from '../store/agentGroups';
import { useAgentStore } from '../store/agent';

interface CreateFormValues {
  name: string;
  description: string;
  orchestrationMode: OrchestrationMode;
}

function OrchestrationModeBadge({ mode }: { mode: OrchestrationMode }) {
  const { t } = useTranslation('agent');
  const colorMap: Record<OrchestrationMode, string> = {
    sequential: 'blue',
    parallel: 'green',
    router: 'orange',
  };
  return (
    <Tag color={colorMap[mode]}>
      {t(`agent.groups.mode.${mode}`)}
    </Tag>
  );
}

function MemberPicker({
  groupId,
  existingMemberIds,
}: {
  groupId: string;
  existingMemberIds: string[];
}) {
  const { t } = useTranslation('agent');
  const agents = useAgentStore((s) => s.agents);
  const addMember = useAgentGroupsStore((s) => s.addMember);
  const [visible, setVisible] = useState(false);

  const availableAgents = agents.filter((a) => !existingMemberIds.includes(a.id));

  return (
    <>
      <Button
        size="small"
        icon={<UserAddOutlined />}
        onClick={() => setVisible(true)}
        disabled={availableAgents.length === 0}
      >
        {t('agent.groups.addMember')}
      </Button>
      <Modal
        title={t('agent.groups.addMember')}
        open={visible}
        onCancel={() => setVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Flexbox gap={8}>
          {availableAgents.map((agent) => (
            <Flexbox
              key={agent.id}
              horizontal
              align="center"
              gap={12}
              style={{ padding: '8px 12px', borderRadius: 6, cursor: 'pointer' }}
              onClick={() => {
                addMember(groupId, agent.id);
                setVisible(false);
              }}
            >
              <Avatar size={32} src={agent.avatar}>
                {agent.title?.[0] || agent.name[0]}
              </Avatar>
              <Flexbox>
                <span style={{ fontWeight: 500 }}>{agent.title || agent.name}</span>
                {agent.description && (
                  <span style={{ fontSize: 12, opacity: 0.6 }}>{agent.description}</span>
                )}
              </Flexbox>
            </Flexbox>
          ))}
          {availableAgents.length === 0 && (
            <Empty description={t('agent.groups.empty')} />
          )}
        </Flexbox>
      </Modal>
    </>
  );
}

function GroupCard({ group }: { group: AgentGroup }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const agents = useAgentStore((s) => s.agents);
  const deleteGroup = useAgentGroupsStore((s) => s.deleteGroup);
  const removeMember = useAgentGroupsStore((s) => s.removeMember);
  const [expanded, setExpanded] = useState(false);

  const memberAgents = group.memberAgentIds
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean);

  return (
    <Card
      hoverable
      onClick={() => setExpanded(!expanded)}
      style={{ marginBottom: 12 }}
      styles={{ body: { padding: '16px 20px' } }}
    >
      <Flexbox gap={12}>
        {/* Header */}
        <Flexbox horizontal align="center" distribution="space-between">
          <Flexbox horizontal align="center" gap={12}>
            <TeamOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
            <Flexbox>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{group.name}</span>
              {group.description && (
                <span style={{ fontSize: 12, opacity: 0.6 }}>{group.description}</span>
              )}
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <OrchestrationModeBadge mode={group.orchestrationMode} />
            <Tag>{t('agent.groups.members')}: {group.memberAgentIds.length}</Tag>
            <Popconfirm
              title={t('agent.groups.deleteConfirm')}
              onConfirm={(e) => {
                e?.stopPropagation();
                deleteGroup(group.id);
              }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </Flexbox>
        </Flexbox>

        {/* Expanded member list */}
        {expanded && (
          <Flexbox gap={8} style={{ marginTop: 8 }}>
            {memberAgents.map((agent) => {
              if (!agent) return null;
              return (
                <Flexbox
                  key={agent.id}
                  horizontal
                  align="center"
                  distribution="space-between"
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <Flexbox horizontal align="center" gap={8}>
                    <Avatar size={24} src={agent.avatar}>
                      {agent.title?.[0] || agent.name[0]}
                    </Avatar>
                    <span>{agent.title || agent.name}</span>
                  </Flexbox>
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMember(group.id, agent.id);
                    }}
                  >
                    {t('agent.groups.removeMember')}
                  </Button>
                </Flexbox>
              );
            })}
            <MemberPicker groupId={group.id} existingMemberIds={group.memberAgentIds} />
          </Flexbox>
        )}
      </Flexbox>
    </Card>
  );
}

export function AgentGroupsPage() {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const groups = useAgentGroupsStore((s) => s.groups);
  const loadGroups = useAgentGroupsStore((s) => s.loadGroups);
  const createGroup = useAgentGroupsStore((s) => s.createGroup);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm<CreateFormValues>();

  useEffect(() => {
    loadGroups();
    loadAgents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = useCallback(() => {
    form.validateFields().then((values) => {
      createGroup({
        name: values.name,
        description: values.description || '',
        orchestrationMode: values.orchestrationMode,
      });
      form.resetFields();
      setCreateModalOpen(false);
    });
  }, [form, createGroup]);

  return (
    <Flexbox
      style={{
        height: '100%',
        padding: 24,
        overflow: 'auto',
        background: token.colorBgLayout,
      }}
    >
      {/* Page header */}
      <Flexbox horizontal align="center" distribution="space-between" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          {t('agent.groups.title')}
        </h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          {t('agent.groups.create')}
        </Button>
      </Flexbox>

      {/* Group list */}
      {groups.length === 0 ? (
        <Empty
          description={t('agent.groups.empty')}
          style={{ marginTop: 60 }}
        />
      ) : (
        groups.map((group) => <GroupCard key={group.id} group={group} />)
      )}

      {/* Create modal */}
      <Modal
        title={t('agent.groups.create')}
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          form.resetFields();
          setCreateModalOpen(false);
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ orchestrationMode: 'sequential' }}>
          <Form.Item
            name="name"
            label={t('agent.groups.name')}
            rules={[{ required: true, message: t('agent.groups.name') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('agent.groups.description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="orchestrationMode" label={t('agent.groups.mode')}>
            <Select
              options={[
                { value: 'sequential', label: t('agent.groups.mode.sequential') },
                { value: 'parallel', label: t('agent.groups.mode.parallel') },
                { value: 'router', label: t('agent.groups.mode.router') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Flexbox>
  );
}
