package agent

import "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"

// ProviderManagement exposes Agent's business port to authenticated control
// planes. Dashboard never gains access to the Agent database.
func (s *agentSubServer) ProviderManagement() service.ProviderManagementPort {
	return s.providerManagement
}
