import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import { MobilePinRequestSchema, MobilePinStatusSchema } from '../gen/proto/domain/mobile/security_pb';

export type NativePinInput = MessageInitShape<typeof MobilePinRequestSchema>;

async function call(command: string, input: NativePinInput = {}) {
  const requestBytes = Array.from(toBinary(MobilePinRequestSchema, create(MobilePinRequestSchema, input)));
  try {
    const response = await invoke<number[]>(command, { requestBytes });
    return fromBinary(MobilePinStatusSchema, Uint8Array.from(response));
  } finally {
    requestBytes.fill(0);
  }
}

export const readNativePin = (input?: NativePinInput) => call('mobile_pin_status', input);
export const unlockNativePin = (input: NativePinInput) => call('mobile_pin_unlock', input);
export const configureNativePin = (input: NativePinInput) => call('mobile_pin_configure', input);
export const lockNativePin = () => call('mobile_pin_lock');
export async function requestNativePinReset(input: NativePinInput): Promise<void> {
  const requestBytes = Array.from(toBinary(MobilePinRequestSchema, create(MobilePinRequestSchema, input)));
  await invoke<void>('mobile_pin_request_reset', { requestBytes });
}
export type NativePinStatus = Awaited<ReturnType<typeof readNativePin>>;

export function pinErrorKey(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return code === 'MOBILE_PIN_WRONG' ? 'mobile.settings.security.pinWrong'
    : code === 'MOBILE_PIN_COOLDOWN' ? 'mobile.settings.security.pinCooldown'
      : code === 'MOBILE_PIN_FORMAT' ? 'mobile.settings.security.pinFormat'
        : 'mobile.settings.security.pinFailed';
}
