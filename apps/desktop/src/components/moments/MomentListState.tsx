import type { ReactNode } from 'react';
import { Button } from '@lobehub/ui';
import { Card, Empty, Skeleton, Typography, theme } from 'antd';

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
      <>
        {[0, 1, 2].map((item) => (
          <Card
            key={item}
            style={{
              marginBottom: 10,
              borderRadius: 16,
              borderColor: token.colorBorderSecondary,
            }}
            bodyStyle={{ padding: 16 }}
          >
            <Skeleton avatar active paragraph={{ rows: 3 }} title={{ width: '42%' }} />
          </Card>
        ))}
      </>
    );
  }

  if (!loading && empty) {
    return (
      <Card
        style={{
          borderRadius: 16,
          borderColor: token.colorBorderSecondary,
          background: token.colorBgContainer,
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text type="secondary">{emptyText}</Text>}
          style={{ padding: '34px 0', color: token.colorTextSecondary }}
        />
      </Card>
    );
  }

  if (!hasMore) return null;

  return (
    <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
      <Button shape="round" onClick={onLoadMore} loading={loading}>
        <Text type="secondary">{loadMoreText}</Text>
      </Button>
    </div>
  );
}
