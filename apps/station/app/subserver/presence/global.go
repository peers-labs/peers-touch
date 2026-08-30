package presence

import (
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/presence/application"
)

var (
	serviceMu     sync.RWMutex
	globalService *application.Service
)

func setGlobalService(service *application.Service) {
	serviceMu.Lock()
	defer serviceMu.Unlock()
	globalService = service
}

// IsActorOnline exposes the global actor presence projection to business subservers.
// Callers must treat false as "not currently reachable"; the presence subserver
// remains the only owner of how that answer is derived.
func IsActorOnline(actorPTID string) bool {
	serviceMu.RLock()
	service := globalService
	serviceMu.RUnlock()
	if service == nil {
		return false
	}
	return service.IsOnline(actorPTID)
}
