package conversation

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSubServerPrepareSnapshot(t *testing.T) {
	fixture := newGroupSnapshotCapabilityFixture(t)

	prepared, err := fixture.server.PrepareSnapshot(
		context.Background(),
		string(fixture.snapshot.ID),
		string(fixture.author.Actor),
	)
	if err != nil {
		t.Fatal(err)
	}

	wantMembers := []ports.GroupRecipientMember{
		{
			ActorPTID:         "ptid:author",
			HomeStationPeerID: "station-a",
		},
		{
			ActorPTID:         "ptid:beta",
			HomeStationPeerID: "station-b",
		},
		{
			ActorPTID:         "ptid:zeta",
			HomeStationPeerID: "station-z",
		},
	}
	if prepared.ConversationID != string(fixture.snapshot.ID) ||
		prepared.AuthorPTID != string(fixture.author.Actor) ||
		prepared.MembershipEpoch != uint64(fixture.snapshot.Head.MembershipEpoch) ||
		!reflect.DeepEqual(
			prepared.AuthorityHeadSHA256,
			fixture.snapshot.Head.EventHash.Bytes(),
		) ||
		!reflect.DeepEqual(prepared.Members, wantMembers) {
		t.Fatalf("PrepareSnapshot() = %+v", prepared)
	}
}

func TestSubServerWithSubmitFence(t *testing.T) {
	t.Run("rejects stale membership before callback", func(t *testing.T) {
		fixture := newGroupSnapshotCapabilityFixture(t)
		expected := fixture.prepare(t)
		expected.Members[1].HomeStationPeerID = "station-changed"

		callbackCalled := false
		err := fixture.server.WithSubmitFence(
			context.Background(),
			expected,
			func(ports.GroupRecipientSnapshot) error {
				callbackCalled = true
				return nil
			},
		)
		if !conversationdomain.IsCode(
			err,
			conversationdomain.ErrorCodeStaleAuthorityHead,
		) {
			t.Fatalf("WithSubmitFence() error = %v", err)
		}
		if callbackCalled {
			t.Fatal("stale membership invoked the commit callback")
		}
	})

	t.Run("rejects stale authority head before callback", func(t *testing.T) {
		fixture := newGroupSnapshotCapabilityFixture(t)
		expected := fixture.prepare(t)
		expected.AuthorityHeadSHA256[0] ^= 0xff

		callbackCalled := false
		err := fixture.server.WithSubmitFence(
			context.Background(),
			expected,
			func(ports.GroupRecipientSnapshot) error {
				callbackCalled = true
				return nil
			},
		)
		if !conversationdomain.IsCode(
			err,
			conversationdomain.ErrorCodeStaleAuthorityHead,
		) {
			t.Fatalf("WithSubmitFence() error = %v", err)
		}
		if callbackCalled {
			t.Fatal("stale authority head invoked the commit callback")
		}
	})

	t.Run("runs callback inside the conversation transaction", func(t *testing.T) {
		fixture := newGroupSnapshotCapabilityFixture(t)
		expected := fixture.prepare(t)
		callbackErr := errors.New("rollback fenced callback")

		err := fixture.server.WithSubmitFence(
			context.Background(),
			expected,
			func(verified ports.GroupRecipientSnapshot) error {
				if !reflect.DeepEqual(verified, expected) {
					return errors.New("verified snapshot changed under the fence")
				}
				if fixture.adapters.transaction == nil {
					return errors.New("conversation transaction is unavailable")
				}
				if insertErr := fixture.adapters.transaction.Exec(
					"INSERT INTO group_snapshot_fence_markers (marker) VALUES (?)",
					"inside-callback",
				).Error; insertErr != nil {
					return insertErr
				}

				return callbackErr
			},
		)
		if !errors.Is(err, callbackErr) {
			t.Fatalf("WithSubmitFence() error = %v", err)
		}

		var markerCount int64
		if err := fixture.database.
			Table("group_snapshot_fence_markers").
			Count(&markerCount).Error; err != nil {
			t.Fatal(err)
		}
		if markerCount != 0 {
			t.Fatalf(
				"fenced callback mutation survived rollback: count = %d",
				markerCount,
			)
		}
	})
}

type groupSnapshotCapabilityFixture struct {
	database *gorm.DB
	server   *subServer
	adapters *groupSnapshotCapabilityAdapterFactory
	snapshot aggregate.Snapshot
	author   valueobject.Endpoint
}

