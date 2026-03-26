import { sdk } from '@peers-touch/applet-sdk';

const ID = 'remote-cli';

export const api = {
  appletAction: <T = unknown>(action: string, params?: Record<string, unknown>) =>
    sdk.invoke<T>('applets_action', { id: ID, action, params }),
};
