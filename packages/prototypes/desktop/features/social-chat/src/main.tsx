import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { SocialChatPrototype } from './SocialChatPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#6b5bd6',
          borderRadius: 8,
        },
      }}
    >
      <SocialChatPrototype />
    </ConfigProvider>
  </StrictMode>,
);