func newGroupSnapshotCapabilityFixture(
	t *testing.T,
) *groupSnapshotCapabilityFixture {
	t.Helper()
	ctx := context.Background()
	database, err := gorm.Open(
		sqlite.Open(
			"file:conversation-group-snapshot-"+uuid.NewString()+
				"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if closeErr := sqlDatabase.Close(); closeErr != nil {
			t.Errorf("close Conversation test database: %v", closeErr)
		}
	})
	if err := persistence.MigrateCanonicalSchema(ctx, database); err != nil {
		t.Fatal(err)
	}
	if err := database.Exec(`
CREATE TABLE group_snapshot_fence_markers (
  marker TEXT PRIMARY KEY
)`).Error; err != nil {
		t.Fatal(err)
	}

	adapters := &groupSnapshotCapabilityAdapterFactory{}
	unitOfWork, err := persistence.NewUnitOfWork(
		database,
		adapters,
		conversationhttp.ProtobufEventSealer{},
	)
	if err != nil {
		t.Fatal(err)
	}
	author := groupSnapshotCapabilityEndpoint(
		t,
		"ptid:author",
		"author-device",
	)
	beta := groupSnapshotCapabilityEndpoint(t, "ptid:beta", "beta-device")
	zeta := groupSnapshotCapabilityEndpoint(t, "ptid:zeta", "zeta-device")
	snapshot := groupSnapshotCapabilitySnapshot(t, author, beta, zeta)
	if err := unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		return transaction.Repositories.Authority.Create(ctx, snapshot)
	}); err != nil {
		t.Fatal(err)
	}

	return &groupSnapshotCapabilityFixture{
		database: database,
		server: &subServer{
			composition: &ProductionComposition{UnitOfWork: unitOfWork},
		},
		adapters: adapters,
		snapshot: snapshot,
		author:   author,
	}
}

func (f *groupSnapshotCapabilityFixture) prepare(
	t *testing.T,
) ports.GroupRecipientSnapshot {
	t.Helper()
	prepared, err := f.server.PrepareSnapshot(
		context.Background(),
		string(f.snapshot.ID),
		string(f.author.Actor),
	)
	if err != nil {
		t.Fatal(err)
	}

	return prepared
}

type groupSnapshotCapabilityAdapterFactory struct {
	transaction *gorm.DB
}

func (f *groupSnapshotCapabilityAdapterFactory) Bind(
	transaction *gorm.DB,
) (persistence.TransactionalAdapters, error) {
	f.transaction = transaction

	return persistence.TransactionalAdapters{}, nil
}

func groupSnapshotCapabilitySnapshot(
	t *testing.T,
	author valueobject.Endpoint,
	beta valueobject.Endpoint,
	zeta valueobject.Endpoint,
) aggregate.Snapshot {
	t.Helper()
	participants := []aggregate.Participant{
		{Actor: zeta.Actor, HomeStation: "station-z"},
		{Actor: author.Actor, HomeStation: "station-a"},
		{Actor: beta.Actor, HomeStation: "station-b"},
	}
	devices := []entity.MemberDevice{
		groupSnapshotCapabilityMemberDevice(t, zeta, "station-z"),
		groupSnapshotCapabilityMemberDevice(t, author, "station-a"),
		groupSnapshotCapabilityMemberDevice(t, beta, "station-b"),
	}
	deliveries := make([]valueobject.PreparedDelivery, 0, len(devices))
	for index, device := range devices {
		kind := valueobject.DeliveryKindMLSWelcome
		if device.Endpoint == author {
			kind = valueobject.DeliveryKindPublicEvent
		}
		delivery, err := valueobject.NewPreparedDelivery(
			device.Endpoint,
			device.HomeStation,
			kind,
			[]byte{byte(index + 1)},
		)
		if err != nil {
			t.Fatal(err)
		}
		deliveries = append(deliveries, delivery)
	}
	conversation, _, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "group-snapshot-capability",
		FederationID:     "federation-snapshot-capability",
		AuthorityStation: "station-a",
		AuthorityEpoch:   1,
		Owner:            author.Actor,
		Participants:     participants,
		Devices:          devices,
		Settings: valueobject.ConversationSettings{
			Name:       "Snapshot Capability",
			Visibility: "private",
		},
		CommandID:    "create-group-snapshot-capability",
		Creator:      author,
		Deliveries:   deliveries,
		EventPayload: []byte("group-snapshot-capability-created"),
		CreatedAt:    time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC),
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}

	return conversation.Snapshot()
}

func groupSnapshotCapabilityEndpoint(
	t *testing.T,
	actorPTID string,
	deviceID string,
) valueobject.Endpoint {
	t.Helper()
	endpoint, err := valueobject.NewEndpoint(actorPTID, deviceID)
	if err != nil {
		t.Fatal(err)
	}

	return endpoint
}

func groupSnapshotCapabilityMemberDevice(
	t *testing.T,
	endpoint valueobject.Endpoint,
	homeStation valueobject.StationID,
) entity.MemberDevice {
	t.Helper()
	device, err := entity.NewMemberDevice(endpoint, homeStation, 1)
	if err != nil {
		t.Fatal(err)
	}

	return device
}
