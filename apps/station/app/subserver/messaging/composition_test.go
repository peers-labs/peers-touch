package messaging

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/worker"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type compositionFederationTransport struct{}

func (compositionFederationTransport) Deliver(
	context.Context,
	*chat.MessagingFederationFrame,
) worker.FederationDeliveryResult {
	return worker.FederationDeliveryResult{Delivered: true}
}

func TestCompositionBuildsTargetMessagingGraphWithoutProductionRegistration(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:messaging-composition-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	composition, err := NewComposition(CompositionConfig{
		Database:       db,
		Clock:          time.Now,
		LocalStationID: "station:local",
		PeerKeys:       authfed.NewInMemoryPeerKeyStore(),
		QueueLimits: domain.QueueLimits{
			MaxUnackedItems: 100,
			MaxUnackedBytes: 1024 * 1024,
		},
		QueuePolicy: application.QueuePolicy{
			LeaseDuration:  time.Minute,
			MaxBatchSize:   50,
			MaxAttempts:    5,
			BaseRetryDelay: time.Second,
			MaxRetryDelay:  time.Minute,
		},
		FederationPolicy: application.FederationPolicy{
			MaxBatchWrites: 100,
		},
		RecoveryPolicy: application.RecoveryPolicy{
			MaxEncryptedArchiveBytes: 1024 * 1024,
		},
		AuthorityPlanPolicy: application.AuthorityPlanPolicy{
			ReservationTTL: time.Minute,
		},
		FederationDispatcherID: "dispatcher:local",
		FederationDispatcherPolicy: worker.FederationDispatcherPolicy{
			BatchSize:     50,
			LeaseDuration: time.Minute,
			MaxAttempts:   5,
			BaseBackoff:   time.Second,
			MaxBackoff:    time.Minute,
		},
		FederationTransport: compositionFederationTransport{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if composition.AuthorityService == nil ||
		composition.DeviceService == nil ||
		composition.QueueService == nil ||
		composition.FederationService == nil ||
		composition.RecoveryService == nil ||
		composition.AuthorityPlanService == nil ||
		composition.DeviceHandler == nil ||
		composition.QueueHandler == nil ||
		composition.FederationHandler == nil ||
		composition.FederationAuth == nil ||
		composition.FederationDispatcher == nil {
		t.Fatal("composition omitted a target Messaging Platform owner")
	}
	if err := composition.Migrate(); err != nil {
		t.Fatal(err)
	}
	for _, model := range []any{
		&infrastructure.AuthorityConversationModel{},
		&infrastructure.DeviceQueueLaneModel{},
		&infrastructure.DeviceQueueItemModel{},
		&infrastructure.FederationInboxModel{},
		&infrastructure.FederationOutboxModel{},
		&infrastructure.RecoveryRevisionModel{},
		&touchactor.ActorIdentityRecord{},
		&touchactor.DeviceRecord{},
	} {
		if !db.Migrator().HasTable(model) {
			t.Fatalf("composition did not migrate %T", model)
		}
	}
}

func TestCompositionRejectsIncompleteDependencies(t *testing.T) {
	if _, err := NewComposition(CompositionConfig{}); err == nil {
		t.Fatal("expected incomplete composition to fail closed")
	}
}
