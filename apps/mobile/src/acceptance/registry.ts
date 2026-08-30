import { MobileAcceptanceActionRegistry } from './actionRegistry';
import { mobileAcceptanceActions } from './actions';
import {
  type MobileAcceptanceAction,
  type MobileAcceptanceActionName,
  type MobileAcceptanceNamespace,
} from './contracts';

export function registerMobileAcceptanceAction<
  Name extends MobileAcceptanceActionName,
>(
  name: Name,
  action: MobileAcceptanceAction<Name>,
  registry: MobileAcceptanceActionRegistry,
): void {
  registry.register(name, action);
}

export function createMobileAcceptanceHarness(): MobileAcceptanceNamespace {
  const registry = new MobileAcceptanceActionRegistry();
  registerMobileAcceptanceAction(
    'build.identity',
    mobileAcceptanceActions['build.identity'],
    registry,
  );
  registerMobileAcceptanceAction(
    'station.add',
    mobileAcceptanceActions['station.add'],
    registry,
  );
  registerMobileAcceptanceAction(
    'station.replace',
    mobileAcceptanceActions['station.replace'],
    registry,
  );
  registerMobileAcceptanceAction(
    'access.submit',
    mobileAcceptanceActions['access.submit'],
    registry,
  );
  registerMobileAcceptanceAction(
    'oauth.start',
    mobileAcceptanceActions['oauth.start'],
    registry,
  );
  registerMobileAcceptanceAction(
    'oauth.status',
    mobileAcceptanceActions['oauth.status'],
    registry,
  );
  registerMobileAcceptanceAction(
    'oauth.cancel',
    mobileAcceptanceActions['oauth.cancel'],
    registry,
  );
  registerMobileAcceptanceAction(
    'oauth.replayHandle',
    mobileAcceptanceActions['oauth.replayHandle'],
    registry,
  );
  registerMobileAcceptanceAction(
    'oauth.negativeCallback',
    mobileAcceptanceActions['oauth.negativeCallback'],
    registry,
  );
  registerMobileAcceptanceAction(
    'lifecycle.restart',
    mobileAcceptanceActions['lifecycle.restart'],
    registry,
  );
  registerMobileAcceptanceAction(
    'native.deliverDeepLink',
    mobileAcceptanceActions['native.deliverDeepLink'],
    registry,
  );
  registerMobileAcceptanceAction(
    'projection.read',
    mobileAcceptanceActions['projection.read'],
    registry,
  );
  registerMobileAcceptanceAction(
    'cleanup',
    mobileAcceptanceActions.cleanup,
    registry,
  );
  return registry.expose();
}

export function installMobileAcceptanceHarness(
  target: Window = window,
): void {
  if (target.__PEERS_MOBILE_ACCEPTANCE__) {
    throw new Error('acceptance.mobile.duplicateHarness');
  }
  target.__PEERS_MOBILE_ACCEPTANCE__ = createMobileAcceptanceHarness();
}
