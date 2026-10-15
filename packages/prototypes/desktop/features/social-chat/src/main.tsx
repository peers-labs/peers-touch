import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import {
  createAntdTokenTheme,
  createDesignTokenCssVariables,
} from '../../../../shared/design-tokens';
import { SocialChatPrototype } from './SocialChatPrototype';

const cssVariables = createDesignTokenCssVariables('light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={createAntdTokenTheme('light')}>
      <div style={{ ...cssVariables, height: '100%' }}>
        <SocialChatPrototype />
      </div>
    </ConfigProvider>
  </StrictMode>,
);
