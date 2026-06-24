import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SocialChatPrototype } from './SocialChatPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SocialChatPrototype />
  </StrictMode>,
);
