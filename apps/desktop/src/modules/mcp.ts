import { Cable } from 'lucide-react';
import { registerModule } from './registry';
import { MCPTab } from '../components/MCPTab';

registerModule({
  id: 'mcp',
  name: 'MCP',
  icon: Cable,
  settingsPanel: MCPTab,
  settingsEntry: { order: 35 },
});
