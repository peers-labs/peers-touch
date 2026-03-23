import { createElement } from 'react';
import { Server } from 'lucide-react';
import { registerModule } from './registry';
import { ProviderLayout } from '../components/settings/ProviderLayout';

function ProvidersPanel() {
  return createElement('div', { style: { height: '100%', overflow: 'hidden' } },
    createElement(ProviderLayout));
}

registerModule({
  id: 'providers',
  name: 'Providers',
  icon: Server,
  settingsPanel: ProvidersPanel,
  settingsEntry: { order: 10 },
});
