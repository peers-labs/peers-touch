// TaskIndicator — badge showing active task count for an agent in chat.
// Clicking navigates to the tasks page.

import { Badge, theme } from 'antd';
import { CheckSquareOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '../../store/tasks';

interface TaskIndicatorProps {
  agentId: string;
  onClick?: () => void;
}

export function TaskIndicator({ agentId, onClick }: TaskIndicatorProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const activeTasks = useTaskStore((s) =>
    s.tasks.filter(
      (task) =>
        task.agentId === agentId &&
        (
          task.status === 'running' ||
          task.status === 'pending' ||
          task.status === 'needs_user'
        ),
    ),
  );

  if (activeTasks.length === 0) return null;

  return (
    <Badge
      count={activeTasks.length}
      size="small"
      title={t('agent.tasks.active')}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <CheckSquareOutlined style={{ fontSize: 16, color: token.colorPrimary, cursor: 'pointer' }} />
    </Badge>
  );
}
