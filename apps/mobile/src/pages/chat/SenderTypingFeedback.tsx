import { Button, Spin, Typography } from 'antd';
import { RotateCcw } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { SenderTypingFeedback as SenderTypingFeedbackState } from '../../features/chat/typingFeedbackState';

const { Text } = Typography;

export function SenderTypingFeedback({
  feedback,
  onRetry,
}: {
  readonly feedback: SenderTypingFeedbackState;
  readonly onRetry: () => void;
}) {
  const { t } = useMobileI18n();

  if (feedback.phase === 'idle') return null;

  const failed = feedback.phase === 'failed';
  return (
    <div
      className={`sender-typing-feedback ${failed ? 'failed' : ''}`}
      data-sender-typing-state={feedback.phase}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
    >
      {!failed ? <Spin size="small" /> : null}
      <Text type={failed ? 'danger' : 'secondary'}>
        {feedback.phase === 'retrying'
          ? t('mobile.chat.commandRetrying')
          : t('mobile.chat.typing')}
      </Text>
      {failed ? (
        <>
          <Text type="danger">{t('mobile.recovery.runtimeStatus.failed')}</Text>
          <Button
            size="small"
            type="link"
            icon={<RotateCcw size={13} />}
            onClick={onRetry}
          >
            {t('common.action.retry')}
          </Button>
        </>
      ) : null}
    </div>
  );
}
