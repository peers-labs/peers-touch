import { useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Divider, theme, Typography } from 'antd';
import { X, Search, BarChart3, LogOut, Ban, UserPlus } from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import { api } from '../../services/desktop_api';
import type { GroupMember } from '../../gen/proto/domain/chat/group_chat_pb';

const { Text, Title } = Typography;

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function MemberItem({ member }: { member: GroupMember }) {
  const { token } = theme.useToken();
  const name = member.nickname || member.actorDid.slice(0, 16);
  return (
    <Flexbox horizontal align="center" gap={10} style={{ padding: '6px 0' }}>
      <Flexbox
        align="center"
        justify="center"
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: token.colorFillSecondary,
          color: token.colorTextSecondary,
          fontSize: 13,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {getInitial(name)}
      </Flexbox>
      <Text ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{name}</Text>
    </Flexbox>
  );
}

export function ChatDetailPanel() {
  const { token } = theme.useToken();
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    sessions, groups, groupMembers,
    setShowDetail, loadGroupMembers,
  } = useSocialChatStore();

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const isGroup = activeTab === 'group';

  const currentName = (() => {
    if (activeTab === 'friend') {
      const s = sessions.find((s) => s.ulid === activeUlid);
      return s ? s.participantBDid || '' : '';
    }
    const g = groups.find((g) => g.ulid === activeUlid);
    return g?.name || '';
  })();

  const subtitle = (() => {
    if (activeTab === 'friend') return '';
    const g = groups.find((g) => g.ulid === activeUlid);
    return g?.description || `${g?.memberCount || 0} members`;
  })();

  const members: GroupMember[] = isGroup && activeUlid ? (groupMembers[activeUlid] || []) : [];

  useEffect(() => {
    if (isGroup && activeUlid) {
      loadGroupMembers(activeUlid);
    }
  }, [isGroup, activeUlid, loadGroupMembers]);

  return (
    <Flexbox
      style={{
        width: 320,
        height: '100%',
        background: token.colorBgContainer,
        overflow: 'auto',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 15 }}>Details</Text>
        <Button
          type="text"
          icon={<X size={16} />}
          onClick={() => setShowDetail(false)}
          style={{ width: 28, height: 28 }}
        />
      </Flexbox>

      <Flexbox align="center" gap={8} style={{ padding: '24px 16px 16px' }}>
        <Flexbox
          align="center"
          justify="center"
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            background: token.colorPrimary,
            color: '#fff',
            fontSize: 36,
            fontWeight: 600,
          }}
        >
          {getInitial(currentName)}
        </Flexbox>
        <Title level={5} style={{ margin: 0, textAlign: 'center' }}>{currentName}</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>{subtitle}</Text>
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      {isGroup && (
        <>
          <Flexbox style={{ padding: '12px 16px' }} gap={4}>
            <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 4 }}>
              <Text strong style={{ fontSize: 13 }}>Members ({members.length})</Text>
              <Button type="link" size="small" style={{ fontSize: 12, padding: 0 }} onClick={() => console.log('See all members')}>
                See all
              </Button>
            </Flexbox>
            {members.slice(0, 5).map((m) => (
              <MemberItem key={m.actorDid} member={m} />
            ))}
            <Button
              type="dashed"
              icon={<UserPlus size={14} />}
              block
              size="small"
              style={{ marginTop: 4 }}
              onClick={() => console.log('Add member')}
            >
              Add Member
            </Button>
          </Flexbox>
          <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />
        </>
      )}

      <Flexbox style={{ padding: '8px 16px' }} gap={2}>
        <Button
          type="text"
          icon={<Search size={16} />}
          style={{ justifyContent: 'flex-start', height: 36 }}
          block
          onClick={() => console.log('Search in conversation')}
        >
          Search in Conversation
        </Button>
        <Button
          type="text"
          icon={<BarChart3 size={16} />}
          style={{ justifyContent: 'flex-start', height: 36 }}
          block
        >
          Chat Statistics
        </Button>
      </Flexbox>

      <Divider style={{ margin: '0 16px', minWidth: 'auto', width: 'auto' }} />

      <Flexbox style={{ padding: '8px 16px 16px' }}>
        {isGroup ? (
          <Button
            type="text"
            danger
            icon={<LogOut size={16} />}
            style={{ justifyContent: 'flex-start', height: 36 }}
            block
            onClick={async () => {
              if (activeUlid) {
                try {
                  await api.groupChatLeaveGroup(activeUlid);
                  setShowDetail(false);
                } catch (e) {
                  console.error('leave group failed', e);
                }
              }
            }}
          >
            Leave Group
          </Button>
        ) : (
          <Button
            type="text"
            danger
            icon={<Ban size={16} />}
            style={{ justifyContent: 'flex-start', height: 36 }}
            block
            onClick={() => console.log('Block user')}
          >
            Block User
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
}
