import type { ModuleContract } from './contract.schema';

export const AUTH_CONTRACT: ModuleContract = {
  module: 'auth',
  description: 'Account authentication and session management',
  depends: [],

  runtime: {
    clientMode: 'single',
    accounts: { a: { account: 'alice', role: 'authenticator' } },
  },

  setup: [
    'Check if account has restorable session (account_list_restorable)',
    'If session exists: call account_switch with stored id',
    'If no session: call auth_login with email + password from accounts.ts',
    'Wait for frontend to sync: [data-pt-primary-nav] must appear',
  ],

  entryRoute: '/#/chat',
  readySelector: '[data-pt-primary-nav]',

  matrix: [
    {
      id: 'auth-login',
      name: 'Authenticate and reach ready shell',
      clientMode: 'single',
      action: 'Login or restore session via gateway, wait for navigation to render',
      passCondition: '[data-pt-primary-nav] count > 0',
    },
    {
      id: 'auth-identity',
      name: 'Actor identity available after auth',
      clientMode: 'single',
      action: 'Evaluate window.__PT_ACCEPTANCE__.getRealtimeDevice()',
      passCondition: 'actorId is non-empty string',
    },
  ],
};
