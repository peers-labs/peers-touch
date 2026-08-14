import type { ModuleContract } from './contract.schema';

export const CHAT_CONTRACT: ModuleContract = {
  module: 'chat',
  description: 'Direct messaging: conversation create, send, receive, multi-round, badges',
  depends: ['auth'],

  runtime: {
    clientMode: 'dual',
    accounts: {
      a: { account: 'alice', role: 'sender' },
      b: { account: 'bob', role: 'receiver' },
    },
  },

  setup: [
    'Run auth setup for alice on client A',
    'Run auth setup for bob on client B',
    'Wait for both devices to complete MLS enrollment (messaging_debug shows enrolled=true)',
    'If no direct conversation exists between alice and bob: create via messaging_create_direct',
    'Bob hydrates to see the conversation (messaging_hydrate)',
  ],

  entryRoute: '/#/chat',
  readySelector: '[data-pt-conversation-item], [data-pt-empty-conversations]',

  matrix: [
    {
      id: 'chat-conv-list',
      name: 'Conversation list renders',
      clientMode: 'single',
      action: 'Navigate to chat, wait for conversation items',
      passCondition: '[data-pt-conversation-item] count >= 1',
    },
    {
      id: 'chat-send',
      name: 'Send message: state becomes pending/accepted',
      clientMode: 'dual',
      action: 'Alice calls messaging_send_message with plaintext',
      passCondition: 'response.ok and state is pending or accepted',
    },
    {
      id: 'chat-receive',
      name: 'Receiver drains and decrypts correctly',
      clientMode: 'dual',
      action: 'Bob calls messaging_drain then messaging_list_messages',
      passCondition: 'Bob sees message with matching plaintext',
    },
    {
      id: 'chat-reply',
      name: 'Bob replies, Alice receives',
      clientMode: 'dual',
      action: 'Bob sends, Alice drains',
      passCondition: 'Alice sees reply with matching plaintext',
    },
    {
      id: 'chat-multi-round',
      name: '3 bidirectional rounds without state drift',
      clientMode: 'dual',
      action: '3x (Alice send → Bob drain → Bob reply → Alice drain)',
      passCondition: 'All 6 messages delivered, no authority_head errors',
    },
    {
      id: 'chat-ui-render',
      name: 'Message appears in UI after send',
      clientMode: 'single',
      action: 'After send, check DOM for new message item',
      passCondition: '[data-pt-message-item] count increases',
    },
    {
      id: 'chat-badge',
      name: 'Unread badge on new message',
      clientMode: 'dual',
      action: 'Alice sends while Bob is on another page',
      passCondition: '[data-pt-badge="chat"] visible on client B',
    },
    {
      id: 'chat-badge-clear',
      name: 'Badge clears when conversation opened',
      clientMode: 'dual',
      action: 'Bob navigates to chat and opens conversation',
      passCondition: '[data-pt-badge="chat"] gone or count=0',
    },
  ],
};
