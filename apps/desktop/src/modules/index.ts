/**
 * Module registrations.
 * Import this file once (in main.tsx) to trigger all self-registrations.
 */
import './providers';
import './model-service';
import './tts';
import './account';
import './skills';
import './mcp';
import './channels';
import './cron';
import './command-menu';
import './memory';
import './oss';
import './applets';
import './logs';
import { getDesktopHostPolicy } from '../kernel/hostPolicy';
import { registerMomentsModule } from './moments';

export function registerModulesForHost(): void {
  if (getDesktopHostPolicy().nativeSocialEnabled) {
    registerMomentsModule();
  }
}
