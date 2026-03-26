import { Terminal } from 'lucide-react';
import { registerApplet } from '@peers-touch/applet-sdk';
import { RemoteCLISettings } from './Settings';
import { RemoteCLIPage } from './Page';

registerApplet({
  id: 'remote-cli',
  settingsPanel: RemoteCLISettings,
  page: RemoteCLIPage,
  sidebarIcon: Terminal,
});
