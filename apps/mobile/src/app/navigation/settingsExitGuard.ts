export type SettingsExitAction = () => void | Promise<void>;
export type SettingsExitRequest = (action: SettingsExitAction) => void;

let activeRequest: SettingsExitRequest | null = null;
let activeOwner: symbol | null = null;

export function registerSettingsExitGuard(
  request: SettingsExitRequest,
): () => void {
  if (activeRequest) {
    throw new Error('mobile.settings.exitGuardAlreadyRegistered');
  }

  const owner = Symbol('mobile-settings-exit-guard');
  activeRequest = request;
  activeOwner = owner;

  return () => {
    if (activeOwner !== owner) return;
    activeRequest = null;
    activeOwner = null;
  };
}

export function requestSettingsExit(action: SettingsExitAction): void {
  if (activeRequest) {
    activeRequest(action);
    return;
  }
  void action();
}
