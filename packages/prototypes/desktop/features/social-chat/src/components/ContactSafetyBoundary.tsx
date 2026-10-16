import { Button } from '@lobehub/ui';
import { Typography } from 'antd';
import { ShieldBan } from 'lucide-react';
import { Flexbox } from 'react-layout-kit';
import english from '../../../../../../locales/en/chat.json';
import chinese from '../../../../../../locales/zh-CN/chat.json';
import { CHAT_JOURNEY_LOCALE } from '../mock';

/** Browser previews have no authenticated Station relationship projection. */
export function ContactSafetyBoundary() {
  const copy = CHAT_JOURNEY_LOCALE === 'zh' ? chinese : english;
  return (
    <Flexbox gap={8} style={{ width: '100%' }} data-chat-contact-safety data-chat-contact-blocked="unknown">
      <Button
        block
        danger
        disabled
        icon={<ShieldBan size={16} />}
        data-chat-contact-block-action="block"
      >
        {copy['chat.social.safety.block']}
      </Button>
      <Typography.Text type="secondary" role="status" style={{ textAlign: 'center' }}>
        {copy['chat.social.safety.unavailable']}
      </Typography.Text>
    </Flexbox>
  );
}
