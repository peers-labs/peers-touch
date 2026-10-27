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
  // Selector returns a primitive: a fresh filtered array per selection would
  // force an endless useSyncExternalStore rerender loop (React #185).
  const activeTaskCount = useTaskStore(
    (s) => s.tasks.filter(
      (task) => task.agentId === agentId && (task.status === 'running' || task.status === 'pending'),
    ).length,
  );

  if (activeTaskCount === 0) return null;

  return (
    <Badge
      count={activeTaskCount}
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
