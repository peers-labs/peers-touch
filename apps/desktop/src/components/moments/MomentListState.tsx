import type { ReactNode } from 'react';
import { Button, Empty, Skeleton } from '@peers-touch/ui';

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
  if (loading && empty) {
    return (
      <>
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            style={{ padding: 16 }}
          >
            <Skeleton lines={4} />
          </div>
        ))}
      </>
    );
  }

  if (!loading && empty) {
    return (
      <Empty description={emptyText} />
    );
  }

  if (!hasMore) return null;

  return (
    <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
      <Button actionId="moments.load-more" emphasis="quiet" onActivate={onLoadMore}
        execution={loading ? 'pending' : 'idle'}>
        {loadMoreText}
      </Button>
    </div>
  );
}
