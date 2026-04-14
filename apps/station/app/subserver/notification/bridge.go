package notification

import (
	"sync"

	"github.com/peers-labs/peers-touch/station/app/subserver/notification/application"
)

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

func (b *Bridge) Produce(recipientID, actorID string, notifType, category int32, targetType, targetID, title, body, groupKey string, metadata map[string]string) error {
	globalBridge.mu.RLock()
	svc := globalBridge.service
	globalBridge.mu.RUnlock()

	if svc == nil {
		return nil
	}

	_, err := svc.Produce(recipientID, actorID, notifType, category, targetType, targetID, title, body, groupKey, metadata)
	return err
}
