// Process-singleton registration for pages that have been migrated to
// the kernel `PageDescriptor` contract. This module is imported once
// from the boot path; pages that are not yet migrated continue to be
// rendered by the legacy `PageRouter` (passed to `<PageHost />` as the
// `fallback` prop).
//
// Add new pages by importing their descriptor module here. Each
// descriptor module owns its own `runtimes/*Runtime.ts` registration
// (so the boot pipeline can install + bootstrap them in order).

import { registerSearchPage } from './SearchPage.descriptor';
import { registerSocialChatPage } from './SocialChatPage.descriptor';
import { registerSettingsPage } from './SettingsPage.descriptor';
import { registerAppletsPage } from './AppletsPage.descriptor';
import { registerAppletRuntimePage } from './AppletRuntimePage.descriptor';

let registered = false;

/** Idempotently register every kernel-managed page descriptor. */
export function registerKernelPages(): void {
  if (registered) return;
  registered = true;
  registerSearchPage();
  registerSocialChatPage();
  registerSettingsPage();
  registerAppletsPage();
  registerAppletRuntimePage();
}
