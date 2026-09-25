import { api } from '../../services/desktop_api';
import { registerAcceptanceHarness } from '../registry';
import { configureCurrentAcceptanceStation } from '../stationAccess';

interface ConfigureStationInput {
  stationUrl: string;
}

export function installAcceptanceHarness(): void {
  registerAcceptanceHarness('stationAccess', {
    configureStation: ({ stationUrl }: ConfigureStationInput) =>
      configureCurrentAcceptanceStation(stationUrl),

    async bindingState() {
      const registry = await api.stationList();
      return {
        ...registry.binding,
        activeUrl: registry.active_url ?? null,
      };
    },
  });
}
