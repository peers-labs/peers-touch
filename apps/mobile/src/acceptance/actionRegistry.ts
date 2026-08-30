import {
  MOBILE_ACCEPTANCE_ACTION_NAMES,
  type MobileAcceptanceAction,
  type MobileAcceptanceActionName,
  type MobileAcceptanceNamespace,
} from './contracts';

export class MobileAcceptanceActionRegistry {
  readonly #actions = new Map<
    MobileAcceptanceActionName,
    MobileAcceptanceAction<MobileAcceptanceActionName>
  >();

  register<Name extends MobileAcceptanceActionName>(
    name: Name,
    action: MobileAcceptanceAction<Name>,
  ): void {
    if (this.#actions.has(name)) {
      throw new Error(`acceptance.mobile.duplicateAction:${name}`);
    }
    this.#actions.set(
      name,
      action as MobileAcceptanceAction<MobileAcceptanceActionName>,
    );
  }

  expose(): MobileAcceptanceNamespace {
    const missingActions = MOBILE_ACCEPTANCE_ACTION_NAMES.filter(
      (name) => !this.#actions.has(name),
    );
    if (missingActions.length > 0) {
      throw new Error(
        `acceptance.mobile.missingActions:${missingActions.join(',')}`,
      );
    }

    return Object.freeze(
      Object.fromEntries(this.#actions.entries()),
    ) as MobileAcceptanceNamespace;
  }
}
