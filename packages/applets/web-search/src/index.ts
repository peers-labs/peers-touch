/**
 * Web Search Applet — Frontend Extension
 *
 * Self-registers settings panel, dedicated page, and sidebar icon
 * into the applet frontend registry.
 */
import { Globe } from 'lucide-react';
import { registerApplet } from '@peers-touch/applet-sdk';
import { WebSearchSettings } from './Settings';
import { WebSearchAppletPage } from './Page';

registerApplet({
  id: 'web-search',
  settingsPanel: WebSearchSettings,
  page: WebSearchAppletPage,
  sidebarIcon: Globe,
});
