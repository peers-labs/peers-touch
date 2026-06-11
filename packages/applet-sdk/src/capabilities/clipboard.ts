import type { BridgeAdapter } from '../adapter.js';

export interface ClipboardSetTextOptions {
  text: string;
  userActivated?: boolean;
}

export interface ClipboardAPI {
  getText(): Promise<string>;
  setText(input: ClipboardSetTextOptions): Promise<void>;
}

export function createClipboardAPI(adapter: BridgeAdapter): ClipboardAPI {
  return {
    getText(): Promise<string> {
      return adapter.invoke('clipboard.getText') as Promise<string>;
    },
    setText(input: ClipboardSetTextOptions): Promise<void> {
      return adapter.invoke('clipboard.setText', input as unknown as Record<string, unknown>) as Promise<void>;
    },
  };
}
