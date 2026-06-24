import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { theme, Typography } from 'antd';

const { Text } = Typography;

interface ChatDeleteConfirmOverlayProps {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 消息删除确认弹层，用于主聊天和 Thread 面板。
 * 父容器需要 `position: relative` 使 overlay 正确覆盖。
 */
export function ChatDeleteConfirmOverlay({
  deleting,
  onCancel,
  onConfirm,
}: ChatDeleteConfirmOverlayProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      align="center"
      justify="center"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: 'rgba(15, 23, 42, 0.18)',
        padding: 24,
      }}
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <Flexbox
        gap={14}
        style={{
          width: 320,
          maxWidth: '100%',
          padding: 18,
          borderRadius: 8,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 15 }}>
            {t('chat.social.messageArea.deleteConfirmTitle')}
          </Text>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.45 }}>
            {t('chat.social.messageArea.deleteConfirmBody')}
          </Text>
        </Flexbox>
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button disabled={deleting} onClick={onCancel}>
            {t('chat.social.messageArea.cancel')}
          </Button>
          <Button type="primary" danger loading={deleting} onClick={onConfirm}>
            {t('chat.social.messageArea.deleteConfirmOk')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
