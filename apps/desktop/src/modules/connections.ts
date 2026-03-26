import { KeyRound } from 'lucide-react';
import { registerModule } from './registry';
import { ConnectionsTab } from '../components/settings/OAuth2Tab';

const isAdvancedConnectionsEnabled = (() => {
  const envEnabled = import.meta.env.VITE_ENABLE_ADVANCED_OAUTH_CONNECTIONS === 'true';
  const runtimeEnabled = (() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('pt.settings.advanced_oauth_connections') === '1';
    } catch {
      return false;
    }
  })();
  return envEnabled || runtimeEnabled;
})();

if (isAdvancedConnectionsEnabled) {
  registerModule({
    id: 'connections',
    name: 'OAuth Client Connections',
    icon: KeyRound,
    settingsPanel: ConnectionsTab,
    settingsEntry: {
      order: 26,
      label: 'Advanced Connections',
      tooltip: 'Platform OAuth client configuration, not account sign-in.',
    },
  });
}
