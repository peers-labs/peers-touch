export interface ChatIdentityLoginState {
  phaseKind: string;
  lifecycleState: string;
  dataReady: boolean;
  authenticated: boolean;
}

export interface ChatPasswordLoginLifecycle {
  boot(): void;
  readState(): ChatIdentityLoginState;
  waitFor(
    predicate: (state: ChatIdentityLoginState) => boolean,
    description: string,
  ): Promise<void>;
  logout(): Promise<void>;
  loginWithPassword(account: string, password: string): Promise<void>;
  completeCurrentSession(): Promise<void>;
}

export function isChatLoginPreconditionReady(
  state: ChatIdentityLoginState,
): boolean {
  return (
    (state.phaseKind === 'accountGate' && state.dataReady)
    || (state.authenticated && state.lifecycleState === 'ready')
  );
}

export function isChatAccountGateReady(
  state: ChatIdentityLoginState,
): boolean {
  return state.phaseKind === 'accountGate' && state.dataReady;
}

export function isChatAuthenticatedReady(
  state: ChatIdentityLoginState,
): boolean {
  return state.authenticated && state.lifecycleState === 'ready';
}

export async function runChatPasswordLogin(
  lifecycle: ChatPasswordLoginLifecycle,
  account: string,
  password: string,
): Promise<void> {
  lifecycle.boot();
  await lifecycle.waitFor(
    isChatLoginPreconditionReady,
    'identity login precondition',
  );

  if (lifecycle.readState().authenticated) {
    await lifecycle.logout();
  }

  await lifecycle.waitFor(
    isChatAccountGateReady,
    'identity account gate before login',
  );
  await lifecycle.loginWithPassword(account, password);
  await lifecycle.completeCurrentSession();
  await lifecycle.waitFor(
    isChatAuthenticatedReady,
    'authenticated identity lifecycle',
  );
}
