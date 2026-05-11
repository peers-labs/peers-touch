import type { ReactNode } from 'react';
import { Button, Empty, Spin, Typography, theme } from 'antd';

const { Text } = Typography;

interface MomentListStateProps {
  loading?: boolean;
  empty?: boolean;
  emptyText: ReactNode;
  loadMoreText?: ReactNode;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function MomentListState({
  loading,
  empty,
  emptyText,
  loadMoreText,
  hasMore,
  onLoadMore,
}: MomentListStateProps) {
  const { token } = theme.useToken();

  if (loading && empty) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '56px 0' }}>
        <Spin />
      </div>
    );
  }

  if (!loading && empty) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<Text type="secondary">{emptyText}</Text>}
        style={{ padding: '40px 0', color: token.colorTextSecondary }}
      />
    );
  }

  if (!hasMore) return null;

  return (
    <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
      <Button type="text" size="small" onClick={onLoadMore} loading={loading}>
        <Text type="secondary">{loadMoreText}</Text>
      </Button>
    </div>
  );
}
