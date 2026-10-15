import { invoke, isTauri } from '@tauri-apps/api/core';

/** System clipboard uses the official Tauri plugin on native clients. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (isTauri()) {
    await invoke<void>('plugin:clipboard-manager|write_text', { text });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const previous = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('mobile.settings.copyFailed');
  } finally {
    input.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}
