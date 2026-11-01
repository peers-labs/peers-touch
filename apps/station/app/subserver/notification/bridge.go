package notification

import (
	"errors"
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
)

// ErrBridgeUnregistered is returned when a producer asks the bridge to
// deliver a notification before the notification SubServer has registered
// its service. Producers MUST treat this as best-effort failure: log it,
// count it, and never roll back the already-committed business write.
var ErrBridgeUnregistered = errors.New("notification bridge service is not registered")

// NotificationBridge provides a cross-SubServer notification production capability.
// It adapts the notification.Service into a fire-and-forget interface
// that other SubServers can call without direct import dependency on the SubServer.
var globalBridge struct {
	mu      sync.RWMutex
	service *application.Service
}

// RegisterService registers the notification service globally.
// Called by the notification SubServer during Init().
func RegisterService(svc *application.Service) {
	globalBridge.mu.Lock()
	defer globalBridge.mu.Unlock()
	globalBridge.service = svc
}

// Bridge implements the NotificationProducer interface for cross-SubServer use.
type Bridge struct{}

// NewBridge creates a notification bridge that other SubServers can use
// to produce notifications without importing the full notification SubServer.
func NewBridge() *Bridge {
	return &Bridge{}
}

func (b *Bridge) Produce(recipientPTID, actorPTID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) error {
	globalBridge.mu.RLock()
	svc := globalBridge.service
	globalBridge.mu.RUnlock()

	if svc == nil {
		return ErrBridgeUnregistered
	}

	_, err := svc.Produce(recipientPTID, actorPTID, notifType, category, targetType, targetID, title, body, groupKey, metadata)
	return err
}
