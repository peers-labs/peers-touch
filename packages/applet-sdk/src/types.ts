// SDK-specific types not covered by @peers-touch/applet-contract.

// Applet lifecycle events emitted by the host
export type AppletEvent =
  | 'launch'
  | 'show'
  | 'hide'
  | 'destroy'
  | 'page-show'
  | 'page-hide';

// Generic event callback
export type EventCallback = (data: unknown) => void;
