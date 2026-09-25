package conversation_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	domainservice "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	dddTestTime        = time.Date(2026, time.September, 6, 12, 0, 0, 0, time.UTC)
	dddManifestSetHash = valueobject.HashBytes([]byte("ddd-manifest-set"))
)

const (
	dddFederationID   valueobject.FederationID   = "federation-test"
	dddAuthorityEpoch valueobject.AuthorityEpoch = 1
)

type dddActorDeviceModel struct {
	PTID        string `gorm:"column:ptid;size:255;primaryKey"`
	DeviceID    string `gorm:"column:device_id;size:255;primaryKey"`
	HomeStation string `gorm:"column:home_station_peer_id;size:255;not null"`
	Active      bool   `gorm:"column:active;not null;index"`
}

func (*dddActorDeviceModel) TableName() string {
	return "actor_devices"
}

type dddDeviceInboxModel struct {
	IntentID        string `gorm:"column:item_id;size:128;primaryKey"`
	ConversationID  string `gorm:"column:conversation_id;size:128;not null"`
	EventID         string `gorm:"column:event_id;size:128;not null"`
	EventSequence   uint64 `gorm:"column:event_sequence;not null"`
	RecipientPTID   string `gorm:"column:recipient_ptid;size:255;not null;uniqueIndex:uidx_ddd_inbox_recipient_key,priority:1"`
	RecipientDevice string `gorm:"column:recipient_device_id;size:255;not null;uniqueIndex:uidx_ddd_inbox_recipient_key,priority:2"`
	IdempotencyKey  string `gorm:"column:idempotency_key;size:128;not null;uniqueIndex:uidx_ddd_inbox_recipient_key,priority:3"`
	PayloadKind     string `gorm:"column:payload_kind;size:32;not null"`
	OpaquePayload   []byte `gorm:"column:opaque_payload;type:blob;not null"`
	PayloadHash     []byte `gorm:"column:payload_sha256;type:blob;not null"`
	Commitment      []byte `gorm:"column:delivery_commitment;type:blob;not null"`
}

func (*dddDeviceInboxModel) TableName() string {
	return "device_queue_items"
}

type dddFederationOutboxModel struct {
	IntentID       string `gorm:"column:outbox_id;size:128;primaryKey"`
	ConversationID string `gorm:"column:conversation_id;size:128;not null"`
	EventID        string `gorm:"column:event_id;size:128;not null"`
	EventSequence  uint64 `gorm:"column:event_sequence;not null"`
	TargetStation  string `gorm:"column:target_station_peer_id;size:255;not null;uniqueIndex:uidx_ddd_outbox_target_key,priority:1"`
	IdempotencyKey string `gorm:"column:idempotency_key;size:128;not null;uniqueIndex:uidx_ddd_outbox_target_key,priority:2"`
	PayloadKind    string `gorm:"column:payload_kind;size:32;not null"`
	OpaquePayload  []byte `gorm:"column:opaque_payload;type:blob;not null"`
	PayloadHash    []byte `gorm:"column:payload_sha256;type:blob;not null"`
}

func (*dddFederationOutboxModel) TableName() string {
	return "federation_delivery_outbox"
}

type dddObjectGrantModel struct {
	ObjectID       string `gorm:"column:object_id;size:128;primaryKey"`
	RecipientPTID  string `gorm:"column:recipient_ptid;size:255;primaryKey"`
	ConversationID string `gorm:"column:conversation_id;size:128;not null"`
	EventID        string `gorm:"column:event_id;size:128;not null"`
}

func (*dddObjectGrantModel) TableName() string {
	return "conversation_attachment_grants"
}

type dddKeyPackageReservationModel struct {
	ReservationID string     `gorm:"column:reservation_id;size:128;primaryKey"`
	PlanID        string     `gorm:"column:plan_id;size:128;not null;index"`
	PTID          string     `gorm:"column:ptid;size:255;not null"`
	DeviceID      string     `gorm:"column:device_id;size:255;not null"`
	PackageID     string     `gorm:"column:package_id;size:128;not null"`
	PackageHash   []byte     `gorm:"column:package_hash;type:blob;not null"`
	State         string     `gorm:"column:state;size:32;not null"`
	ExpiresAt     time.Time  `gorm:"column:expires_at;not null"`
	TerminalAt    *time.Time `gorm:"column:terminal_at"`
}

func (*dddKeyPackageReservationModel) TableName() string {
	return "mls_key_package_reservations"
}

type dddLegacyConversationModel struct {
	ID             uint   `gorm:"column:id;primaryKey"`
	ConversationID string `gorm:"column:conversation_id;uniqueIndex"`
	CurrentSeq     int64  `gorm:"column:current_seq"`
}

func (*dddLegacyConversationModel) TableName() string {
	return "conversations"
}

type dddFollowerHeadWithoutPrimaryKey struct {
	ConversationID         string    `gorm:"column:conversation_id;size:128"`
	FederationID           string    `gorm:"column:federation_id;size:128;not null"`
	AuthorityStationPeerID string    `gorm:"column:authority_station_peer_id;size:255;not null"`
	AuthorityEpoch         uint64    `gorm:"column:authority_epoch;not null"`
	Sequence               uint64    `gorm:"column:group_seq;not null"`
	EventHash              []byte    `gorm:"column:event_hash;type:bytea;not null"`
	MembershipEpoch        uint64    `gorm:"column:membership_epoch;not null"`
	MLSEpoch               uint64    `gorm:"column:mls_epoch;not null"`
	SnapshotBytes          []byte    `gorm:"column:snapshot_bytes;type:bytea;not null"`
	UpdatedAt              time.Time `gorm:"column:updated_at;not null"`
}

func (*dddFollowerHeadWithoutPrimaryKey) TableName() string {
	return "conversation_follower_heads"
}

type dddAdapterFactory struct {
	failNextInbox    bool
	inactiveStations map[valueobject.StationID]bool
	signatureError   error
}

func (f *dddAdapterFactory) Bind(
	tx *gorm.DB,
) (persistence.TransactionalAdapters, error) {
	deliveryCommitments, err := deliveryinfra.NewAuthorityLedgerWriter(tx)
	if err != nil {
		return persistence.TransactionalAdapters{}, err
	}
	return persistence.TransactionalAdapters{
		Identity:               dddIdentityDirectory{db: tx, factory: f},
		Federation:             dddFederationDirectory{factory: f},
		DeviceInbox:            &dddDeviceInboxWriter{db: tx, factory: f},
		FederationOutbox:       dddFederationWriter{db: tx},
		DeliveryCommitments:    deliveryCommitments,
		ObjectGrants:           dddObjectGrantWriter{db: tx},
		KeyPackageReservations: dddReservationWriter{db: tx},
	}, nil
}

type dddFederationDirectory struct {
	factory *dddAdapterFactory
}

func (d dddFederationDirectory) IsActiveStation(
	_ context.Context,
	_ valueobject.FederationID,
	station valueobject.StationID,
) (bool, error) {
	return station != "" && !d.factory.inactiveStations[station], nil
}

type dddIdentityDirectory struct {
	db      *gorm.DB
	factory *dddAdapterFactory
}

func (d dddIdentityDirectory) IsActive(
	ctx context.Context,
	endpoint valueobject.Endpoint,
) (bool, error) {
	var count int64
	err := d.db.WithContext(ctx).
		Model(&dddActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ? AND active = ?",
			string(endpoint.Actor),
			string(endpoint.Device),
			true,
		).
		Count(&count).Error
	return count == 1, err
}

func (d dddIdentityDirectory) ActorIdentityPublicKey(
	ctx context.Context,
	actor valueobject.PTID,
) ([]byte, error) {
	var count int64
	if err := d.db.WithContext(ctx).
		Model(&dddActorDeviceModel{}).
		Where("ptid = ? AND active = ?", string(actor), true).
		Count(&count).Error; err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, fmt.Errorf("test identity: actor %s has no active device", actor)
	}
	return bytes.Repeat([]byte{0x2a}, 32), nil
}

func (d dddIdentityDirectory) VerifyDeviceSignature(
	ctx context.Context,
	endpoint valueobject.Endpoint,
	signingKeyID string,
	payload []byte,
	signature []byte,
) (ports.DeviceSignatureVerification, error) {
	if d.factory.signatureError != nil {
		return ports.DeviceSignatureVerification{}, d.factory.signatureError
	}
	if signingKeyID == "" ||
		len(payload) == 0 ||
		!bytes.Equal(signature, valueobject.HashBytes(payload).Bytes()) {
		return ports.DeviceSignatureVerification{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalSignature,
			"test_identity.verify_device_signature",
			"signature",
			"is invalid",
		)
	}
	var model dddActorDeviceModel
	err := d.db.WithContext(ctx).First(
		&model,
		"ptid = ? AND device_id = ?",
		string(endpoint.Actor),
		string(endpoint.Device),
	).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ports.DeviceSignatureVerification{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeActorKeyUnavailable,
			"test_identity.verify_device_signature",
			"actor_signing_key",
			"is unavailable",
		)
	}
	if err != nil {
		return ports.DeviceSignatureVerification{}, err
	}
	return ports.DeviceSignatureVerification{KeyRevoked: !model.Active}, nil
}

func (d dddIdentityDirectory) ListActiveEndpoints(
	ctx context.Context,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	values := make([]string, 0, len(actors))
	for _, actor := range actors {
		values = append(values, string(actor))
	}
	var models []dddActorDeviceModel
	if err := d.db.WithContext(ctx).
		Where("ptid IN ? AND active = ?", values, true).
		Order("ptid ASC, device_id ASC").
		Find(&models).Error; err != nil {
		return nil, err
	}
	routes := make([]ports.EndpointRoute, 0, len(models))
	for _, model := range models {
		routes = append(routes, ports.EndpointRoute{
			Endpoint: valueobject.Endpoint{
				Actor:  valueobject.PTID(model.PTID),
				Device: valueobject.DeviceID(model.DeviceID),
			},
			HomeStation: valueobject.StationID(model.HomeStation),
		})
	}
	return routes, nil
}

type dddDeviceInboxWriter struct {
	db      *gorm.DB
	factory *dddAdapterFactory
}

func (w *dddDeviceInboxWriter) Enqueue(
	ctx context.Context,
	intent ports.DeviceInboxIntent,
) error {
	if w.factory.failNextInbox {
		w.factory.failNextInbox = false
		return errors.New("test device inbox: injected failure")
	}
	model := dddDeviceInboxModel{
		IntentID:        intent.IntentID,
		ConversationID:  string(intent.ConversationID),
		EventID:         string(intent.EventID),
		EventSequence:   uint64(intent.EventSequence),
		RecipientPTID:   string(intent.Recipient.Actor),
		RecipientDevice: string(intent.Recipient.Device),
		IdempotencyKey:  intent.IdempotencyKey,
		PayloadKind:     string(intent.PayloadKind),
		OpaquePayload:   append([]byte(nil), intent.OpaquePayload...),
		PayloadHash:     intent.PayloadHash.Bytes(),
		Commitment:      intent.Commitment.Bytes(),
	}
	return w.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&model).Error
}

type dddFederationWriter struct {
	db *gorm.DB
}

func (w dddFederationWriter) Enqueue(
	ctx context.Context,
	intent ports.FederationOutboxIntent,
) error {
	return w.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&dddFederationOutboxModel{
			IntentID:       intent.IntentID,
			ConversationID: string(intent.ConversationID),
			EventID:        string(intent.EventID),
			EventSequence:  uint64(intent.EventSequence),
			TargetStation:  string(intent.TargetStation),
			IdempotencyKey: intent.IdempotencyKey,
			PayloadKind:    string(intent.PayloadKind),
			OpaquePayload:  append([]byte(nil), intent.OpaquePayload...),
			PayloadHash:    intent.PayloadHash.Bytes(),
		}).Error
}

type dddObjectGrantWriter struct {
	db *gorm.DB
}

func (w dddObjectGrantWriter) GrantBatch(
	ctx context.Context,
	grant ports.ObjectGrantBatch,
) error {
	for _, objectID := range grant.ObjectIDs {
		for _, recipient := range grant.Recipients {
			if err := w.db.WithContext(ctx).
				Clauses(clause.OnConflict{DoNothing: true}).
				Create(&dddObjectGrantModel{
					ObjectID:       string(objectID),
					RecipientPTID:  string(recipient),
					ConversationID: string(grant.ConversationID),
					EventID:        string(grant.EventID),
				}).Error; err != nil {
				return err
			}
		}
	}

	return nil
}

type dddReservationWriter struct {
	db *gorm.DB
}

func (w dddReservationWriter) Reserve(
	ctx context.Context,
	planID valueobject.PlanID,
	routes []ports.EndpointRoute,
	expiresAt time.Time,
) ([]valueobject.KeyPackageReservation, error) {
	sorted := append([]ports.EndpointRoute(nil), routes...)
	sort.Slice(sorted, func(left int, right int) bool {
		return sorted[left].Endpoint.Key() < sorted[right].Endpoint.Key()
	})
	reservations := make([]valueobject.KeyPackageReservation, 0, len(sorted))
	for _, route := range sorted {
		endpoint := route.Endpoint
		id := valueobject.HashBytes(valueobject.CanonicalTuple(
			[]byte("reservation"),
			[]byte(planID),
			[]byte(endpoint.Actor),
			[]byte(endpoint.Device),
		)).String()
		packageID := valueobject.HashBytes(valueobject.CanonicalTuple(
			[]byte("key-package"),
			[]byte(endpoint.Actor),
			[]byte(endpoint.Device),
		)).String()
		keyPackage := valueobject.CanonicalTuple(
			[]byte("key-package-material"),
			[]byte(packageID),
		)
		packageHash := valueobject.HashBytes(keyPackage)
		if err := w.db.WithContext(ctx).Create(&dddKeyPackageReservationModel{
			ReservationID: id,
			PlanID:        string(planID),
			PTID:          string(endpoint.Actor),
			DeviceID:      string(endpoint.Device),
			PackageID:     packageID,
			PackageHash:   packageHash.Bytes(),
			State:         "prepared",
			ExpiresAt:     expiresAt.UTC(),
		}).Error; err != nil {
			return nil, err
		}
		reservations = append(reservations, valueobject.KeyPackageReservation{
			ID:          id,
			Endpoint:    endpoint,
			PackageID:   packageID,
			KeyPackage:  keyPackage,
			PackageHash: packageHash,
			HomeStation: route.HomeStation,
		})
	}
	return reservations, nil
}

func (w dddReservationWriter) Consume(
	ctx context.Context,
	reservations []valueobject.KeyPackageReservation,
	at time.Time,
) error {
	return w.transition(ctx, reservations, "consumed", at)
}

func (w dddReservationWriter) Release(
	ctx context.Context,
	reservations []valueobject.KeyPackageReservation,
	at time.Time,
) error {
	return w.transition(ctx, reservations, "released", at)
}

func (w dddReservationWriter) transition(
	ctx context.Context,
	reservations []valueobject.KeyPackageReservation,
	state string,
	at time.Time,
) error {
	if len(reservations) == 0 {
		return nil
	}
	reservationIDs := make([]string, 0, len(reservations))
	for _, reservation := range reservations {
		reservationIDs = append(reservationIDs, reservation.ID)
	}
	result := w.db.WithContext(ctx).
		Model(&dddKeyPackageReservationModel{}).
		Where("reservation_id IN ? AND state = ?", reservationIDs, "prepared").
		Updates(map[string]any{"state": state, "terminal_at": at.UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != int64(len(reservations)) {
		return fmt.Errorf(
			"test reservation transition: changed %d of %d prepared reservations",
			result.RowsAffected,
			len(reservations),
		)
	}
	return nil
}

type dddClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *dddClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	current := c.now
	c.now = c.now.Add(time.Second)
	return current
}

type dddIDs struct {
	mu   sync.Mutex
	next int
}

func (g *dddIDs) NewPlanID() valueobject.PlanID {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.next++
	return valueobject.PlanID(fmt.Sprintf("plan-%d", g.next))
}

type dddNotifier struct {
	mu         sync.Mutex
	deliveries []ports.CommittedDelivery
	failNext   bool
}

func (n *dddNotifier) NotifyCommitted(
	_ context.Context,
	deliveries []ports.CommittedDelivery,
) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.deliveries = append(n.deliveries, deliveries...)
	if n.failNext {
		n.failNext = false
		return errors.New("test notifier: injected post-commit failure")
	}
	return nil
}

func (n *dddNotifier) count() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.deliveries)
}

type dddFixture struct {
	db       *gorm.DB
	adapters *dddAdapterFactory
	clock    *dddClock
	notifier *dddNotifier
	commands *command.Service
	queries  *query.Service
}

func newDDDComposition(t *testing.T) dddFixture {
	return newDDDCompositionAtStation(t, "station-a")
}

func newDDDCompositionAtStation(
	t *testing.T,
	localStation valueobject.StationID,
) dddFixture {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:conversation-ddd-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&dddActorDeviceModel{},
		&dddDeviceInboxModel{},
		&dddFederationOutboxModel{},
		&dddObjectGrantModel{},
		&dddKeyPackageReservationModel{},
		&deliveryinfra.AuthorityDeliveryCommitmentModel{},
		&deliveryinfra.AuthorityDeliveryReceiptModel{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&persistence.ConversationModel{},
		&persistence.ConversationMemberModel{},
		&persistence.ConversationMemberDeviceModel{},
		&persistence.ConversationEventModel{},
		&persistence.ConversationCommandReceiptModel{},
		&persistence.ConversationAuthorityPlanModel{},
		&persistence.ConversationMemberSettingsModel{},
		&persistence.ConversationReadCursorModel{},
		&persistence.ConversationLeaveIntentModel{},
		&persistence.ConversationFollowerHeadModel{},
		&persistence.ConversationFollowerStateModel{},
		&persistence.ConversationFollowerPendingEventModel{},
		&persistence.ConversationFollowerMemberModel{},
	); err != nil {
		t.Fatal(err)
	}
	adapters := &dddAdapterFactory{
		inactiveStations: make(map[valueobject.StationID]bool),
	}
	eventSealer := conversationhttp.ProtobufEventSealer{}
	unitOfWork, err := persistence.NewUnitOfWork(db, adapters, eventSealer)
	if err != nil {
		t.Fatal(err)
	}
	clock := &dddClock{now: dddTestTime}
	notifier := &dddNotifier{}
	commandService, err := command.NewService(
		unitOfWork,
		localStation,
		clock,
		&dddIDs{},
		conversationhttp.ProtobufConversationStateEncoder{},
		conversationhttp.ProtobufDeviceEventEncoder{},
		conversationhttp.ProtobufReadCursorEncoder{},
		conversationhttp.ProtobufLeaveIntentSigningEncoder{},
		conversationhttp.ProtobufCommandProposalSigningEncoder{},
		notifier,
		eventSealer,
	)
	if err != nil {
		t.Fatal(err)
	}
	queryService, err := query.NewService(unitOfWork)
	if err != nil {
		t.Fatal(err)
	}
	return dddFixture{
		db:       db,
		adapters: adapters,
		clock:    clock,
		notifier: notifier,
		commands: commandService,
		queries:  queryService,
	}
}

func TestConversationDDDUOWRejectsLegacySchemaBeforeCutover(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:conversation-ddd-legacy-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&dddLegacyConversationModel{}); err != nil {
		t.Fatal(err)
	}
	if _, err := persistence.NewUnitOfWork(
		db,
		&dddAdapterFactory{},
		conversationhttp.ProtobufEventSealer{},
	); err == nil {
		t.Fatal("NewUnitOfWork() accepted the incompatible legacy schema")
	}
}

func TestConversationDDDUOWRequiresCanonicalEventSealer(t *testing.T) {
	fixture := newDDDComposition(t)
	if _, err := persistence.NewUnitOfWork(
		fixture.db,
		&dddAdapterFactory{},
		nil,
	); err == nil || !strings.Contains(err.Error(), "canonical event sealer") {
		t.Fatalf("NewUnitOfWork() missing-sealer error = %v", err)
	}
}

func TestConversationDDDUOWRejectsMissingIdempotencyIndex(t *testing.T) {
	fixture := newDDDComposition(t)
	if err := fixture.db.Migrator().DropIndex(
		&persistence.ConversationEventModel{},
		"uidx_conversation_event_command",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := persistence.NewUnitOfWork(
		fixture.db,
		&dddAdapterFactory{},
		conversationhttp.ProtobufEventSealer{},
	); err == nil || !strings.Contains(err.Error(), "uidx_conversation_event_command") {
		t.Fatalf("NewUnitOfWork() missing-index error = %v", err)
	}
}

func TestConversationDDDUOWRejectsMalformedIdempotencyIndex(t *testing.T) {
	fixture := newDDDComposition(t)
	if err := fixture.db.Migrator().DropIndex(
		&persistence.ConversationEventModel{},
		"uidx_conversation_event_command",
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Exec(
		"CREATE INDEX uidx_conversation_event_command ON conversation_events(command_id)",
	).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := persistence.NewUnitOfWork(
		fixture.db,
		&dddAdapterFactory{},
		conversationhttp.ProtobufEventSealer{},
	); err == nil || !strings.Contains(err.Error(), "uidx_conversation_event_command") {
		t.Fatalf("NewUnitOfWork() malformed-index error = %v", err)
	}
}

func TestConversationDDDUOWRejectsMissingFollowerHeadPrimaryKey(t *testing.T) {
	fixture := newDDDComposition(t)
	if err := fixture.db.Migrator().DropTable(
		&persistence.ConversationFollowerHeadModel{},
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.AutoMigrate(&dddFollowerHeadWithoutPrimaryKey{}); err != nil {
		t.Fatal(err)
	}
	if _, err := persistence.NewUnitOfWork(
		fixture.db,
		&dddAdapterFactory{},
		conversationhttp.ProtobufEventSealer{},
	); err == nil || !strings.Contains(err.Error(), "primary key") {
		t.Fatalf("NewUnitOfWork() missing-follower-head-primary-key error = %v", err)
	}
}

func TestConversationDDDPersistsCanonicalTimestampPrecision(t *testing.T) {
	fixture := newDDDComposition(t)
	fixture.clock.now = dddTestTime.Add(123456789 * time.Nanosecond)
	alice := dddEndpoint("ptid:timestamp-alice", "alice-1")
	bob := dddEndpoint("ptid:timestamp-bob", "bob-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-a"),
	)

	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "timestamp-create",
			VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-a"),
			ExactCommandBytes: []byte("timestamp-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	var persisted persistence.ConversationEventModel
	if err := fixture.db.First(
		&persisted,
		"event_id = ?",
		string(created.Event.ID),
	).Error; err != nil {
		t.Fatal(err)
	}
	if created.Event.CommittedAt.Nanosecond()%int(time.Microsecond) != 0 ||
		!persisted.CommittedAt.Equal(created.Event.CommittedAt) {
		t.Fatalf(
			"event/persisted committed times = %s / %s",
			created.Event.CommittedAt,
			persisted.CommittedAt,
		)
	}
	events, err := fixture.queries.Events(
		context.Background(),
		created.Conversation.ID,
		alice.Actor,
		0,
		10,
	)
	if err != nil {
		t.Fatalf("list persisted event: %v", err)
	}
	if len(events) != 1 || events[0].Hash != created.Event.Hash {
		t.Fatalf("persisted events = %+v, want canonical genesis", events)
	}
}

func TestConversationDDDReadCursorUsesVerifiedRemoteRoutes(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:read-alice", "alice-1")
	bob := dddEndpoint("ptid:read-bob", "bob-1")
	seedDDDDevices(t, fixture.db, dddDevice(alice, "station-a"))
	routes := dddDirectRoutes(alice, "station-a", bob, "station-b")

	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "read-cursor-create",
			VerifiedRoutes:    routes,
			ExactCommandBytes: []byte("read-cursor-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.commands.AdvanceReadCursorFromVerifiedHome(
		context.Background(),
		created.Conversation.ID,
		bob,
		"station-c",
		created.Event.Sequence,
		routes,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("wrong reader Home Station error = %v", err)
	}

	notificationsBefore := fixture.notifier.count()
	result, err := fixture.commands.AdvanceReadCursorFromVerifiedHome(
		context.Background(),
		created.Conversation.ID,
		bob,
		"station-b",
		created.Event.Sequence,
		routes,
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Cursor.Actor != bob.Actor ||
		result.Cursor.Sequence != created.Event.Sequence {
		t.Fatalf("federated read cursor = %+v", result.Cursor)
	}
	if fixture.notifier.count() != notificationsBefore+1 {
		t.Fatal("federated read cursor did not notify the local participant")
	}
	var bobIdentityRows int64
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ?", string(bob.Actor)).
		Count(&bobIdentityRows).Error; err != nil {
		t.Fatal(err)
	}
	if bobIdentityRows != 0 {
		t.Fatalf("federated read cursor created %d remote Actor rows", bobIdentityRows)
	}
}

func TestConversationDDDTestCompositionDirectReplayRollbackAndQueries(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:alice", "alice-1")
	bob := dddEndpoint("ptid:bob", "bob-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-b"),
	)

	created, err := fixture.commands.CreateDirect(context.Background(), command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "create-direct",
		VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-b"),
		ExactCommandBytes: []byte("create-direct"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Event.Sequence != 1 || created.Conversation.Head.Sequence != 1 {
		t.Fatalf("created result = %+v", created)
	}
	assertCount(t, fixture.db, &persistence.ConversationModel{}, 1)
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 1)
	assertCount(t, fixture.db, &dddDeviceInboxModel{}, 1)
	assertCount(t, fixture.db, &dddFederationOutboxModel{}, 1)
	assertCount(t, fixture.db, &deliveryinfra.AuthorityDeliveryCommitmentModel{}, 2)
	var persistedGenesis persistence.ConversationEventModel
	if err := fixture.db.First(
		&persistedGenesis,
		"event_id = ?",
		string(created.Event.ID),
	).Error; err != nil {
		t.Fatal(err)
	}
	var wireGenesis chat.ConversationEvent
	if err := proto.Unmarshal(persistedGenesis.EventBytes, &wireGenesis); err != nil {
		t.Fatalf("decode persisted canonical event bytes: %v", err)
	}
	if !bytes.Equal(wireGenesis.EventHash, created.Event.Hash.Bytes()) ||
		len(persistedGenesis.DomainSnapshot) == 0 {
		t.Fatalf("persisted genesis event = %+v", persistedGenesis)
	}
	postState := wireGenesis.GetConversationCreated().GetPostState()
	if postState == nil ||
		len(postState.GetActiveMembers()) != 2 ||
		len(postState.GetActiveEndpointRoutes()) != 2 {
		t.Fatalf("genesis event omitted the authority-bound post-state: %+v", &wireGenesis)
	}
	for _, route := range postState.GetActiveEndpointRoutes() {
		if route.GetEndpoint() == nil || route.GetHomeStationPeerId() == "" {
			t.Fatalf("genesis endpoint route is incomplete: %+v", route)
		}
	}
	var genesisReceipt persistence.ConversationCommandReceiptModel
	if err := fixture.db.First(
		&genesisReceipt,
		"conversation_id = ? AND command_id = ?",
		string(created.Conversation.ID),
		"create-direct",
	).Error; err != nil {
		t.Fatal(err)
	}
	if genesisReceipt.Outcome != string(repository.CommandReceiptOutcomeAccepted) ||
		genesisReceipt.RejectionCode != "" ||
		!bytes.Equal(genesisReceipt.EventBytes, persistedGenesis.EventBytes) {
		t.Fatal("command receipt did not retain the exact committed event bytes")
	}
	var inbox dddDeviceInboxModel
	if err := fixture.db.First(&inbox).Error; err != nil {
		t.Fatal(err)
	}
	var delivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(inbox.OpaquePayload, &delivery); err != nil {
		t.Fatalf("decode canonical device delivery: %v", err)
	}
	if delivery.GetEvent().GetEventId() != string(created.Event.ID) ||
		delivery.GetRecipient().GetPtid() != string(alice.Actor) ||
		inbox.PayloadKind != string(ports.DeviceInboxPayloadConversationEvent) ||
		delivery.GetPayloadKind() !=
			chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_CONVERSATION_STATE ||
		len(delivery.GetSenderActorIdentityPublicKey()) != 32 {
		t.Fatalf("device delivery = %+v", &delivery)
	}
	hashInput := proto.Clone(delivery.GetEvent()).(*chat.ConversationEvent)
	hashInput.EventHash = nil
	hashBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(hashInput)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(valueobject.HashBytes(hashBytes).Bytes(), delivery.GetEvent().GetEventHash()) ||
		!bytes.Equal(
			valueobject.HashBytes(delivery.GetEndpointPayload()).Bytes(),
			delivery.GetEndpointPayloadSha256(),
		) {
		t.Fatal("device delivery does not satisfy the frozen client hash contract")
	}
	commitments, err := domainservice.BuildDeliveryCommitments(
		created.Conversation.ID,
		created.Event.ID,
		[]valueobject.PreparedDelivery{{
			Recipient:   alice,
			HomeStation: "station-a",
			Kind:        valueobject.DeliveryKindConversation,
			Opaque:      delivery.GetEndpointPayload(),
			PayloadHash: valueobject.HashBytes(delivery.GetEndpointPayload()),
		}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(commitments) != 1 ||
		!bytes.Equal(commitments[0].Hash.Bytes(), delivery.GetDeliveryCommitment()) {
		t.Fatal("device delivery commitment does not match the frozen client contract")
	}
	var stateMarker chat.ConversationStateMarker
	if err := proto.Unmarshal(delivery.GetEndpointPayload(), &stateMarker); err != nil {
		t.Fatalf("decode conversation state marker: %v", err)
	}
	if stateMarker.GetConversationId() != string(created.Conversation.ID) ||
		stateMarker.GetEventId() != string(created.Event.ID) {
		t.Fatalf("conversation state marker = %+v", &stateMarker)
	}

	views, err := fixture.queries.List(context.Background(), alice.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].Source != query.SourceAuthority {
		t.Fatalf("views = %+v", views)
	}

	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, created.Conversation.ID, alice),
	)
	if err != nil {
		t.Fatal(err)
	}
	deliveries := []valueobject.PreparedDelivery{
		dddDelivery(t, alice, "station-a", valueobject.DeliveryKindPublicEvent, "sender-marker"),
		dddDelivery(t, bob, "station-b", valueobject.DeliveryKindDirectCiphertext, "bob-ciphertext"),
	}
	sendAt := fixture.clock.Now()
	sendBytes := dddSendCommandBytes(
		t,
		created.Conversation.ID,
		"send-1",
		alice,
		preparation,
		sendAt,
	)
	request := command.SubmitRequest{
		Command: aggregate.Command{
			ID:                      "send-1",
			ConversationID:          created.Conversation.ID,
			AuthorityStation:        "station-a",
			Sender:                  alice,
			ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
			ObservedMLSEpoch:        preparation.Head.MLSEpoch,
			DeliveryPlanHash:        preparation.DeliveryPlanHash,
			Kind:                    domainevent.KindMessageCommitted,
			MessageID:               "message-send-1",
			Payload:                 sendBytes,
			Deliveries:              deliveries,
			CommittedAt:             sendAt,
		},
		VerifiedRoutes:    dddActiveRoutes(t, fixture.db, alice.Actor, bob.Actor),
		ExactCommandBytes: sendBytes,
	}
	divergent := request
	divergent.Command.ID = "divergent-command"
	divergent.Command.Payload = []byte("different-event-payload")
	if _, err := fixture.commands.Submit(
		context.Background(),
		divergent,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeInvalidArgument) {
		t.Fatalf("divergent exact command bytes error = %v", err)
	}
	committed, err := fixture.commands.Submit(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if committed.Event.Sequence != 2 || committed.Event.PreviousHash != created.Event.Hash {
		t.Fatalf("committed event = %+v", committed.Event)
	}
	var committedDeliveries []deliveryinfra.AuthorityDeliveryCommitmentModel
	if err := fixture.db.
		Where("event_id = ?", string(committed.Event.ID)).
		Order("recipient_ptid ASC, recipient_device_id ASC").
		Find(&committedDeliveries).Error; err != nil {
		t.Fatal(err)
	}
	if len(committedDeliveries) != 2 ||
		committedDeliveries[0].RecipientPTID != string(alice.Actor) ||
		committedDeliveries[0].RequiredRecipient ||
		committedDeliveries[1].RecipientPTID != string(bob.Actor) ||
		!committedDeliveries[1].RequiredRecipient ||
		committedDeliveries[1].HomeStation != "station-b" {
		t.Fatalf("authority delivery commitments = %+v", committedDeliveries)
	}
	replayed, err := fixture.commands.Submit(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.Replay || replayed.Event.ID != committed.Event.ID {
		t.Fatalf("replay = %+v", replayed)
	}
	conflictingReplay := request
	conflictingReplay.Command.Payload = []byte("same-command-id-different-bytes")
	conflictingReplay.ExactCommandBytes = conflictingReplay.Command.Payload
	if _, err := fixture.commands.Submit(
		context.Background(),
		conflictingReplay,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("same command ID with different bytes error = %v", err)
	}
	forwarded, err := fixture.commands.SubmitForwarded(
		context.Background(),
		dddForwardedCommandRequest(
			t,
			request,
			dddFederationID,
			dddAuthorityEpoch,
			"station-a",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !forwarded.Replay || forwarded.Event.ID != committed.Event.ID {
		t.Fatalf("forwarded authority result = %+v", forwarded)
	}
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 2)
	assertCount(t, fixture.db, &persistence.ConversationCommandReceiptModel{}, 2)
	assertCount(t, fixture.db, &deliveryinfra.AuthorityDeliveryCommitmentModel{}, 4)

	rollbackPreparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, created.Conversation.ID, alice),
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.adapters.failNextInbox = true
	rollbackRequest := request
	rollbackRequest.Command.ID = "send-rollback"
	rollbackRequest.Command.MessageID = "message-send-rollback"
	rollbackRequest.Command.ObservedMembershipEpoch = rollbackPreparation.Head.MembershipEpoch
	rollbackRequest.Command.ObservedMLSEpoch = rollbackPreparation.Head.MLSEpoch
	rollbackRequest.Command.DeliveryPlanHash = rollbackPreparation.DeliveryPlanHash
	rollbackRequest.Command.Deliveries = []valueobject.PreparedDelivery{
		dddDelivery(t, alice, "station-a", valueobject.DeliveryKindPublicEvent, "rollback-marker"),
		dddDelivery(t, bob, "station-b", valueobject.DeliveryKindDirectCiphertext, "rollback-ciphertext"),
	}
	rollbackAt := fixture.clock.Now()
	rollbackBytes := dddSendCommandBytes(
		t,
		created.Conversation.ID,
		"send-rollback",
		alice,
		rollbackPreparation,
		rollbackAt,
	)
	rollbackRequest.Command.Payload = rollbackBytes
	rollbackRequest.Command.CommittedAt = rollbackAt
	rollbackRequest.ExactCommandBytes = rollbackBytes
	if _, err := fixture.commands.Submit(context.Background(), rollbackRequest); err == nil {
		t.Fatal("Submit() with injected inbox failure succeeded")
	}
	head, err := fixture.queries.PublicHead(context.Background(), created.Conversation.ID, alice.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if head.Head.Sequence != 2 || head.Head.EventHash != committed.Event.Hash {
		t.Fatalf("rollback changed authority head: %+v", head)
	}
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 2)
	assertCount(t, fixture.db, &persistence.ConversationCommandReceiptModel{}, 2)
	assertCount(t, fixture.db, &deliveryinfra.AuthorityDeliveryCommitmentModel{}, 4)
}

func TestConversationDDDCreateDirectUsesVerifiedRemoteRoutes(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:manifest-alice", "alice-1")
	bob := dddEndpoint("ptid:manifest-bob", "bob-1")
	seedDDDDevices(t, fixture.db, dddDevice(alice, "station-a"))

	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "manifest-only-remote-create",
			VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-b"),
			ExactCommandBytes: []byte("manifest-only-remote-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if created.Conversation.ID == "" || created.Event.Sequence != 1 {
		t.Fatalf("created result = %+v", created)
	}
	var remoteDeviceCount int64
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ?", string(bob.Actor)).
		Count(&remoteDeviceCount).Error; err != nil {
		t.Fatal(err)
	}
	if remoteDeviceCount != 0 {
		t.Fatalf("remote Actor device rows = %d, want 0", remoteDeviceCount)
	}
	assertCount(t, fixture.db, &dddDeviceInboxModel{}, 1)
	assertCount(t, fixture.db, &dddFederationOutboxModel{}, 1)
	var remoteDelivery dddFederationOutboxModel
	if err := fixture.db.First(&remoteDelivery).Error; err != nil {
		t.Fatal(err)
	}
	if remoteDelivery.TargetStation != "station-b" {
		t.Fatalf(
			"remote delivery target = %q, want station-b",
			remoteDelivery.TargetStation,
		)
	}
	replayed, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "manifest-only-remote-create",
			ExactCommandBytes: []byte("manifest-only-remote-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.Replay || replayed.Event.ID != created.Event.ID {
		t.Fatalf("manifest-independent replay = %+v", replayed)
	}
	conflictingReplay := command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "manifest-only-remote-create",
		ExactCommandBytes: []byte("different-create-command"),
	}
	if _, err := fixture.commands.CreateDirect(
		context.Background(),
		conflictingReplay,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("conflicting creation replay error = %v", err)
	}
	reopened, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "direct-reopen-command",
			ExactCommandBytes: []byte("direct-reopen-command"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reopened.Replay ||
		reopened.Event.ID != "" ||
		reopened.Conversation.ID != created.Conversation.ID {
		t.Fatalf("authority Direct reopen = %+v", reopened)
	}
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ?",
			string(alice.Actor),
			string(alice.Device),
		).
		Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	ensured, err := fixture.commands.EnsureDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "relationship-effect-after-device-churn",
			ExactCommandBytes: []byte("relationship-effect-after-device-churn"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !ensured.Replay || ensured.Conversation.ID != created.Conversation.ID {
		t.Fatalf("relationship Direct ensure = %+v", ensured)
	}
	if _, err := fixture.commands.EnsureDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      "different-federation",
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "relationship-effect-wrong-federation",
			ExactCommandBytes: []byte("relationship-effect-wrong-federation"),
		},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("incompatible relationship Direct ensure error = %v", err)
	}
	assertCount(t, fixture.db, &persistence.ConversationModel{}, 1)
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 1)
	assertCount(t, fixture.db, &persistence.ConversationCommandReceiptModel{}, 1)
}

func TestConversationDDDCreateDirectFailsClosedBeforeMutation(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		setup    func(dddFixture, valueobject.Endpoint)
		routes   func(valueobject.Endpoint, valueobject.Endpoint) []ports.EndpointRoute
		wantCode conversationdomain.ErrorCode
	}{
		{
			name: "inactive local creator",
			setup: func(fixture dddFixture, alice valueobject.Endpoint) {
				if err := fixture.db.Model(&dddActorDeviceModel{}).
					Where(
						"ptid = ? AND device_id = ?",
						string(alice.Actor),
						string(alice.Device),
					).
					Update("active", false).Error; err != nil {
					t.Fatal(err)
				}
			},
			routes: func(
				alice valueobject.Endpoint,
				bob valueobject.Endpoint,
			) []ports.EndpointRoute {
				return dddDirectRoutes(alice, "station-a", bob, "station-b")
			},
			wantCode: conversationdomain.ErrorCodeUnauthorized,
		},
		{
			name: "inactive remote Home Station",
			setup: func(fixture dddFixture, _ valueobject.Endpoint) {
				fixture.adapters.inactiveStations["station-b"] = true
			},
			routes: func(
				alice valueobject.Endpoint,
				bob valueobject.Endpoint,
			) []ports.EndpointRoute {
				return dddDirectRoutes(alice, "station-a", bob, "station-b")
			},
			wantCode: conversationdomain.ErrorCodeFederationInactive,
		},
		{
			name:  "missing remote route",
			setup: func(dddFixture, valueobject.Endpoint) {},
			routes: func(
				alice valueobject.Endpoint,
				_ valueobject.Endpoint,
			) []ports.EndpointRoute {
				return []ports.EndpointRoute{{
					Endpoint:    alice,
					HomeStation: "station-a",
				}}
			},
			wantCode: conversationdomain.ErrorCodeInvalidArgument,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newDDDComposition(t)
			alice := dddEndpoint("ptid:closed-alice", "alice-1")
			bob := dddEndpoint("ptid:closed-bob", "bob-1")
			seedDDDDevices(t, fixture.db, dddDevice(alice, "station-a"))
			testCase.setup(fixture, alice)

			_, err := fixture.commands.CreateDirect(
				context.Background(),
				command.CreateDirectRequest{
					Creator:           alice,
					Peer:              bob.Actor,
					FederationID:      dddFederationID,
					AuthorityEpoch:    dddAuthorityEpoch,
					CommandID:         "closed-create",
					VerifiedRoutes:    testCase.routes(alice, bob),
					ExactCommandBytes: []byte("closed-create"),
				},
			)
			if !conversationdomain.IsCode(err, testCase.wantCode) {
				t.Fatalf("CreateDirect() error = %v, want %s", err, testCase.wantCode)
			}
			assertCount(t, fixture.db, &persistence.ConversationModel{}, 0)
			assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 0)
			assertCount(t, fixture.db, &persistence.ConversationCommandReceiptModel{}, 0)
			assertCount(t, fixture.db, &dddDeviceInboxModel{}, 0)
			assertCount(t, fixture.db, &dddFederationOutboxModel{}, 0)
		})
	}
}

func TestConversationDDDCreateDirectReopensFollowerProjection(t *testing.T) {
	authority := newDDDCompositionAtStation(t, "station-a")
	alice := dddEndpoint("ptid:follower-direct-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-direct-bob", "bob-1")
	seedDDDDevices(t, authority.db, dddDevice(alice, "station-a"))
	created, err := authority.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "authority-direct-create",
			VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-b"),
			ExactCommandBytes: []byte("authority-direct-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	follower := newDDDCompositionAtStation(t, "station-b")
	seedDDDDevices(t, follower.db, dddDevice(bob, "station-b"))
	if err := follower.commands.ApplyFollowerEvent(
		context.Background(),
		created.Event,
	); err != nil {
		t.Fatal(err)
	}
	reopened, err := follower.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           bob,
			Peer:              alice.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "follower-direct-reopen",
			ExactCommandBytes: []byte("follower-direct-reopen"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reopened.Replay ||
		reopened.Event.ID != "" ||
		reopened.Conversation.ID != created.Conversation.ID ||
		reopened.Conversation.AuthorityStation != "station-a" {
		t.Fatalf("follower Direct reopen = %+v", reopened)
	}
	assertCount(t, follower.db, &persistence.ConversationModel{}, 0)
	assertCount(t, follower.db, &persistence.ConversationFollowerHeadModel{}, 1)

	remoteInput := created.Event.Input()
	remoteInput.AuthorityStation = "station-b"
	remoteEvent, err := (conversationhttp.ProtobufEventSealer{}).Seal(remoteInput)
	if err != nil {
		t.Fatal(err)
	}
	if err := authority.commands.ApplyFollowerEvent(
		context.Background(),
		remoteEvent,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("follower over local authority error = %v", err)
	}
	assertCount(t, authority.db, &persistence.ConversationModel{}, 1)
	assertCount(t, authority.db, &persistence.ConversationFollowerHeadModel{}, 0)
}

func TestConversationDDDDirectFanoutUsesCurrentActiveActorDevices(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:direct-devices-alice", "alice-1")
	aliceSecond := dddEndpoint(string(alice.Actor), "alice-2")
	bob := dddEndpoint("ptid:direct-devices-bob", "bob-1")
	bobSecond := dddEndpoint(string(bob.Actor), "bob-2")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-b"),
	)
	created, err := fixture.commands.CreateDirect(context.Background(), command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "direct-devices-create",
		VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-b"),
		ExactCommandBytes: []byte("direct-devices-create"),
	})
	if err != nil {
		t.Fatal(err)
	}
	seedDDDDevices(t, fixture.db,
		dddDevice(aliceSecond, "station-a"),
		dddDevice(bobSecond, "station-b"),
	)
	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, created.Conversation.ID, aliceSecond),
	)
	if err != nil {
		t.Fatal(err)
	}
	wantEndpoints := valueobject.SortEndpoints([]valueobject.Endpoint{
		alice,
		aliceSecond,
		bob,
		bobSecond,
	})
	if !valueobject.EqualEndpointSets(preparation.RequiredEndpoints, wantEndpoints) {
		t.Fatalf(
			"direct required endpoints = %+v, want %+v",
			preparation.RequiredEndpoints,
			wantEndpoints,
		)
	}
	at := fixture.clock.Now()
	commandBytes := dddSendCommandBytes(
		t,
		created.Conversation.ID,
		"direct-devices-send",
		aliceSecond,
		preparation,
		at,
	)
	deliveries := make([]valueobject.PreparedDelivery, 0, len(wantEndpoints))
	for _, endpoint := range wantEndpoints {
		kind := valueobject.DeliveryKindDirectCiphertext
		if endpoint == aliceSecond {
			kind = valueobject.DeliveryKindPublicEvent
		}
		station := valueobject.StationID("station-a")
		if endpoint.Actor == bob.Actor {
			station = "station-b"
		}
		deliveries = append(
			deliveries,
			dddDelivery(t, endpoint, station, kind, "direct-device-"+endpoint.Key()),
		)
	}
	result, err := fixture.commands.Submit(context.Background(), command.SubmitRequest{
		Command: aggregate.Command{
			ID:                      "direct-devices-send",
			ConversationID:          created.Conversation.ID,
			AuthorityStation:        "station-a",
			Sender:                  aliceSecond,
			ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
			ObservedMLSEpoch:        preparation.Head.MLSEpoch,
			DeliveryPlanHash:        preparation.DeliveryPlanHash,
			Kind:                    domainevent.KindMessageCommitted,
			MessageID:               "message-direct-devices-send",
			Payload:                 commandBytes,
			Deliveries:              deliveries,
			CommittedAt:             at,
		},
		VerifiedRoutes:    dddActiveRoutes(t, fixture.db, alice.Actor, bob.Actor),
		ExactCommandBytes: commandBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	var localItems int64
	if err := fixture.db.Model(&dddDeviceInboxModel{}).
		Where("event_id = ?", string(result.Event.ID)).
		Count(&localItems).Error; err != nil {
		t.Fatal(err)
	}
	var remoteItems int64
	if err := fixture.db.Model(&dddFederationOutboxModel{}).
		Where("event_id = ?", string(result.Event.ID)).
		Count(&remoteItems).Error; err != nil {
		t.Fatal(err)
	}
	if localItems != 2 || remoteItems != 2 {
		t.Fatalf("direct fan-out local=%d remote=%d, want 2/2", localItems, remoteItems)
	}
}

func TestConversationDDDDirectRecoversMissingDeviceProjectionFromVerifiedGenesis(
	t *testing.T,
) {
	fixture := newDDDComposition(t)
	aliceOriginal := dddEndpoint("ptid:direct-recovery-alice", "alice-original")
	bobOriginal := dddEndpoint("ptid:direct-recovery-bob", "bob-original")
	seedDDDDevices(
		t,
		fixture.db,
		dddDevice(aliceOriginal, "station-a"),
		dddDevice(bobOriginal, "station-a"),
	)
	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           aliceOriginal,
			Peer:              bobOriginal.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "direct-recovery-create",
			VerifiedRoutes:    dddDirectRoutes(aliceOriginal, "station-a", bobOriginal, "station-a"),
			ExactCommandBytes: []byte("direct-recovery-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where(
			"(ptid = ? AND device_id = ?) OR (ptid = ? AND device_id = ?)",
			string(aliceOriginal.Actor),
			string(aliceOriginal.Device),
			string(bobOriginal.Actor),
			string(bobOriginal.Device),
		).
		Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	aliceCurrent := dddEndpoint(string(aliceOriginal.Actor), "alice-current")
	bobCurrent := dddEndpoint(string(bobOriginal.Actor), "bob-current")
	seedDDDDevices(
		t,
		fixture.db,
		dddDevice(aliceCurrent, "station-a"),
		dddDevice(bobCurrent, "station-a"),
	)
	if err := fixture.db.
		Where("conversation_id = ?", string(created.Conversation.ID)).
		Delete(&persistence.ConversationMemberDeviceModel{}).Error; err != nil {
		t.Fatal(err)
	}

	views, err := fixture.queries.List(context.Background(), aliceOriginal.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 ||
		!snapshotHasEndpoint(views[0].Conversation, aliceOriginal) ||
		!snapshotHasEndpoint(views[0].Conversation, bobOriginal) {
		t.Fatalf("recovered Direct projection = %+v", views)
	}

	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(
			t,
			fixture,
			created.Conversation.ID,
			aliceCurrent,
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	wantEndpoints := valueobject.SortEndpoints([]valueobject.Endpoint{
		aliceCurrent,
		bobCurrent,
	})
	if !valueobject.EqualEndpointSets(preparation.RequiredEndpoints, wantEndpoints) {
		t.Fatalf(
			"recovered Direct required endpoints = %+v, want %+v",
			preparation.RequiredEndpoints,
			wantEndpoints,
		)
	}
	at := fixture.clock.Now()
	commandBytes := dddSendCommandBytes(
		t,
		created.Conversation.ID,
		"direct-recovery-send",
		aliceCurrent,
		preparation,
		at,
	)
	result, err := fixture.commands.Submit(
		context.Background(),
		command.SubmitRequest{
			Command: aggregate.Command{
				ID:                      "direct-recovery-send",
				ConversationID:          created.Conversation.ID,
				AuthorityStation:        "station-a",
				Sender:                  aliceCurrent,
				ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
				ObservedMLSEpoch:        preparation.Head.MLSEpoch,
				DeliveryPlanHash:        preparation.DeliveryPlanHash,
				Kind:                    domainevent.KindMessageCommitted,
				MessageID:               "message-direct-recovery-send",
				Payload:                 commandBytes,
				Deliveries: []valueobject.PreparedDelivery{
					dddDelivery(
						t,
						aliceCurrent,
						"station-a",
						valueobject.DeliveryKindPublicEvent,
						"direct-recovery-alice",
					),
					dddDelivery(
						t,
						bobCurrent,
						"station-a",
						valueobject.DeliveryKindDirectCiphertext,
						"direct-recovery-bob",
					),
				},
				CommittedAt: at,
			},
			VerifiedRoutes: dddDirectRoutes(
				aliceCurrent,
				"station-a",
				bobCurrent,
				"station-a",
			),
			ExactCommandBytes: commandBytes,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	var delivered []dddDeviceInboxModel
	if err := fixture.db.
		Where("event_id = ?", string(result.Event.ID)).
		Find(&delivered).Error; err != nil {
		t.Fatal(err)
	}
	if len(delivered) != 2 {
		t.Fatalf("recovered Direct delivery count = %d, want 2", len(delivered))
	}
	for _, item := range delivered {
		endpoint := valueobject.Endpoint{
			Actor:  valueobject.PTID(item.RecipientPTID),
			Device: valueobject.DeviceID(item.RecipientDevice),
		}
		if endpoint != aliceCurrent && endpoint != bobCurrent {
			t.Fatalf("recovered Direct delivered to stale endpoint %s", endpoint.Key())
		}
	}
	assertCount(t, fixture.db, &persistence.ConversationMemberDeviceModel{}, 2)
}

func TestConversationDDDDirectProjectionRecoveryRejectsTamperedGenesis(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:direct-recovery-tampered-alice", "alice-1")
	bob := dddEndpoint("ptid:direct-recovery-tampered-bob", "bob-1")
	seedDDDDevices(
		t,
		fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-a"),
	)
	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "direct-recovery-tampered-create",
			VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-a"),
			ExactCommandBytes: []byte("direct-recovery-tampered-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.
		Where("conversation_id = ?", string(created.Conversation.ID)).
		Delete(&persistence.ConversationMemberDeviceModel{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&persistence.ConversationEventModel{}).
		Where(
			"conversation_id = ? AND sequence = ?",
			string(created.Conversation.ID),
			1,
		).
		Update("event_bytes", []byte("tampered-genesis")).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.queries.List(
		context.Background(),
		alice.Actor,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("tampered Direct genesis recovery error = %v", err)
	}
}

func TestConversationDDDCommandRoutesUseVerifiedRemoteActorWithoutShadowRow(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:verified-command-alice", "alice-1")
	bob := dddEndpoint("ptid:verified-command-bob", "bob-1")
	routes := dddDirectRoutes(alice, "station-a", bob, "station-b")
	seedDDDDevices(t, fixture.db, dddDevice(alice, "station-a"))

	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "verified-command-create",
			VerifiedRoutes:    routes,
			ExactCommandBytes: []byte("verified-command-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	var remoteShadowRows int64
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ?", string(bob.Actor)).
		Count(&remoteShadowRows).Error; err != nil {
		t.Fatal(err)
	}
	if remoteShadowRows != 0 {
		t.Fatalf("remote Actor shadow rows = %d, want 0", remoteShadowRows)
	}

	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		command.PrepareCommandRequest{
			ConversationID:    created.Conversation.ID,
			Sender:            alice,
			SenderHomeStation: "station-a",
			VerifiedRoutes:    routes,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !valueobject.EqualEndpointSets(
		preparation.RequiredEndpoints,
		[]valueobject.Endpoint{alice, bob},
	) {
		t.Fatalf("required endpoints = %+v", preparation.RequiredEndpoints)
	}

	at := fixture.clock.Now()
	commandBytes := dddSendCommandBytes(
		t,
		created.Conversation.ID,
		"verified-command-send",
		alice,
		preparation,
		at,
	)
	result, err := fixture.commands.Submit(
		context.Background(),
		command.SubmitRequest{
			Command: aggregate.Command{
				ID:                      "verified-command-send",
				ConversationID:          created.Conversation.ID,
				AuthorityStation:        "station-a",
				Sender:                  alice,
				ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
				ObservedMLSEpoch:        preparation.Head.MLSEpoch,
				DeliveryPlanHash:        preparation.DeliveryPlanHash,
				Kind:                    domainevent.KindMessageCommitted,
				MessageID:               "message-verified-command-send",
				Payload:                 commandBytes,
				Deliveries: []valueobject.PreparedDelivery{
					dddDelivery(
						t,
						alice,
						"station-a",
						valueobject.DeliveryKindPublicEvent,
						"alice-marker",
					),
					dddDelivery(
						t,
						bob,
						"station-b",
						valueobject.DeliveryKindDirectCiphertext,
						"bob-ciphertext",
					),
				},
				CommittedAt: at,
			},
			VerifiedRoutes:    routes,
			ExactCommandBytes: commandBytes,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Event.Sequence != 2 {
		t.Fatalf("committed sequence = %d, want 2", result.Event.Sequence)
	}

	if _, err := fixture.commands.PrepareCommand(
		context.Background(),
		command.PrepareCommandRequest{
			ConversationID:    created.Conversation.ID,
			Sender:            bob,
			SenderHomeStation: "station-b",
			VerifiedRoutes:    routes,
		},
	); err != nil {
		t.Fatalf("verified remote sender preparation failed: %v", err)
	}
	if _, err := fixture.commands.PrepareCommand(
		context.Background(),
		command.PrepareCommandRequest{
			ConversationID:    created.Conversation.ID,
			Sender:            bob,
			SenderHomeStation: "station-c",
			VerifiedRoutes:    routes,
		},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
		t.Fatalf("wrong remote Home Station error = %v", err)
	}
	staleRoutes := dddDirectRoutes(alice, "station-a", bob, "station-c")
	if _, err := fixture.commands.PrepareCommand(
		context.Background(),
		command.PrepareCommandRequest{
			ConversationID:    created.Conversation.ID,
			Sender:            alice,
			SenderHomeStation: "station-a",
			VerifiedRoutes:    staleRoutes,
		},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("stale member Home Station error = %v", err)
	}
	for _, testCase := range []struct {
		name   string
		routes []ports.EndpointRoute
	}{
		{name: "missing remote actor", routes: routes[:1]},
		{
			name:   "duplicate endpoint",
			routes: append(append([]ports.EndpointRoute(nil), routes...), routes[1]),
		},
		{
			name: "extra actor",
			routes: append(
				append([]ports.EndpointRoute(nil), routes...),
				ports.EndpointRoute{
					Endpoint:    dddEndpoint("ptid:verified-command-charlie", "charlie-1"),
					HomeStation: "station-c",
				},
			),
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := fixture.commands.PrepareCommand(
				context.Background(),
				command.PrepareCommandRequest{
					ConversationID:    created.Conversation.ID,
					Sender:            alice,
					SenderHomeStation: "station-a",
					VerifiedRoutes:    testCase.routes,
				},
			); !conversationdomain.IsCode(
				err,
				conversationdomain.ErrorCodeStaleAuthorityHead,
			) {
				t.Fatalf("invalid route snapshot error = %v", err)
			}
		})
	}
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", string(alice.Actor), string(alice.Device)).
		Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.commands.PrepareCommand(
		context.Background(),
		command.PrepareCommandRequest{
			ConversationID:    created.Conversation.ID,
			Sender:            alice,
			SenderHomeStation: "station-a",
			VerifiedRoutes:    routes,
		},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("inactive local sender error = %v", err)
	}
}

func TestConversationDDDMessageIdentityAndAuthorRules(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:message-alice", "alice-1")
	bob := dddEndpoint("ptid:message-bob", "bob-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-a"),
	)
	created, err := fixture.commands.CreateDirect(context.Background(), command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "message-rules-create",
		VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-a"),
		ExactCommandBytes: []byte("message-rules-create"),
	})
	if err != nil {
		t.Fatal(err)
	}

	submitWire := func(
		sender valueobject.Endpoint,
		commandID string,
		wire *chat.ChatCommand,
	) command.SubmitRequest {
		t.Helper()
		preparation, err := fixture.commands.PrepareCommand(
			context.Background(),
			dddPrepareCommandRequest(t, fixture, created.Conversation.ID, sender),
		)
		if err != nil {
			t.Fatal(err)
		}
		wire.CommandId = commandID
		wire.ConversationId = string(created.Conversation.ID)
		wire.Sender = dddEndpointProto(sender)
		wire.ObservedMembershipEpoch = int64(preparation.Head.MembershipEpoch)
		wire.ObservedMlsEpoch = int64(preparation.Head.MLSEpoch)
		wire.ClientTimestamp = timestamppb.New(fixture.clock.Now())
		wire.DeliveryPlanSha256 = preparation.DeliveryPlanHash.Bytes()
		wire.AuthorityStationPeerId = string(preparation.AuthorityStation)
		switch intent := wire.Payload.(type) {
		case *chat.ChatCommand_SendMessage:
			intent.SendMessage.DirectPayloads = []*chat.PreparedEndpointPayload{
				dddPreparedPayload(t, otherEndpoint(sender, alice, bob), "send-ciphertext"),
			}
		case *chat.ChatCommand_EditMessage:
			intent.EditMessage.DirectPayloads = []*chat.PreparedEndpointPayload{
				dddPreparedPayload(t, otherEndpoint(sender, alice, bob), "edit-ciphertext"),
			}
		}
		mapped, err := conversationhttp.MapSubmitCommand(
			conversationhttp.AuthenticatedActor{
				PTID:     string(sender.Actor),
				DeviceID: string(sender.Device),
			},
			&chat.SubmitConversationAuthorityCommandRequest{
				Submission: &chat.SubmitConversationAuthorityCommandRequest_Command{
					Command: wire,
				},
			},
			preparation,
			nil,
			fixture.clock.Now(),
		)
		if err != nil {
			t.Fatal(err)
		}
		mapped.VerifiedRoutes = dddActiveRoutes(t, fixture.db, alice.Actor, bob.Actor)
		return mapped
	}

	initial := submitWire(
		alice,
		"message-rules-send",
		&chat.ChatCommand{
			Payload: &chat.ChatCommand_SendMessage{
				SendMessage: &chat.SendMessageIntent{
					MessageId:   "message-rules-target",
					ContentKind: chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
				},
			},
		},
	)
	if _, err := fixture.commands.Submit(context.Background(), initial); err != nil {
		t.Fatal(err)
	}

	duplicate := submitWire(
		bob,
		"message-rules-duplicate",
		&chat.ChatCommand{
			Payload: &chat.ChatCommand_SendMessage{
				SendMessage: &chat.SendMessageIntent{
					MessageId:   "message-rules-target",
					ContentKind: chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
				},
			},
		},
	)
	if _, err := fixture.commands.Submit(
		context.Background(),
		duplicate,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("duplicate message identity error = %v", err)
	}

	foreignEdit := submitWire(
		bob,
		"message-rules-foreign-edit",
		&chat.ChatCommand{
			Payload: &chat.ChatCommand_EditMessage{
				EditMessage: &chat.EditMessageIntent{MessageId: "message-rules-target"},
			},
		},
	)
	if _, err := fixture.commands.Submit(
		context.Background(),
		foreignEdit,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("foreign edit error = %v", err)
	}
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 2)
}

func TestConversationDDDDissolveUsesCanonicalCommandAndEvent(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:dissolve-owner", "owner-1")
	member := dddEndpoint("ptid:dissolve-member", "member-1")
	groupID := valueobject.ConversationID("dissolve-group")
	createDDDGroup(t, fixture, groupID, owner, member)

	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, groupID, owner),
	)
	if err != nil {
		t.Fatal(err)
	}
	wire := &chat.ChatCommand{
		CommandId:               "dissolve-command",
		ConversationId:          string(groupID),
		Sender:                  dddEndpointProto(owner),
		ObservedMembershipEpoch: int64(preparation.Head.MembershipEpoch),
		ObservedMlsEpoch:        int64(preparation.Head.MLSEpoch),
		ClientTimestamp:         timestamppb.New(fixture.clock.Now()),
		DeliveryPlanSha256:      preparation.DeliveryPlanHash.Bytes(),
		AuthorityStationPeerId:  string(preparation.AuthorityStation),
		Payload: &chat.ChatCommand_DissolveConversation{
			DissolveConversation: &chat.DissolveConversationIntent{},
		},
	}
	request, err := conversationhttp.MapSubmitCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(owner.Actor),
			DeviceID: string(owner.Device),
		},
		&chat.SubmitConversationAuthorityCommandRequest{
			Submission: &chat.SubmitConversationAuthorityCommandRequest_Command{
				Command: wire,
			},
		},
		preparation,
		nil,
		fixture.clock.Now(),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.VerifiedRoutes = dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor)
	result, err := fixture.commands.Submit(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Conversation.Status != valueobject.ConversationStatusDissolved ||
		result.Event.Fact.Kind != domainevent.KindConversationDissolved {
		t.Fatalf("dissolve result = %+v", result)
	}
	var committed chat.ConversationEvent
	if err := proto.Unmarshal(result.Event.Bytes(), &committed); err != nil {
		t.Fatal(err)
	}
	if committed.GetConversationDissolved().GetDissolvedByPtid() != string(owner.Actor) {
		t.Fatalf("committed dissolve event = %+v", &committed)
	}
	if _, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, groupID, owner),
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeInactive) {
		t.Fatalf("dissolved conversation remained writable: %v", err)
	}
}

func TestConversationDDDConcurrentFirstCreateReplaysExactly(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:concurrent-alice", "alice-1")
	bob := dddEndpoint("ptid:concurrent-bob", "bob-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-b"),
	)
	request := command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "concurrent-create",
		VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-b"),
		ExactCommandBytes: []byte("concurrent-create"),
	}
	start := make(chan struct{})
	results := make(chan command.Result, 2)
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			result, err := fixture.commands.CreateDirect(context.Background(), request)
			results <- result
			errs <- err
		}()
	}
	close(start)

	var outcomes []command.Result
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent CreateDirect() error = %v", err)
		}
		outcomes = append(outcomes, <-results)
	}
	if outcomes[0].Event.ID != outcomes[1].Event.ID ||
		outcomes[0].Event.Hash != outcomes[1].Event.Hash ||
		outcomes[0].Replay == outcomes[1].Replay {
		t.Fatalf("concurrent outcomes = %+v", outcomes)
	}
	assertCount(t, fixture.db, &persistence.ConversationModel{}, 1)
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 1)
	assertCount(t, fixture.db, &persistence.ConversationCommandReceiptModel{}, 1)
}

func TestConversationDDDCreateReplayRejectsReceiptEventDrift(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:create-replay-alice", "alice-1")
	bob := dddEndpoint("ptid:create-replay-bob", "bob-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-b"),
	)
	request := command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "create-replay-drift",
		VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-b"),
		ExactCommandBytes: []byte("create-replay-drift"),
	}
	created, err := fixture.commands.CreateDirect(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&persistence.ConversationCommandReceiptModel{}).
		Where(
			"conversation_id = ? AND command_id = ?",
			string(created.Conversation.ID),
			string(request.CommandID),
		).
		Update("event_bytes", []byte("corrupt-event-result")).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.commands.CreateDirect(
		context.Background(),
		request,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("creation receipt drift error = %v", err)
	}
}

func TestConversationDDDForwardedProposalUsesAuthorityCommandPath(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:proposal-alice", "alice-1")
	bob := dddEndpoint("ptid:proposal-bob", "bob-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-b"),
	)
	created, err := fixture.commands.CreateDirect(context.Background(), command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "proposal-create",
		VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-b"),
		ExactCommandBytes: []byte("proposal-create"),
	})
	if err != nil {
		t.Fatal(err)
	}
	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, created.Conversation.ID, bob),
	)
	if err != nil {
		t.Fatal(err)
	}
	at := fixture.clock.Now()
	newSubmitRequest := func(commandID valueobject.CommandID) command.SubmitRequest {
		commandBytes := dddSendCommandBytes(
			t,
			created.Conversation.ID,
			commandID,
			bob,
			preparation,
			at,
		)
		return command.SubmitRequest{
			Command: aggregate.Command{
				ID:                      commandID,
				ConversationID:          created.Conversation.ID,
				AuthorityStation:        "station-a",
				Sender:                  bob,
				ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
				ObservedMLSEpoch:        preparation.Head.MLSEpoch,
				DeliveryPlanHash:        preparation.DeliveryPlanHash,
				Kind:                    domainevent.KindMessageCommitted,
				MessageID:               valueobject.MessageID("message-" + string(commandID)),
				Payload:                 commandBytes,
				Deliveries: []valueobject.PreparedDelivery{
					dddDelivery(t, alice, "station-a", valueobject.DeliveryKindDirectCiphertext, "alice-ciphertext"),
					dddDelivery(t, bob, "station-b", valueobject.DeliveryKindPublicEvent, "sender-marker"),
				},
				CommittedAt: at,
			},
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, alice.Actor, bob.Actor),
			ExactCommandBytes: commandBytes,
		}
	}
	wrongClaims := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-wrong-claims"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	wrongClaims.Claims.Issuer = "station-c"
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		wrongClaims,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
		t.Fatalf("wrong Station claims error = %v", err)
	}
	wrongHomeStation := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-wrong-home"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	wrongHomeStation.HomeStation = "station-c"
	wrongHomeStation.Claims.Issuer = "station-c"
	signDDDForwardedCommandRequest(t, &wrongHomeStation)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		wrongHomeStation,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
		t.Fatalf("wrong Home Station route error = %v", err)
	}
	wrongFederation := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-wrong-federation"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	wrongFederation.FederationID = "federation-other"
	wrongFederation.Claims.FederationID = "federation-other"
	signDDDForwardedCommandRequest(t, &wrongFederation)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		wrongFederation,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
		t.Fatalf("wrong Federation error = %v", err)
	}
	wrongAuthorityEpoch := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-wrong-authority-epoch"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	wrongAuthorityEpoch.AuthorityEpoch++
	wrongAuthorityEpoch.Claims.AuthorityEpoch = wrongAuthorityEpoch.AuthorityEpoch
	signDDDForwardedCommandRequest(t, &wrongAuthorityEpoch)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		wrongAuthorityEpoch,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
		t.Fatalf("wrong authority epoch error = %v", err)
	}
	expired := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-expired"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	expired.CreatedAt = dddTestTime.Add(-10 * time.Minute)
	expired.ExpiresAt = dddTestTime.Add(-5 * time.Minute)
	expired.Claims.ExpiresAt = expired.ExpiresAt
	signDDDForwardedCommandRequest(t, &expired)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		expired,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalExpired) {
		t.Fatalf("expired proposal error = %v", err)
	}
	expiresUnderLock := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-expires-under-lock"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	expiresUnderLock.CreatedAt = fixture.clock.now.Add(-time.Minute)
	expiresUnderLock.ExpiresAt = fixture.clock.now.Add(time.Second)
	expiresUnderLock.Claims.ExpiresAt = expiresUnderLock.ExpiresAt
	signDDDForwardedCommandRequest(t, &expiresUnderLock)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		expiresUnderLock,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalExpired) {
		t.Fatalf("proposal expiring at lock acquisition error = %v", err)
	}
	keyUnavailable := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-key-unavailable"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	fixture.adapters.signatureError = conversationdomain.NewError(
		conversationdomain.ErrorCodeActorKeyUnavailable,
		"test_identity.verify_device_signature",
		"actor_signing_key",
		"is temporarily unavailable",
	)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		keyUnavailable,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeActorKeyUnavailable) {
		t.Fatalf("temporarily unavailable actor key error = %v", err)
	}
	fixture.adapters.signatureError = nil
	var unavailableReceiptCount int64
	if err := fixture.db.Model(&persistence.ConversationCommandReceiptModel{}).
		Where(
			"conversation_id = ? AND command_id = ?",
			string(created.Conversation.ID),
			string(keyUnavailable.Command.Command.ID),
		).
		Count(&unavailableReceiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if unavailableReceiptCount != 0 {
		t.Fatal("temporary actor-key failure consumed the command identity")
	}
	invalidSignature := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-invalid-signature"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	invalidSignature.Signature = []byte("invalid")
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		invalidSignature,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalSignature) {
		t.Fatalf("invalid proposal signature error = %v", err)
	}
	var invalidSignatureReceiptCount int64
	if err := fixture.db.Model(&persistence.ConversationCommandReceiptModel{}).
		Where(
			"conversation_id = ? AND command_id = ?",
			string(created.Conversation.ID),
			string(invalidSignature.Command.Command.ID),
		).
		Count(&invalidSignatureReceiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if invalidSignatureReceiptCount != 0 {
		t.Fatal("unauthenticated proposal rejection consumed the command identity")
	}
	signDDDForwardedCommandRequest(t, &invalidSignature)
	recoveredSignature, err := fixture.commands.SubmitForwarded(
		context.Background(),
		invalidSignature,
	)
	if err != nil {
		t.Fatalf("valid re-signed proposal did not recover: %v", err)
	}
	if recoveredSignature.Replay || recoveredSignature.Event.ID == "" {
		t.Fatalf("valid re-signed proposal result = %+v", recoveredSignature)
	}
	invalidSignature.Signature = []byte("invalid")
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		invalidSignature,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalSignature) {
		t.Fatalf("accepted replay bypassed actor signature verification: %v", err)
	}
	signDDDForwardedCommandRequest(t, &invalidSignature)

	staleMembership := newSubmitRequest("forwarded-stale-membership")
	stalePreparation := preparation
	stalePreparation.Head.MembershipEpoch--
	staleMembership.Command.ObservedMembershipEpoch = stalePreparation.Head.MembershipEpoch
	staleMembershipBytes := dddSendCommandBytes(
		t,
		created.Conversation.ID,
		staleMembership.Command.ID,
		bob,
		stalePreparation,
		at,
	)
	staleMembership.Command.Payload = staleMembershipBytes
	staleMembership.ExactCommandBytes = staleMembershipBytes
	staleMembershipForwarded := dddForwardedCommandRequest(
		t,
		staleMembership,
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		staleMembershipForwarded,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleMembershipEpoch) {
		t.Fatalf("authenticated stale membership error = %v", err)
	}
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		staleMembershipForwarded,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleMembershipEpoch) {
		t.Fatalf("terminal stale membership replay error = %v", err)
	}
	var terminalReceipt persistence.ConversationCommandReceiptModel
	if err := fixture.db.First(
		&terminalReceipt,
		"conversation_id = ? AND command_id = ?",
		string(created.Conversation.ID),
		string(staleMembershipForwarded.Command.Command.ID),
	).Error; err != nil {
		t.Fatal(err)
	}
	if terminalReceipt.Outcome != string(repository.CommandReceiptOutcomeRejected) ||
		terminalReceipt.RejectionCode != string(conversationdomain.ErrorCodeStaleMembershipEpoch) ||
		terminalReceipt.EventID != "" {
		t.Fatalf("terminal rejection receipt = %+v", terminalReceipt)
	}
	preparation, err = fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, created.Conversation.ID, bob),
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.adapters.inactiveStations["station-b"] = true
	inactiveStation := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-inactive-station"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		inactiveStation,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeFederationInactive) {
		t.Fatalf("inactive Federation Station error = %v", err)
	}
	var retryableReceiptCount int64
	if err := fixture.db.Model(&persistence.ConversationCommandReceiptModel{}).
		Where(
			"conversation_id = ? AND command_id = ?",
			string(created.Conversation.ID),
			string(inactiveStation.Command.Command.ID),
		).
		Count(&retryableReceiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if retryableReceiptCount != 0 {
		t.Fatal("retryable Federation rejection was persisted as terminal")
	}
	fixture.adapters.inactiveStations["station-b"] = false
	inactiveRetry, err := fixture.commands.SubmitForwarded(
		context.Background(),
		inactiveStation,
	)
	if err != nil {
		t.Fatalf("retryable Federation proposal did not recover: %v", err)
	}
	if inactiveRetry.Replay || inactiveRetry.Event.ID == "" {
		t.Fatalf("retryable Federation proposal result = %+v", inactiveRetry)
	}
	preparation, err = fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, created.Conversation.ID, bob),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := newSubmitRequest("forwarded-command")
	forwardedRequest := dddForwardedCommandRequest(
		t,
		request,
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	committed, err := fixture.commands.SubmitForwarded(
		context.Background(),
		forwardedRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.clock.now = forwardedRequest.ExpiresAt.Add(time.Second)
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", string(bob.Actor), string(bob.Device)).
		Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	revokedNew := dddForwardedCommandRequest(
		t,
		newSubmitRequest("forwarded-revoked-new"),
		dddFederationID,
		dddAuthorityEpoch,
		"station-b",
	)
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		revokedNew,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeActorKeyRevoked) {
		t.Fatalf("new proposal from revoked actor key error = %v", err)
	}
	var revokedReceiptCount int64
	if err := fixture.db.Model(&persistence.ConversationCommandReceiptModel{}).
		Where(
			"conversation_id = ? AND command_id = ?",
			string(created.Conversation.ID),
			string(revokedNew.Command.Command.ID),
		).
		Count(&revokedReceiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if revokedReceiptCount != 0 {
		t.Fatal("revoked actor key consumed a new command identity")
	}
	forwardedReplay, err := fixture.commands.SubmitForwarded(
		context.Background(),
		forwardedRequest,
	)
	if err != nil {
		t.Fatalf("accepted replay after expiry and revocation error = %v", err)
	}
	if !forwardedReplay.Replay || forwardedReplay.Event.ID != committed.Event.ID {
		t.Fatalf("accepted forwarded replay = %+v, committed = %+v", forwardedReplay, committed)
	}
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		wrongClaims,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalBinding) {
		t.Fatalf("wrong Home Station replay error = %v", err)
	}
	conflictCommand := request
	conflictCommand.Command.Payload = []byte("forwarded-command-conflict")
	conflictCommand.ExactCommandBytes = conflictCommand.Command.Payload
	if _, err := fixture.commands.SubmitForwarded(
		context.Background(),
		dddForwardedCommandRequest(
			t,
			conflictCommand,
			dddFederationID,
			dddAuthorityEpoch,
			"station-b",
		),
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("forwarded command conflict error = %v", err)
	}
	replayed, err := fixture.commands.Submit(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if committed.Replay || !replayed.Replay ||
		committed.Event.ID != replayed.Event.ID ||
		committed.Event.Hash != replayed.Event.Hash {
		t.Fatalf("forwarded/local results = %+v / %+v", committed, replayed)
	}
}

func TestConversationDDDRetryableReadOnlyDoesNotConsumeCommandID(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:read-only-owner", "owner-1")
	member := dddEndpoint("ptid:read-only-member", "member-1")
	groupID := valueobject.ConversationID("read-only-group")
	createDDDGroup(t, fixture, groupID, owner, member)
	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, groupID, owner),
	)
	if err != nil {
		t.Fatal(err)
	}
	at := fixture.clock.Now()
	commandBytes := dddSendCommandBytes(
		t,
		groupID,
		"read-only-send",
		owner,
		preparation,
		at,
	)
	request := command.SubmitRequest{
		Command: aggregate.Command{
			ID:                      "read-only-send",
			ConversationID:          groupID,
			AuthorityStation:        "station-a",
			Sender:                  owner,
			ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
			ObservedMLSEpoch:        preparation.Head.MLSEpoch,
			DeliveryPlanHash:        preparation.DeliveryPlanHash,
			Kind:                    domainevent.KindMessageCommitted,
			MessageID:               "message-read-only-send",
			Payload:                 commandBytes,
			Deliveries: []valueobject.PreparedDelivery{
				dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner-marker"),
				dddDelivery(t, member, "station-a", valueobject.DeliveryKindMLSApplication, "member-ciphertext"),
			},
			CommittedAt: at,
		},
		VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
		ExactCommandBytes: commandBytes,
	}
	if err := fixture.db.Model(&persistence.ConversationModel{}).
		Where("conversation_id = ?", string(groupID)).
		Update("status", string(valueobject.ConversationStatusDegradedReadOnly)).
		Error; err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.commands.Submit(
		context.Background(),
		request,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeReadOnly) {
		t.Fatalf("read-only command error = %v", err)
	}
	var receiptCount int64
	if err := fixture.db.Model(&persistence.ConversationCommandReceiptModel{}).
		Where(
			"conversation_id = ? AND command_id = ?",
			string(groupID),
			string(request.Command.ID),
		).
		Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if receiptCount != 0 {
		t.Fatal("retryable read-only command was persisted as terminal")
	}
	if err := fixture.db.Model(&persistence.ConversationModel{}).
		Where("conversation_id = ?", string(groupID)).
		Update("status", string(valueobject.ConversationStatusActive)).
		Error; err != nil {
		t.Fatal(err)
	}
	recovered, err := fixture.commands.Submit(context.Background(), request)
	if err != nil {
		t.Fatalf("retryable read-only command did not recover: %v", err)
	}
	if recovered.Replay || recovered.Event.ID == "" {
		t.Fatalf("recovered command result = %+v", recovered)
	}
}

func TestConversationDDDStalePlanIsSupersededAndReservationsReleased(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:stale-owner", "owner-1")
	member := dddEndpoint("ptid:stale-member", "member-1")
	charlie := dddEndpoint("ptid:stale-charlie", "charlie-1")
	groupID := valueobject.ConversationID("stale-plan-group")
	createDDDGroup(t, fixture, groupID, owner, member)
	seedDDDDevices(t, fixture.db, dddDevice(charlie, "station-b"))

	plan, err := fixture.commands.PrepareMembership(
		context.Background(),
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action:      entity.MembershipActionAddActor,
				Actor:       charlie.Actor,
				Device:      charlie.Device,
				HomeStation: "station-b",
				Role:        valueobject.MemberRoleMember,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fixture.commands.Submit(context.Background(), command.SubmitRequest{
		Command: aggregate.Command{
			ID:               "stale-plan-command",
			ConversationID:   groupID,
			AuthorityStation: "station-a",
			Sender:           owner,
			Payload:          []byte("stale-plan-command"),
		},
		Membership: &aggregate.MembershipTransition{
			TransitionID: "stale-plan-transition",
		},
		VerifiedRoutes: dddActiveRoutes(
			t,
			fixture.db,
			owner.Actor,
			member.Actor,
			charlie.Actor,
		),
		ManifestStateHash: plan.EndpointManifestStateHash,
		AuthorityPlanID:   plan.ID,
		AuthorityPlanHash: valueobject.HashBytes([]byte("wrong-plan-hash")),
		ExactCommandBytes: []byte("stale-plan-command"),
	})
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanStale) {
		t.Fatalf("stale plan error = %v", err)
	}

	var persistedPlan persistence.ConversationAuthorityPlanModel
	if err := fixture.db.First(&persistedPlan, "plan_id = ?", string(plan.ID)).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != string(entity.AuthorityPlanStateSuperseded) {
		t.Fatalf("plan state = %q, want superseded", persistedPlan.State)
	}
	var released int64
	if err := fixture.db.Model(&dddKeyPackageReservationModel{}).
		Where("plan_id = ? AND state = ?", string(plan.ID), "released").
		Count(&released).Error; err != nil {
		t.Fatal(err)
	}
	if released != int64(len(plan.KeyPackageReservations)) {
		t.Fatalf("released reservations = %d, want %d", released, len(plan.KeyPackageReservations))
	}

	transitionPlan, err := fixture.commands.PrepareMembership(
		context.Background(),
		dddPrepareMembershipRequest(t, fixture, groupID, owner, plan.Changes),
	)
	if err != nil {
		t.Fatal(err)
	}
	transitionMismatch := membershipSubmitRequest(
		t,
		fixture,
		groupID,
		owner,
		transitionPlan,
		"stale-transition-command",
	)
	transitionMismatch.Membership.ToMLS = transitionPlan.AuthorityHead.MLSEpoch
	if _, err := fixture.commands.Submit(
		context.Background(),
		transitionMismatch,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanStale) {
		t.Fatalf("stale transition error = %v", err)
	}
	persistedPlan = persistence.ConversationAuthorityPlanModel{}
	if err := fixture.db.First(
		&persistedPlan,
		"plan_id = ?",
		string(transitionPlan.ID),
	).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != string(entity.AuthorityPlanStateSuperseded) {
		t.Fatalf("transition-mismatch plan state = %q, want superseded", persistedPlan.State)
	}
	released = 0
	if err := fixture.db.Model(&dddKeyPackageReservationModel{}).
		Where("plan_id = ? AND state = ?", string(transitionPlan.ID), "released").
		Count(&released).Error; err != nil {
		t.Fatal(err)
	}
	if released != int64(len(transitionPlan.KeyPackageReservations)) {
		t.Fatalf(
			"transition-mismatch released reservations = %d, want %d",
			released,
			len(transitionPlan.KeyPackageReservations),
		)
	}
	head, err := fixture.queries.PublicHead(context.Background(), groupID, owner.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if head.Head.Sequence != 1 {
		t.Fatalf("stale plan mutated authority head: %+v", head)
	}
}

func TestConversationDDDForeignRequesterCannotTerminalizeAuthorityPlan(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:plan-owner", "owner-1")
	member := dddEndpoint("ptid:plan-member", "member-1")
	added := dddEndpoint("ptid:plan-added", "added-1")
	groupID := valueobject.ConversationID("foreign-plan-group")
	createDDDGroup(t, fixture, groupID, owner, member)
	seedDDDDevices(t, fixture.db, dddDevice(added, "station-b"))

	plan, err := fixture.commands.PrepareMembership(
		context.Background(),
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action:      entity.MembershipActionAddActor,
				Actor:       added.Actor,
				Device:      added.Device,
				HomeStation: "station-b",
				Role:        valueobject.MemberRoleMember,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := membershipSubmitRequest(
		t,
		fixture,
		groupID,
		owner,
		plan,
		"foreign-plan-command",
	)
	request.Command.Sender = member
	request.Membership.Command.Sender = member
	if _, err := fixture.commands.Submit(
		context.Background(),
		request,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("foreign requester error = %v", err)
	}

	var persistedPlan persistence.ConversationAuthorityPlanModel
	if err := fixture.db.First(
		&persistedPlan,
		"plan_id = ?",
		string(plan.ID),
	).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != string(entity.AuthorityPlanStatePrepared) {
		t.Fatalf("foreign requester changed plan state to %q", persistedPlan.State)
	}
	var prepared int64
	if err := fixture.db.Model(&dddKeyPackageReservationModel{}).
		Where("plan_id = ? AND state = ?", string(plan.ID), "prepared").
		Count(&prepared).Error; err != nil {
		t.Fatal(err)
	}
	if prepared != int64(len(plan.KeyPackageReservations)) {
		t.Fatalf("prepared reservations = %d, want %d", prepared, len(plan.KeyPackageReservations))
	}
}

func TestConversationDDDGroupGenesisUsesVerifiedRemoteRoutes(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:verified-routes-owner", "owner-1")
	member := dddEndpoint("ptid:verified-routes-member", "member-1")
	seedDDDDevices(t, fixture.db, dddDevice(owner, "station-a"))
	routes := dddDirectRoutes(owner, "station-a", member, "station-b")
	groupID := valueobject.ConversationID("verified-routes-group")

	plan, err := fixture.commands.PrepareGroup(
		context.Background(),
		command.PrepareGroupRequest{
			ConversationID:    groupID,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			Name:              "Verified Routes",
			Owner:             owner,
			Members:           []valueobject.PTID{member.Actor},
			VerifiedRoutes:    routes,
			ManifestStateHash: dddManifestSetHash,
			ManifestSetHash:   dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.PostEndpoints) != 2 ||
		!valueobject.EqualEndpointSets(
			plan.PostEndpoints,
			[]valueobject.Endpoint{owner, member},
		) {
		t.Fatalf("prepared endpoints = %+v", plan.PostEndpoints)
	}

	result, err := fixture.commands.CreateGroup(
		context.Background(),
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    routes,
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "verified-routes-create",
			AuthorityPlanID:   plan.ID,
			AuthorityPlanHash: plan.Hash,
			Deliveries: []valueobject.PreparedDelivery{
				dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner"),
				dddDelivery(t, member, "station-b", valueobject.DeliveryKindMLSWelcome, "member"),
			},
			ExactCommandBytes: []byte("verified-routes-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	var memberHome valueobject.StationID
	for _, participant := range result.Conversation.Members {
		if participant.Actor == member.Actor {
			memberHome = participant.HomeStation
		}
	}
	if memberHome != "station-b" {
		t.Fatalf("remote member Home Station = %q", memberHome)
	}
	replayed, replayedOK, err := fixture.commands.ReplayGroupCreation(
		context.Background(),
		groupID,
		"verified-routes-create",
		[]byte("verified-routes-create"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayedOK || !replayed.Replay ||
		replayed.Conversation.ID != result.Conversation.ID ||
		replayed.Event.ID != result.Event.ID {
		t.Fatalf("exact Group creation replay = %+v, replayed=%t", replayed, replayedOK)
	}
	var shadowDevices int64
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ?", string(member.Actor)).
		Count(&shadowDevices).Error; err != nil {
		t.Fatal(err)
	}
	if shadowDevices != 0 {
		t.Fatalf("remote Actor Identity shadow rows = %d", shadowDevices)
	}
}

func TestConversationDDDMembershipUsesVerifiedRemoteRoutes(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:manifest-membership-owner", "owner-1")
	bob := dddEndpoint("ptid:manifest-membership-bob", "bob-1")
	charlie := dddEndpoint("ptid:manifest-membership-charlie", "charlie-1")
	seedDDDDevices(t, fixture.db, dddDevice(owner, "station-a"))
	routes := []ports.EndpointRoute{
		{Endpoint: owner, HomeStation: "station-a"},
		{Endpoint: bob, HomeStation: "station-b"},
		{Endpoint: charlie, HomeStation: "station-b"},
	}
	groupID := valueobject.ConversationID("manifest-membership-group")

	genesisPlan, err := fixture.commands.PrepareGroup(
		context.Background(),
		command.PrepareGroupRequest{
			ConversationID:    groupID,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			Name:              "Manifest Membership",
			Owner:             owner,
			Members:           []valueobject.PTID{bob.Actor, charlie.Actor},
			VerifiedRoutes:    routes,
			ManifestSetHash:   dddManifestSetHash,
			ManifestStateHash: dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fixture.commands.CreateGroup(
		context.Background(),
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    routes,
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "manifest-membership-create",
			AuthorityPlanID:   genesisPlan.ID,
			AuthorityPlanHash: genesisPlan.Hash,
			Deliveries: []valueobject.PreparedDelivery{
				dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner"),
				dddDelivery(t, bob, "station-b", valueobject.DeliveryKindMLSWelcome, "bob"),
				dddDelivery(t, charlie, "station-b", valueobject.DeliveryKindMLSWelcome, "charlie"),
			},
			ExactCommandBytes: []byte("manifest-membership-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	removeCharlie, err := fixture.commands.PrepareMembership(
		context.Background(),
		command.PrepareMembershipRequest{
			ConversationID: groupID,
			Requester:      owner,
			Changes: []entity.MembershipChange{{
				Action: entity.MembershipActionRemoveActor,
				Actor:  charlie.Actor,
			}},
			VerifiedRoutes:    routes,
			ManifestSetHash:   dddManifestSetHash,
			ManifestStateHash: dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	removed, err := fixture.commands.Submit(
		context.Background(),
		membershipSubmitRequestWithRoutes(
			t,
			fixture,
			groupID,
			owner,
			removeCharlie,
			"manifest-membership-remove-charlie",
			routes,
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshotHasActor(removed.Conversation, charlie.Actor) ||
		!snapshotHasActor(removed.Conversation, bob.Actor) {
		t.Fatalf("manifest-only removal result = %+v", removed.Conversation.Members)
	}

	currentRoutes := routes[:2]
	removeBob, err := fixture.commands.PrepareMembership(
		context.Background(),
		command.PrepareMembershipRequest{
			ConversationID: groupID,
			Requester:      owner,
			Changes: []entity.MembershipChange{{
				Action: entity.MembershipActionRemoveActor,
				Actor:  bob.Actor,
			}},
			VerifiedRoutes:    currentRoutes,
			ManifestSetHash:   dddManifestSetHash,
			ManifestStateHash: dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	staleRequest := membershipSubmitRequestWithRoutes(
		t,
		fixture,
		groupID,
		owner,
		removeBob,
		"manifest-membership-stale-state",
		currentRoutes,
	)
	staleRequest.ManifestStateHash = valueobject.HashBytes(
		[]byte("changed-manifest-state"),
	)
	if _, err := fixture.commands.Submit(
		context.Background(),
		staleRequest,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanStale) {
		t.Fatalf("changed manifest state error = %v", err)
	}
	current, err := fixture.queries.Get(context.Background(), groupID, owner.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if current.Conversation.Head != removed.Conversation.Head ||
		!snapshotHasActor(current.Conversation, bob.Actor) {
		t.Fatalf("stale manifest state mutated Conversation: %+v", current.Conversation)
	}

	var shadowDevices int64
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid IN ?", []string{string(bob.Actor), string(charlie.Actor)}).
		Count(&shadowDevices).Error; err != nil {
		t.Fatal(err)
	}
	if shadowDevices != 0 {
		t.Fatalf("remote Actor Identity shadow rows = %d", shadowDevices)
	}
}

func TestConversationDDDAuthorityPlanTTLIsBounded(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:ttl-owner", "owner-1")
	member := dddEndpoint("ptid:ttl-member", "member-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(owner, "station-a"),
		dddDevice(member, "station-a"),
	)

	if _, err := fixture.commands.PrepareGroup(
		context.Background(),
		command.PrepareGroupRequest{
			ConversationID:    "ttl-group",
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			Name:              "TTL Group",
			Owner:             owner,
			Members:           []valueobject.PTID{member.Actor},
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			ManifestSetHash:   dddManifestSetHash,
			TTL:               5*time.Minute + time.Nanosecond,
		},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeInvalidArgument) {
		t.Fatalf("unbounded group plan TTL error = %v", err)
	}

	membershipOwner := dddEndpoint("ptid:ttl-membership-owner", "owner-1")
	membershipMember := dddEndpoint("ptid:ttl-membership-member", "member-1")
	groupID := valueobject.ConversationID("ttl-membership-group")
	createDDDGroup(t, fixture, groupID, membershipOwner, membershipMember)
	membershipRequest := dddPrepareMembershipRequest(
		t,
		fixture,
		groupID,
		membershipOwner,
		[]entity.MembershipChange{{
			Action: entity.MembershipActionChangeRole,
			Actor:  membershipMember.Actor,
			Role:   valueobject.MemberRoleAdmin,
		}},
	)
	membershipRequest.TTL = 5*time.Minute + time.Nanosecond
	if _, err := fixture.commands.PrepareMembership(
		context.Background(),
		membershipRequest,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeInvalidArgument) {
		t.Fatalf("unbounded membership plan TTL error = %v", err)
	}
}

func TestConversationDDDExpiredPlansPersistTerminalStateAndReleaseReservations(t *testing.T) {
	t.Run("group genesis", func(t *testing.T) {
		fixture := newDDDComposition(t)
		owner := dddEndpoint("ptid:expired-genesis-owner", "owner-1")
		member := dddEndpoint("ptid:expired-genesis-member", "member-1")
		seedDDDDevices(t, fixture.db,
			dddDevice(owner, "station-a"),
			dddDevice(member, "station-a"),
		)
		plan, err := fixture.commands.PrepareGroup(
			context.Background(),
			command.PrepareGroupRequest{
				ConversationID:    "expired-genesis-group",
				FederationID:      dddFederationID,
				AuthorityEpoch:    dddAuthorityEpoch,
				Name:              "Expired Genesis",
				Owner:             owner,
				Members:           []valueobject.PTID{member.Actor},
				VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
				ManifestStateHash: dddManifestSetHash,
				ManifestSetHash:   dddManifestSetHash,
			},
		)
		if err != nil {
			t.Fatal(err)
		}
		fixture.clock.now = plan.ExpiresAt
		request := command.CreateGroupRequest{
			ConversationID:    plan.ConversationID,
			Owner:             owner,
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "expired-genesis-create",
			AuthorityPlanID:   plan.ID,
			AuthorityPlanHash: plan.Hash,
			ExactCommandBytes: []byte("expired-genesis-create"),
		}
		_, err = fixture.commands.CreateGroup(
			context.Background(),
			request,
		)
		if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanExpired) {
			t.Fatalf("expired group plan error = %v", err)
		}
		if _, err := fixture.commands.CreateGroup(
			context.Background(),
			request,
		); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanExpired) {
			t.Fatalf("expired group rejection replay error = %v", err)
		}
		var receipt persistence.ConversationCommandReceiptModel
		if err := fixture.db.First(
			&receipt,
			"conversation_id = ? AND command_id = ?",
			string(plan.ConversationID),
			string(request.CommandID),
		).Error; err != nil {
			t.Fatal(err)
		}
		if receipt.Outcome != string(repository.CommandReceiptOutcomeRejected) ||
			receipt.RejectionCode != string(conversationdomain.ErrorCodeAuthorityPlanExpired) {
			t.Fatalf("expired group receipt = %+v", receipt)
		}
		assertExpiredPlanAndReleasedReservations(t, fixture.db, plan)
		assertCount(t, fixture.db, &persistence.ConversationModel{}, 0)
	})

	t.Run("membership", func(t *testing.T) {
		fixture := newDDDComposition(t)
		owner := dddEndpoint("ptid:expired-membership-owner", "owner-1")
		member := dddEndpoint("ptid:expired-membership-member", "member-1")
		newDevice := dddEndpoint(string(member.Actor), "member-2")
		groupID := valueobject.ConversationID("expired-membership-group")
		created := createDDDGroup(t, fixture, groupID, owner, member)
		seedDDDDevices(t, fixture.db, dddDevice(newDevice, "station-a"))
		plan, err := fixture.commands.PrepareMembership(
			context.Background(),
			dddPrepareMembershipRequest(
				t,
				fixture,
				groupID,
				owner,
				[]entity.MembershipChange{{
					Action: entity.MembershipActionAddDevice,
					Actor:  newDevice.Actor,
					Device: newDevice.Device,
				}},
			),
		)
		if err != nil {
			t.Fatal(err)
		}
		fixture.clock.now = plan.ExpiresAt
		if _, err := fixture.commands.Submit(
			context.Background(),
			membershipSubmitRequest(
				t,
				fixture,
				groupID,
				owner,
				plan,
				"expired-membership-submit",
			),
		); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanExpired) {
			t.Fatalf("expired membership plan error = %v", err)
		}
		assertExpiredPlanAndReleasedReservations(t, fixture.db, plan)
		current, err := fixture.queries.Get(context.Background(), groupID, owner.Actor)
		if err != nil {
			t.Fatal(err)
		}
		if current.Conversation.Head != created.Conversation.Head ||
			snapshotHasEndpoint(current.Conversation, newDevice) {
			t.Fatalf("expired membership plan mutated Conversation: %+v", current.Conversation)
		}
	})
}

func TestConversationDDDPrepareMembershipRemovesRevokedDeviceLeaf(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:revoked-leaf-owner", "owner-1")
	member := dddEndpoint("ptid:revoked-leaf-member", "member-1")
	revoked := dddEndpoint(string(member.Actor), "member-2")
	groupID := valueobject.ConversationID("revoked-leaf-group")
	seedDDDDevices(t, fixture.db,
		dddDevice(owner, "station-a"),
		dddDevice(member, "station-a"),
		dddDevice(revoked, "station-a"),
	)
	genesisPlan, err := fixture.commands.PrepareGroup(
		context.Background(),
		command.PrepareGroupRequest{
			ConversationID:    groupID,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			Name:              "Revoked Leaf",
			Owner:             owner,
			Members:           []valueobject.PTID{member.Actor},
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			ManifestSetHash:   dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	genesisDeliveries := make([]valueobject.PreparedDelivery, 0, len(genesisPlan.PostEndpoints))
	for _, endpoint := range genesisPlan.PostEndpoints {
		kind := valueobject.DeliveryKindMLSWelcome
		if endpoint == owner {
			kind = valueobject.DeliveryKindPublicEvent
		}
		genesisDeliveries = append(
			genesisDeliveries,
			dddDelivery(t, endpoint, "station-a", kind, "genesis-"+endpoint.Key()),
		)
	}
	if _, err := fixture.commands.CreateGroup(
		context.Background(),
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "revoked-leaf-create",
			AuthorityPlanID:   genesisPlan.ID,
			AuthorityPlanHash: genesisPlan.Hash,
			Deliveries:        genesisDeliveries,
			ExactCommandBytes: []byte("revoked-leaf-create"),
		},
	); err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", string(revoked.Actor), string(revoked.Device)).
		Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	var revokedDeliveriesBefore int64
	if err := fixture.db.Model(&dddDeviceInboxModel{}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ?",
			string(revoked.Actor),
			string(revoked.Device),
		).
		Count(&revokedDeliveriesBefore).Error; err != nil {
		t.Fatal(err)
	}
	plan, err := fixture.commands.PrepareMembership(
		context.Background(),
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action: entity.MembershipActionRemoveDevice,
				Actor:  revoked.Actor,
				Device: revoked.Device,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Changes) != 1 ||
		plan.Changes[0].HomeStation != "station-a" ||
		!containsEndpointDDD(plan.PreEndpoints, revoked) ||
		containsEndpointDDD(plan.PostEndpoints, revoked) {
		t.Fatalf("revoked-device plan = %+v", plan)
	}
	result, err := fixture.commands.Submit(
		context.Background(),
		membershipSubmitRequest(
			t,
			fixture,
			groupID,
			owner,
			plan,
			"revoked-leaf-remove",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshotHasEndpoint(result.Conversation, revoked) {
		t.Fatalf("revoked endpoint remains active: %+v", result.Conversation.Devices)
	}
	var retirement dddDeviceInboxModel
	if err := fixture.db.First(
		&retirement,
		"event_id = ? AND recipient_ptid = ? AND recipient_device_id = ?",
		string(result.Event.ID),
		string(revoked.Actor),
		string(revoked.Device),
	).Error; err != nil {
		t.Fatalf("load final retirement delivery: %v", err)
	}
	var retirementDelivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(retirement.OpaquePayload, &retirementDelivery); err != nil {
		t.Fatalf("decode final retirement delivery: %v", err)
	}
	if retirementDelivery.PayloadKind !=
		chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_MLS_RETIREMENT {
		t.Fatalf("final revoked-device delivery kind = %v", retirementDelivery.PayloadKind)
	}

	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, groupID, owner),
	)
	if err != nil {
		t.Fatal(err)
	}
	sendAt := fixture.clock.Now()
	sendBytes := dddSendCommandBytes(
		t,
		groupID,
		"revoked-leaf-future-send",
		owner,
		preparation,
		sendAt,
	)
	if _, err := fixture.commands.Submit(
		context.Background(),
		command.SubmitRequest{
			Command: aggregate.Command{
				ID:                      "revoked-leaf-future-send",
				ConversationID:          groupID,
				AuthorityStation:        "station-a",
				Sender:                  owner,
				ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
				ObservedMLSEpoch:        preparation.Head.MLSEpoch,
				DeliveryPlanHash:        preparation.DeliveryPlanHash,
				Kind:                    domainevent.KindMessageCommitted,
				MessageID:               "message-revoked-leaf-future-send",
				Payload:                 sendBytes,
				Deliveries: []valueobject.PreparedDelivery{
					dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner-marker"),
					dddDelivery(t, member, "station-a", valueobject.DeliveryKindMLSApplication, "member-ciphertext"),
				},
				CommittedAt: sendAt,
			},
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ExactCommandBytes: sendBytes,
		},
	); err != nil {
		t.Fatal(err)
	}
	var revokedDeliveriesAfter int64
	if err := fixture.db.Model(&dddDeviceInboxModel{}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ?",
			string(revoked.Actor),
			string(revoked.Device),
		).
		Count(&revokedDeliveriesAfter).Error; err != nil {
		t.Fatal(err)
	}
	if revokedDeliveriesAfter != revokedDeliveriesBefore+1 {
		t.Fatalf(
			"revoked device deliveries = %d, want only the final retirement after %d prior items",
			revokedDeliveriesAfter,
			revokedDeliveriesBefore,
		)
	}
}

func TestConversationDDDActorRemovalIncludesRevokedSecondaryLeaf(t *testing.T) {
	for _, action := range []entity.MembershipAction{
		entity.MembershipActionRemoveActor,
		entity.MembershipActionLeave,
	} {
		t.Run(string(action), func(t *testing.T) {
			fixture := newDDDComposition(t)
			suffix := string(action)
			owner := dddEndpoint("ptid:revoked-actor-owner-"+suffix, "owner-1")
			member := dddEndpoint("ptid:revoked-actor-member-"+suffix, "member-1")
			revoked := dddEndpoint(string(member.Actor), "member-2")
			groupID := valueobject.ConversationID("revoked-actor-group-" + suffix)
			seedDDDDevices(t, fixture.db,
				dddDevice(owner, "station-a"),
				dddDevice(member, "station-a"),
				dddDevice(revoked, "station-a"),
			)
			genesisPlan, err := fixture.commands.PrepareGroup(
				context.Background(),
				command.PrepareGroupRequest{
					ConversationID:    groupID,
					FederationID:      dddFederationID,
					AuthorityEpoch:    dddAuthorityEpoch,
					Name:              "Revoked Actor",
					Owner:             owner,
					Members:           []valueobject.PTID{member.Actor},
					VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
					ManifestStateHash: dddManifestSetHash,
					ManifestSetHash:   dddManifestSetHash,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			genesisDeliveries := make([]valueobject.PreparedDelivery, 0, len(genesisPlan.PostEndpoints))
			for _, endpoint := range genesisPlan.PostEndpoints {
				kind := valueobject.DeliveryKindMLSWelcome
				if endpoint == owner {
					kind = valueobject.DeliveryKindPublicEvent
				}
				genesisDeliveries = append(
					genesisDeliveries,
					dddDelivery(t, endpoint, "station-a", kind, "genesis-"+endpoint.Key()),
				)
			}
			created, err := fixture.commands.CreateGroup(
				context.Background(),
				command.CreateGroupRequest{
					ConversationID:    groupID,
					Owner:             owner,
					VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
					ManifestStateHash: dddManifestSetHash,
					CommandID:         valueobject.CommandID("revoked-actor-create-" + suffix),
					AuthorityPlanID:   genesisPlan.ID,
					AuthorityPlanHash: genesisPlan.Hash,
					Deliveries:        genesisDeliveries,
					ExactCommandBytes: []byte("revoked-actor-create-" + suffix),
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			if err := fixture.db.Model(&dddActorDeviceModel{}).
				Where(
					"ptid = ? AND device_id = ?",
					string(revoked.Actor),
					string(revoked.Device),
				).
				Update("active", false).Error; err != nil {
				t.Fatal(err)
			}

			var leaveIntentID string
			if action == entity.MembershipActionLeave {
				intent, err := fixture.commands.SubmitLeaveIntent(
					context.Background(),
					dddLeaveIntentRequest(
						t,
						"revoked-actor-leave-intent",
						dddFederationID,
						groupID,
						member,
						"station-a",
						created.Conversation.Head,
						fixture.clock.Now(),
					),
				)
				if err != nil {
					t.Fatal(err)
				}
				leaveIntentID = intent.ID
			}
			plan, err := fixture.commands.PrepareMembership(
				context.Background(),
				dddPrepareMembershipRequest(
					t,
					fixture,
					groupID,
					owner,
					[]entity.MembershipChange{{
						Action: action,
						Actor:  member.Actor,
					}},
				),
			)
			if err != nil {
				t.Fatal(err)
			}
			if !containsEndpointDDD(plan.PreEndpoints, revoked) ||
				containsEndpointDDD(plan.PostEndpoints, member) ||
				containsEndpointDDD(plan.PostEndpoints, revoked) {
				t.Fatalf("actor-removal endpoint plan = %+v", plan)
			}
			request := membershipSubmitRequest(
				t,
				fixture,
				groupID,
				owner,
				plan,
				valueobject.CommandID("revoked-actor-submit-"+suffix),
			)
			if leaveIntentID != "" {
				request.Membership.LeaveIntentID = leaveIntentID
				request.Command.Payload = dddMembershipCommandBytes(
					t,
					groupID,
					request.Command.ID,
					owner,
					plan,
					string(request.Membership.TransitionID),
					leaveIntentID,
					request.Command.CommittedAt,
				)
				request.ExactCommandBytes = request.Command.Payload
			}
			result, err := fixture.commands.Submit(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			if snapshotHasActor(result.Conversation, member.Actor) ||
				snapshotHasEndpoint(result.Conversation, revoked) {
				t.Fatalf("actor removal retained active member state: %+v", result.Conversation)
			}
		})
	}
}

func TestConversationDDDStaleGroupGenesisPlanIsTerminal(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:genesis-owner", "owner-1")
	member := dddEndpoint("ptid:genesis-member", "member-1")
	groupID := valueobject.ConversationID("stale-genesis-group")
	seedDDDDevices(t, fixture.db,
		dddDevice(owner, "station-a"),
		dddDevice(member, "station-a"),
	)
	plan, err := fixture.commands.PrepareGroup(
		context.Background(),
		command.PrepareGroupRequest{
			ConversationID:    groupID,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			Name:              "Stale Genesis",
			Owner:             owner,
			Members:           []valueobject.PTID{member.Actor},
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			ManifestSetHash:   dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fixture.commands.CreateGroup(
		context.Background(),
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: valueobject.HashBytes([]byte("changed-manifest-state")),
			CommandID:         "stale-genesis-create",
			AuthorityPlanID:   plan.ID,
			AuthorityPlanHash: plan.Hash,
			ExactCommandBytes: []byte("stale-genesis-create"),
		},
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanStale) {
		t.Fatalf("stale genesis error = %v", err)
	}
	var persistedPlan persistence.ConversationAuthorityPlanModel
	if err := fixture.db.First(&persistedPlan, "plan_id = ?", string(plan.ID)).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != string(entity.AuthorityPlanStateSuperseded) {
		t.Fatalf("genesis plan state = %q, want superseded", persistedPlan.State)
	}
	var released int64
	if err := fixture.db.Model(&dddKeyPackageReservationModel{}).
		Where("plan_id = ? AND state = ?", string(plan.ID), "released").
		Count(&released).Error; err != nil {
		t.Fatal(err)
	}
	if released != int64(len(plan.KeyPackageReservations)) {
		t.Fatalf("released reservations = %d, want %d", released, len(plan.KeyPackageReservations))
	}
	assertCount(t, fixture.db, &persistence.ConversationModel{}, 0)
}

func TestConversationDDDLosingGroupPlanReleasesReservations(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:plan-race-owner", "owner-1")
	member := dddEndpoint("ptid:plan-race-member", "member-1")
	groupID := valueobject.ConversationID("plan-race-group")
	seedDDDDevices(t, fixture.db,
		dddDevice(owner, "station-a"),
		dddDevice(member, "station-a"),
	)
	prepare := func() entity.AuthorityPlan {
		t.Helper()
		plan, err := fixture.commands.PrepareGroup(
			context.Background(),
			command.PrepareGroupRequest{
				ConversationID:    groupID,
				FederationID:      dddFederationID,
				AuthorityEpoch:    dddAuthorityEpoch,
				Name:              "Plan Race",
				Owner:             owner,
				Members:           []valueobject.PTID{member.Actor},
				VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
				ManifestStateHash: dddManifestSetHash,
				ManifestSetHash:   dddManifestSetHash,
			},
		)
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	winner := prepare()
	loser := prepare()
	if _, err := fixture.commands.CreateGroup(
		context.Background(),
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "plan-race-winner",
			AuthorityPlanID:   winner.ID,
			AuthorityPlanHash: winner.Hash,
			Deliveries: []valueobject.PreparedDelivery{
				dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner"),
				dddDelivery(t, member, "station-a", valueobject.DeliveryKindMLSWelcome, "member"),
			},
			ExactCommandBytes: []byte("plan-race-winner"),
		},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.commands.CreateGroup(
		context.Background(),
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "plan-race-loser",
			AuthorityPlanID:   loser.ID,
			AuthorityPlanHash: loser.Hash,
			ExactCommandBytes: []byte("plan-race-loser"),
		},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("losing group plan error = %v", err)
	}

	var persistedPlan persistence.ConversationAuthorityPlanModel
	if err := fixture.db.First(&persistedPlan, "plan_id = ?", string(loser.ID)).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != string(entity.AuthorityPlanStateSuperseded) {
		t.Fatalf("losing plan state = %q, want superseded", persistedPlan.State)
	}
	var released int64
	if err := fixture.db.Model(&dddKeyPackageReservationModel{}).
		Where("plan_id = ? AND state = ?", string(loser.ID), "released").
		Count(&released).Error; err != nil {
		t.Fatal(err)
	}
	if released != int64(len(loser.KeyPackageReservations)) {
		t.Fatalf("released reservations = %d, want %d", released, len(loser.KeyPackageReservations))
	}
}

func TestConversationDDDPlanConsumptionRollsBackWithTransition(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:rollback-owner", "owner-1")
	member := dddEndpoint("ptid:rollback-member", "member-1")
	charlie := dddEndpoint("ptid:rollback-charlie", "charlie-1")
	groupID := valueobject.ConversationID("rollback-plan-group")
	createDDDGroup(t, fixture, groupID, owner, member)
	seedDDDDevices(t, fixture.db, dddDevice(charlie, "station-b"))

	plan, err := fixture.commands.PrepareMembership(
		context.Background(),
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action:      entity.MembershipActionAddActor,
				Actor:       charlie.Actor,
				Device:      charlie.Device,
				HomeStation: "station-b",
				Role:        valueobject.MemberRoleMember,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := membershipSubmitRequest(t, fixture, groupID, owner, plan, "rollback-membership")
	fixture.adapters.failNextInbox = true
	if _, err := fixture.commands.Submit(context.Background(), request); err == nil {
		t.Fatal("membership transition with injected inbox failure succeeded")
	}

	var persistedPlan persistence.ConversationAuthorityPlanModel
	if err := fixture.db.First(&persistedPlan, "plan_id = ?", string(plan.ID)).Error; err != nil {
		t.Fatal(err)
	}
	if persistedPlan.State != string(entity.AuthorityPlanStatePrepared) {
		t.Fatalf("rolled-back plan state = %q, want prepared", persistedPlan.State)
	}
	var prepared int64
	if err := fixture.db.Model(&dddKeyPackageReservationModel{}).
		Where("plan_id = ? AND state = ?", string(plan.ID), "prepared").
		Count(&prepared).Error; err != nil {
		t.Fatal(err)
	}
	if prepared != int64(len(plan.KeyPackageReservations)) {
		t.Fatalf("prepared reservations = %d, want %d", prepared, len(plan.KeyPackageReservations))
	}
	head, err := fixture.queries.PublicHead(context.Background(), groupID, owner.Actor)
	if err != nil {
		t.Fatal(err)
	}
	view, err := fixture.queries.Get(context.Background(), groupID, owner.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if head.Head.Sequence != 1 || snapshotHasActor(view.Conversation, charlie.Actor) {
		t.Fatalf("failed transition mutated authority state: %+v", head)
	}

	retried, err := fixture.commands.Submit(context.Background(), request)
	if err != nil {
		t.Fatalf("retry after rollback: %v", err)
	}
	if retried.Event.Sequence != 2 || !snapshotHasActor(retried.Conversation, charlie.Actor) {
		t.Fatalf("retry result = %+v", retried)
	}
}

func TestConversationDDDMemberSettingsClearCursorSupportsBoundedRestore(t *testing.T) {
	fixture := newDDDComposition(t)
	ctx := context.Background()
	alice := dddEndpoint("ptid:alice", "alice-1")
	bob := dddEndpoint("ptid:bob", "bob-1")
	seedDDDDevices(t, fixture.db, dddDevice(alice, "station-a"), dddDevice(bob, "station-a"))
	created, err := fixture.commands.CreateDirect(ctx, command.CreateDirectRequest{
		Creator:           alice,
		Peer:              bob.Actor,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		CommandID:         "create-settings",
		VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-a"),
		ExactCommandBytes: []byte("create-settings"),
	})
	if err != nil {
		t.Fatal(err)
	}
	conversationID := created.Conversation.ID
	clearedAt := dddTestTime.UnixMilli()
	muted := true
	if _, err := fixture.commands.UpdateMemberSettings(ctx, conversationID, alice.Actor,
		command.MemberSettingsPatch{ClearedAtUnixMillis: &clearedAt, Muted: &muted},
	); err != nil {
		t.Fatal(err)
	}
	for _, rejected := range []int64{-1, clearedAt - 1} {
		if _, err := fixture.commands.UpdateMemberSettings(ctx, conversationID, alice.Actor,
			command.MemberSettingsPatch{ClearedAtUnixMillis: &rejected},
		); err == nil {
			t.Fatalf("accepted invalid clear cursor %d", rejected)
		}
	}
	restoredAt := int64(0)
	restored, err := fixture.commands.UpdateMemberSettings(ctx, conversationID, alice.Actor,
		command.MemberSettingsPatch{ClearedAtUnixMillis: &restoredAt},
	)
	if err != nil {
		t.Fatalf("restore within window: %v", err)
	}
	if restored.ClearedAtUnixMillis != 0 {
		t.Fatalf("restored settings = %+v", restored)
	}
	secondClearAt := clearedAt + 1
	fixture.clock.now = time.UnixMilli(secondClearAt)
	if _, err := fixture.commands.UpdateMemberSettings(ctx, conversationID, alice.Actor,
		command.MemberSettingsPatch{ClearedAtUnixMillis: &secondClearAt},
	); err != nil {
		t.Fatalf("clear after restore: %v", err)
	}
	fixture.clock.now = time.UnixMilli(secondClearAt).Add(24*time.Hour + time.Millisecond)
	if _, err := fixture.commands.UpdateMemberSettings(ctx, conversationID, alice.Actor,
		command.MemberSettingsPatch{ClearedAtUnixMillis: &restoredAt},
	); err == nil {
		t.Fatal("accepted restore after restore window expired")
	}
	advancedAt := clearedAt + 1
	if _, err := fixture.commands.UpdateMemberSettings(ctx, conversationID, "ptid:outsider",
		command.MemberSettingsPatch{ClearedAtUnixMillis: &advancedAt},
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("nonmember update error = %v", err)
	}
	var persisted persistence.ConversationMemberSettingsModel
	if err := fixture.db.First(&persisted, "conversation_id = ? AND ptid = ?",
		string(conversationID), string(alice.Actor),
	).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.ClearedAtUnixMillis != secondClearAt || !persisted.Muted {
		t.Fatalf("persisted settings = %+v", persisted)
	}
}

func TestConversationDDDMemberAuthorityReplayRollbackAndFollower(t *testing.T) {
	ctx := context.Background()
	authority := newDDDComposition(t)
	owner := dddEndpoint("ptid:member-authority-owner", "owner-1")
	member := dddEndpoint("ptid:member-authority-member", "member-1")
	groupID := valueobject.ConversationID("group-member-authority-uow")
	created := createDDDGroup(t, authority, groupID, owner, member)

	muted := true
	mutedUntil := authority.clock.Now().Add(time.Hour)
	muteRequest := dddMemberAuthoritySubmitRequest(
		t,
		authority,
		groupID,
		owner,
		member.Actor,
		"mute-member",
		domainevent.MemberAuthorityActionUpdateMember,
		nil,
		&muted,
		&mutedUntil,
	)
	mutedResult, err := authority.commands.Submit(ctx, muteRequest)
	if err != nil {
		t.Fatalf("Submit(mute member) error = %v", err)
	}
	if mutedResult.Event.Fact.Kind != domainevent.KindMemberAuthority ||
		mutedResult.Conversation.Head.MembershipEpoch != 2 ||
		mutedResult.Conversation.Head.MLSEpoch != 1 {
		t.Fatalf("muted result = %+v", mutedResult)
	}
	persisted, err := authority.queries.Get(ctx, groupID, owner.Actor)
	if err != nil {
		t.Fatalf("Get(persisted mute) error = %v", err)
	}
	persistedMember := dddSnapshotMember(t, persisted.Conversation, member.Actor)
	if !persistedMember.Muted || persistedMember.MutedUntil == nil ||
		!persistedMember.MutedUntil.Equal(mutedUntil) {
		t.Fatalf("persisted member = %+v", persistedMember)
	}

	replayed, err := authority.commands.Submit(ctx, muteRequest)
	if err != nil {
		t.Fatalf("Submit(exact replay) error = %v", err)
	}
	if !replayed.Replay || replayed.Event.ID != mutedResult.Event.ID ||
		replayed.Conversation.Head != mutedResult.Conversation.Head ||
		replayed.Event.Fact.MemberAuthority == nil ||
		replayed.Event.Fact.MemberAuthority.Target != member.Actor {
		t.Fatalf("exact replay = %+v, committed = %+v", replayed, mutedResult)
	}
	conflicting := muteRequest
	conflicting.ExactCommandBytes = []byte("same-command-id-different-bytes")
	conflicting.Command.Payload = conflicting.ExactCommandBytes
	if _, err := authority.commands.Submit(
		ctx,
		conflicting,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("conflicting replay error = %v", err)
	}

	transferRequest := dddMemberAuthoritySubmitRequest(
		t,
		authority,
		groupID,
		owner,
		member.Actor,
		"transfer-owner",
		domainevent.MemberAuthorityActionTransferOwnership,
		nil,
		nil,
		nil,
	)
	beforeRollback := persisted.Conversation
	eventCount := rowCount(t, authority.db, &persistence.ConversationEventModel{})
	receiptCount := rowCount(t, authority.db, &persistence.ConversationCommandReceiptModel{})
	inboxCount := rowCount(t, authority.db, &dddDeviceInboxModel{})
	authority.adapters.failNextInbox = true
	if _, err := authority.commands.Submit(ctx, transferRequest); err == nil {
		t.Fatal("Submit(owner transfer with injected inbox failure) succeeded")
	}
	rolledBack, err := authority.queries.Get(ctx, groupID, owner.Actor)
	if err != nil {
		t.Fatalf("Get(after rollback) error = %v", err)
	}
	if rolledBack.Conversation.Owner != beforeRollback.Owner ||
		rolledBack.Conversation.Head != beforeRollback.Head ||
		!reflect.DeepEqual(rolledBack.Conversation.Members, beforeRollback.Members) {
		t.Fatalf("rollback changed Conversation: before=%+v after=%+v", beforeRollback, rolledBack.Conversation)
	}
	if rowCount(t, authority.db, &persistence.ConversationEventModel{}) != eventCount ||
		rowCount(t, authority.db, &persistence.ConversationCommandReceiptModel{}) != receiptCount ||
		rowCount(t, authority.db, &dddDeviceInboxModel{}) != inboxCount {
		t.Fatal("rollback left event, receipt, or delivery rows")
	}

	transferred, err := authority.commands.Submit(ctx, transferRequest)
	if err != nil {
		t.Fatalf("Submit(owner transfer retry) error = %v", err)
	}
	if transferred.Replay ||
		transferred.Conversation.Owner != member.Actor ||
		transferred.Conversation.Head.MembershipEpoch != 3 ||
		transferred.Conversation.Head.MLSEpoch != 1 {
		t.Fatalf("owner transfer result = %+v", transferred)
	}
	oldOwner := dddSnapshotMember(t, transferred.Conversation, owner.Actor)
	newOwner := dddSnapshotMember(t, transferred.Conversation, member.Actor)
	if oldOwner.Role != valueobject.MemberRoleAdmin ||
		newOwner.Role != valueobject.MemberRoleOwner ||
		newOwner.Muted ||
		newOwner.MutedUntil != nil {
		t.Fatalf("owner transfer members = old %+v, new %+v", oldOwner, newOwner)
	}

	follower := newDDDCompositionAtStation(t, "station-b")
	for _, event := range []domainevent.Record{
		created.Event,
		mutedResult.Event,
		transferred.Event,
	} {
		if err := follower.commands.ApplyFollowerEvent(ctx, event); err != nil {
			t.Fatalf("ApplyFollowerEvent(sequence=%d) error = %v", event.Sequence, err)
		}
	}
	followerView, err := follower.queries.Get(ctx, groupID, member.Actor)
	if err != nil {
		t.Fatalf("Get(follower owner transfer) error = %v", err)
	}
	if followerView.Source != query.SourceFollower ||
		followerView.Conversation.Owner != transferred.Conversation.Owner ||
		followerView.Conversation.Head != transferred.Conversation.Head ||
		!reflect.DeepEqual(
			followerView.Conversation.Members,
			transferred.Conversation.Members,
		) {
		t.Fatalf(
			"follower snapshot = %+v, authority = %+v",
			followerView,
			transferred.Conversation,
		)
	}

	prepareRequest := dddPrepareCommandRequest(t, authority, groupID, member)
	prepared, err := authority.commands.PrepareCommand(ctx, prepareRequest)
	if err != nil {
		t.Fatalf("PrepareCommand(competing updates) error = %v", err)
	}
	memberRole := valueobject.MemberRoleMember
	demoteFormerOwner := dddMemberAuthoritySubmitRequestWithPreparation(
		t,
		authority,
		prepared,
		prepareRequest.VerifiedRoutes,
		groupID,
		member,
		owner.Actor,
		"demote-former-owner",
		domainevent.MemberAuthorityActionUpdateMember,
		&memberRole,
		nil,
		nil,
	)
	muteFormerOwner := dddMemberAuthoritySubmitRequestWithPreparation(
		t,
		authority,
		prepared,
		prepareRequest.VerifiedRoutes,
		groupID,
		member,
		owner.Actor,
		"mute-former-owner",
		domainevent.MemberAuthorityActionUpdateMember,
		nil,
		&muted,
		nil,
	)
	if _, err := authority.commands.Submit(ctx, demoteFormerOwner); err != nil {
		t.Fatalf("Submit(first competing update) error = %v", err)
	}
	if _, err := authority.commands.Submit(
		ctx,
		muteFormerOwner,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleMembershipEpoch) {
		t.Fatalf("stale competing update error = %v", err)
	}
}

func TestConversationDDDTestCompositionGroupMembershipSettingsReadAndLeave(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:owner", "owner-1")
	member := dddEndpoint("ptid:member", "member-1")
	charlie := dddEndpoint("ptid:charlie", "charlie-1")
	charliePhone := dddEndpoint("ptid:charlie", "charlie-2")
	seedDDDDevices(t, fixture.db,
		dddDevice(owner, "station-a"),
		dddDevice(member, "station-a"),
		dddDevice(charlie, "station-b"),
		dddDevice(charliePhone, "station-b"),
	)
	ctx := context.Background()
	groupID := valueobject.ConversationID("group-1")
	plan, err := fixture.commands.PrepareGroup(ctx, command.PrepareGroupRequest{
		ConversationID:    groupID,
		FederationID:      dddFederationID,
		AuthorityEpoch:    dddAuthorityEpoch,
		Name:              "Project",
		Owner:             owner,
		Members:           []valueobject.PTID{member.Actor},
		VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
		ManifestStateHash: dddManifestSetHash,
		ManifestSetHash:   dddManifestSetHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := fixture.commands.CreateGroup(ctx, command.CreateGroupRequest{
		ConversationID:    groupID,
		Owner:             owner,
		VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
		ManifestStateHash: dddManifestSetHash,
		CommandID:         "group-create",
		AuthorityPlanID:   plan.ID,
		AuthorityPlanHash: plan.Hash,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner-marker"),
			dddDelivery(t, member, "station-a", valueobject.DeliveryKindMLSWelcome, "member-welcome"),
		},
		ExactCommandBytes: []byte("group-create"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Conversation.Head.MembershipEpoch != 1 ||
		created.Conversation.Head.MLSEpoch != 1 {
		t.Fatalf("group head = %+v", created.Conversation.Head)
	}

	membershipPlan, err := fixture.commands.PrepareMembership(
		ctx,
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action:      entity.MembershipActionAddActor,
				Actor:       charlie.Actor,
				Device:      charlie.Device,
				HomeStation: "untrusted-client-value",
				Role:        valueobject.MemberRoleMember,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(membershipPlan.Changes) != 2 ||
		membershipPlan.Changes[0].Action != entity.MembershipActionAddActor ||
		membershipPlan.Changes[0].Device != charlie.Device ||
		membershipPlan.Changes[0].HomeStation != "station-b" ||
		membershipPlan.Changes[1].Action != entity.MembershipActionAddDevice ||
		membershipPlan.Changes[1].Device != charliePhone.Device ||
		membershipPlan.Changes[1].HomeStation != "station-b" {
		t.Fatalf("membership plan did not bind the identity-owned Home Station: %+v", membershipPlan.Changes)
	}
	required := endpointUnionDDD(membershipPlan.PreEndpoints, membershipPlan.PostEndpoints)
	membershipDeliveries := make([]valueobject.PreparedDelivery, 0, len(required))
	for _, endpoint := range required {
		kind := valueobject.DeliveryKindMLSCommit
		if endpoint == owner {
			kind = valueobject.DeliveryKindPublicEvent
		}
		if endpoint.Actor == charlie.Actor {
			kind = valueobject.DeliveryKindMLSWelcome
		}
		membershipDeliveries = append(
			membershipDeliveries,
			dddDelivery(t, endpoint, "station-a", kind, "membership-"+endpoint.Key()),
		)
	}
	transitionAt := fixture.clock.Now()
	transitionPayload := dddMembershipCommandBytes(
		t,
		groupID,
		"membership-1",
		owner,
		membershipPlan,
		"transition-1",
		"",
		transitionAt,
	)
	membershipRequest := command.SubmitRequest{
		Command: aggregate.Command{
			ID:                      "membership-1",
			ConversationID:          groupID,
			AuthorityStation:        "station-a",
			Sender:                  owner,
			ObservedMembershipEpoch: membershipPlan.AuthorityHead.MembershipEpoch,
			ObservedMLSEpoch:        membershipPlan.AuthorityHead.MLSEpoch,
			DeliveryPlanHash:        membershipPlan.Hash,
			Kind:                    domainevent.KindMembershipCommitted,
			Payload:                 transitionPayload,
			Deliveries:              membershipDeliveries,
			CommittedAt:             transitionAt,
		},
		Membership: &aggregate.MembershipTransition{
			TransitionID:   "transition-1",
			FromMembership: membershipPlan.AuthorityHead.MembershipEpoch,
			FromMLS:        membershipPlan.AuthorityHead.MLSEpoch,
			ToMLS:          membershipPlan.AuthorityHead.MLSEpoch.Next(),
			Changes:        membershipPlan.Changes,
		},
		VerifiedRoutes: dddActiveRoutes(
			t,
			fixture.db,
			owner.Actor,
			member.Actor,
			charlie.Actor,
		),
		ManifestStateHash: membershipPlan.EndpointManifestStateHash,
		AuthorityPlanID:   membershipPlan.ID,
		AuthorityPlanHash: membershipPlan.Hash,
		ExactCommandBytes: transitionPayload,
	}
	transitionResult, err := fixture.commands.Submit(ctx, membershipRequest)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshotHasActor(transitionResult.Conversation, charlie.Actor) ||
		transitionResult.Conversation.Head.MembershipEpoch != 2 ||
		transitionResult.Conversation.Head.MLSEpoch != 2 {
		t.Fatalf("membership result = %+v", transitionResult.Conversation)
	}
	unjoinedMemberDevice := dddEndpoint(string(member.Actor), "member-2")
	seedDDDDevices(t, fixture.db, dddDevice(unjoinedMemberDevice, "station-a"))
	if _, err := fixture.commands.AdvanceReadCursor(
		ctx,
		groupID,
		unjoinedMemberDevice,
		transitionResult.Event.Sequence,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("unjoined member device read cursor error = %v", err)
	}

	nickname := "Team"
	settings, err := fixture.commands.UpdateMemberSettings(
		ctx,
		groupID,
		member.Actor,
		command.MemberSettingsPatch{Nickname: &nickname},
	)
	if err != nil {
		t.Fatal(err)
	}
	if settings.Nickname != nickname {
		t.Fatalf("settings = %+v", settings)
	}
	notificationsBeforeRead := fixture.notifier.count()
	readResult, err := fixture.commands.AdvanceReadCursor(
		ctx,
		groupID,
		member,
		transitionResult.Event.Sequence,
	)
	if err != nil {
		t.Fatal(err)
	}
	if readResult.Cursor.Sequence != transitionResult.Event.Sequence {
		t.Fatalf("read cursor = %+v", readResult.Cursor)
	}
	if fixture.notifier.count() != notificationsBeforeRead+1 {
		t.Fatal("read cursor notification included a remote endpoint")
	}
	var cursorItem dddDeviceInboxModel
	if err := fixture.db.First(
		&cursorItem,
		"payload_kind = ?",
		string(ports.DeviceInboxPayloadDeviceReceipt),
	).Error; err != nil {
		t.Fatal(err)
	}
	var cursorPayload chat.ActorReadCursor
	if err := proto.Unmarshal(cursorItem.OpaquePayload, &cursorPayload); err != nil {
		t.Fatalf("decode read cursor payload: %v", err)
	}
	if cursorPayload.GetConversationId() != string(groupID) ||
		cursorPayload.GetReaderPtid() != string(member.Actor) ||
		cursorPayload.GetLastReadSequence() != int64(transitionResult.Event.Sequence) {
		t.Fatalf("read cursor payload = %+v", &cursorPayload)
	}
	var unjoinedDeliveryCount int64
	if err := fixture.db.Model(&dddDeviceInboxModel{}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND payload_kind = ?",
			string(unjoinedMemberDevice.Actor),
			string(unjoinedMemberDevice.Device),
			string(ports.DeviceInboxPayloadDeviceReceipt),
		).
		Count(&unjoinedDeliveryCount).Error; err != nil {
		t.Fatal(err)
	}
	if unjoinedDeliveryCount != 0 {
		t.Fatalf("unjoined member device received %d read cursor deliveries", unjoinedDeliveryCount)
	}
	inboxBefore := rowCount(t, fixture.db, &dddDeviceInboxModel{})
	outboxBefore := rowCount(t, fixture.db, &dddFederationOutboxModel{})
	notificationsBefore := fixture.notifier.count()
	staleRead, err := fixture.commands.AdvanceReadCursor(
		ctx,
		groupID,
		member,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if staleRead.Cursor.Sequence != transitionResult.Event.Sequence {
		t.Fatalf("stale retry regressed cursor: %+v", staleRead.Cursor)
	}
	if rowCount(t, fixture.db, &dddDeviceInboxModel{}) != inboxBefore ||
		rowCount(t, fixture.db, &dddFederationOutboxModel{}) != outboxBefore ||
		fixture.notifier.count() != notificationsBefore {
		t.Fatal("stale read-cursor retry emitted a projection event")
	}
	var memberReadDeliveriesBefore int64
	if err := fixture.db.Model(&dddDeviceInboxModel{}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND payload_kind = ?",
			string(member.Actor),
			string(member.Device),
			string(ports.DeviceInboxPayloadDeviceReceipt),
		).
		Count(&memberReadDeliveriesBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", string(member.Actor), string(member.Device)).
		Update("active", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.commands.AdvanceReadCursor(
		ctx,
		groupID,
		owner,
		transitionResult.Event.Sequence,
	); err != nil {
		t.Fatal(err)
	}
	var memberReadDeliveriesAfter int64
	if err := fixture.db.Model(&dddDeviceInboxModel{}).
		Where(
			"recipient_ptid = ? AND recipient_device_id = ? AND payload_kind = ?",
			string(member.Actor),
			string(member.Device),
			string(ports.DeviceInboxPayloadDeviceReceipt),
		).
		Count(&memberReadDeliveriesAfter).Error; err != nil {
		t.Fatal(err)
	}
	if memberReadDeliveriesAfter != memberReadDeliveriesBefore {
		t.Fatal("read-cursor fan-out targeted a revoked member device")
	}
	if err := fixture.db.Model(&dddActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", string(member.Actor), string(member.Device)).
		Update("active", true).Error; err != nil {
		t.Fatal(err)
	}

	leaveRequest := dddLeaveIntentRequest(
		t,
		"leave-1",
		dddFederationID,
		groupID,
		member,
		"station-a",
		transitionResult.Conversation.Head,
		fixture.clock.Now(),
	)
	intent, err := fixture.commands.SubmitLeaveIntent(ctx, leaveRequest)
	if err != nil {
		t.Fatal(err)
	}
	if intent.State != repository.LeaveIntentStatePending {
		t.Fatalf("leave intent = %+v", intent)
	}
	wrongFederation := dddLeaveIntentRequest(
		t,
		"leave-wrong-federation",
		"federation-other",
		groupID,
		member,
		"station-a",
		transitionResult.Conversation.Head,
		fixture.clock.Now(),
	)
	if _, err := fixture.commands.SubmitLeaveIntent(
		ctx,
		wrongFederation,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("wrong-federation leave intent error = %v", err)
	}
	wrongAuthorityEpoch := dddLeaveIntentRequest(
		t,
		"leave-wrong-authority-epoch",
		dddFederationID,
		groupID,
		member,
		"station-a",
		transitionResult.Conversation.Head,
		fixture.clock.Now(),
	)
	wrongAuthorityEpoch.AuthorityEpoch = dddAuthorityEpoch + 1
	signDDDLeaveIntentRequest(t, &wrongAuthorityEpoch)
	if _, err := fixture.commands.SubmitLeaveIntent(
		ctx,
		wrongAuthorityEpoch,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("wrong-authority-epoch leave intent error = %v", err)
	}
	tamperedLeave := leaveRequest
	tamperedLeave.FederationID = "tampered-federation"
	if _, err := fixture.commands.SubmitLeaveIntent(
		ctx,
		tamperedLeave,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeCommandConflict) {
		t.Fatalf("conflicting leave intent replay error = %v", err)
	}
	forgedLeave := leaveRequest
	forgedLeave.ID = "leave-forged"
	if _, err := fixture.commands.SubmitLeaveIntent(
		ctx,
		forgedLeave,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeProposalSignature) {
		t.Fatalf("forged leave intent signature error = %v", err)
	}
	replayedIntent, err := fixture.commands.SubmitLeaveIntent(ctx, leaveRequest)
	if err != nil {
		t.Fatalf("exact leave intent replay error = %v", err)
	}
	if replayedIntent.ID != intent.ID ||
		!bytes.Equal(replayedIntent.SigningBytes, intent.SigningBytes) {
		t.Fatalf("leave intent replay = %+v, want original intent", replayedIntent)
	}
	leavePlan, err := fixture.commands.PrepareMembership(
		ctx,
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action: entity.MembershipActionLeave,
				Actor:  member.Actor,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	leaveRequired := endpointUnionDDD(leavePlan.PreEndpoints, leavePlan.PostEndpoints)
	leaveDeliveries := make([]valueobject.PreparedDelivery, 0, len(leaveRequired))
	for _, endpoint := range leaveRequired {
		kind := valueobject.DeliveryKindMLSCommit
		switch endpoint {
		case owner:
			kind = valueobject.DeliveryKindPublicEvent
		case member:
			kind = valueobject.DeliveryKindMLSRetirement
		}
		leaveDeliveries = append(
			leaveDeliveries,
			dddDelivery(t, endpoint, "station-a", kind, "leave-"+endpoint.Key()),
		)
	}
	leaveAt := fixture.clock.Now()
	leaveBytes := dddMembershipCommandBytes(
		t,
		groupID,
		"membership-leave",
		owner,
		leavePlan,
		"transition-leave",
		intent.ID,
		leaveAt,
	)
	leaveResult, err := fixture.commands.Submit(ctx, command.SubmitRequest{
		Command: aggregate.Command{
			ID:                      "membership-leave",
			ConversationID:          groupID,
			AuthorityStation:        "station-a",
			Sender:                  owner,
			ObservedMembershipEpoch: leavePlan.AuthorityHead.MembershipEpoch,
			ObservedMLSEpoch:        leavePlan.AuthorityHead.MLSEpoch,
			DeliveryPlanHash:        leavePlan.Hash,
			Kind:                    domainevent.KindMembershipCommitted,
			Payload:                 leaveBytes,
			Deliveries:              leaveDeliveries,
			CommittedAt:             leaveAt,
		},
		Membership: &aggregate.MembershipTransition{
			TransitionID:   "transition-leave",
			FromMembership: leavePlan.AuthorityHead.MembershipEpoch,
			FromMLS:        leavePlan.AuthorityHead.MLSEpoch,
			ToMLS:          leavePlan.AuthorityHead.MLSEpoch.Next(),
			Changes:        leavePlan.Changes,
			LeaveIntentID:  intent.ID,
		},
		VerifiedRoutes: dddActiveRoutes(
			t,
			fixture.db,
			owner.Actor,
			member.Actor,
			charlie.Actor,
		),
		ManifestStateHash: leavePlan.EndpointManifestStateHash,
		AuthorityPlanID:   leavePlan.ID,
		AuthorityPlanHash: leavePlan.Hash,
		ExactCommandBytes: leaveBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshotHasActor(leaveResult.Conversation, member.Actor) {
		t.Fatal("delegated leave did not remove the member")
	}
	var consumed persistence.ConversationLeaveIntentModel
	if err := fixture.db.First(&consumed, "intent_id = ?", intent.ID).Error; err != nil {
		t.Fatal(err)
	}
	if consumed.State != string(repository.LeaveIntentStateConsumed) ||
		consumed.TransitionID != "transition-leave" {
		t.Fatalf("consumed leave intent = %+v", consumed)
	}
	replayedConsumed, err := fixture.commands.SubmitLeaveIntent(ctx, leaveRequest)
	if err != nil {
		t.Fatalf("consumed leave intent replay error = %v", err)
	}
	if replayedConsumed.State != repository.LeaveIntentStateConsumed ||
		replayedConsumed.TransitionID != "transition-leave" {
		t.Fatalf("consumed leave intent replay = %+v", replayedConsumed)
	}
	ownerLeaveRequest := dddLeaveIntentRequest(
		t,
		"leave-owner",
		dddFederationID,
		groupID,
		owner,
		"station-a",
		leaveResult.Conversation.Head,
		fixture.clock.Now(),
	)
	if _, err := fixture.commands.SubmitLeaveIntent(
		ctx,
		ownerLeaveRequest,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeOwnerProtected) {
		t.Fatalf("owner leave error = %v", err)
	}
}

func TestConversationDDDStaleLeaveTransitionPreservesPendingIntent(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:leave-owner", "owner-1")
	member := dddEndpoint("ptid:leave-member", "member-1")
	groupID := valueobject.ConversationID("group-stale-leave")
	created := createDDDGroup(t, fixture, groupID, owner, member)
	ctx := context.Background()

	leaveRequest := dddLeaveIntentRequest(
		t,
		"leave-stale-route",
		dddFederationID,
		groupID,
		member,
		"station-a",
		created.Conversation.Head,
		fixture.clock.Now(),
	)
	intent, err := fixture.commands.SubmitLeaveIntent(ctx, leaveRequest)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := fixture.commands.PrepareMembership(
		ctx,
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action: entity.MembershipActionLeave,
				Actor:  member.Actor,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := membershipSubmitRequest(
		t,
		fixture,
		groupID,
		owner,
		plan,
		"stale-leave-transition",
	)
	request.Membership.LeaveIntentID = intent.ID
	request.Command.Payload = dddMembershipCommandBytes(
		t,
		groupID,
		request.Command.ID,
		owner,
		plan,
		string(request.Membership.TransitionID),
		intent.ID,
		request.Command.CommittedAt,
	)
	request.ExactCommandBytes = request.Command.Payload

	request.ManifestStateHash = valueobject.HashBytes(
		[]byte("changed-manifest-state"),
	)
	if _, err := fixture.commands.Submit(ctx, request); !conversationdomain.IsCode(
		err,
		conversationdomain.ErrorCodeAuthorityPlanStale,
	) {
		t.Fatalf("stale leave transition error = %v", err)
	}
	var stored persistence.ConversationLeaveIntentModel
	if err := fixture.db.First(&stored, "intent_id = ?", intent.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.State != string(repository.LeaveIntentStatePending) ||
		stored.ConsumedAt != nil ||
		stored.TransitionID != "" {
		t.Fatalf("stale transition consumed leave intent: %+v", stored)
	}
}

func TestConversationDDDLeaveIntentRejectsHomeAuthorityAndExpiryMismatch(t *testing.T) {
	fixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:leave-binding-owner", "owner-1")
	member := dddEndpoint("ptid:leave-binding-member", "member-1")
	groupID := valueobject.ConversationID("leave-binding-group")
	created := createDDDGroup(t, fixture, groupID, owner, member)
	now := fixture.clock.Now()

	wrongHome := dddLeaveIntentRequest(
		t,
		"leave-wrong-home",
		dddFederationID,
		groupID,
		member,
		"station-a",
		created.Conversation.Head,
		now,
	)
	wrongHome.HomeStation = "station-b"
	signDDDLeaveIntentRequest(t, &wrongHome)
	if _, err := fixture.commands.SubmitLeaveIntent(
		context.Background(),
		wrongHome,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("wrong Home Station leave intent error = %v", err)
	}

	wrongAuthority := dddLeaveIntentRequest(
		t,
		"leave-wrong-authority",
		dddFederationID,
		groupID,
		member,
		"station-a",
		created.Conversation.Head,
		now,
	)
	wrongAuthority.AuthorityStation = "station-b"
	signDDDLeaveIntentRequest(t, &wrongAuthority)
	if _, err := fixture.commands.SubmitLeaveIntent(
		context.Background(),
		wrongAuthority,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("wrong authority Station leave intent error = %v", err)
	}

	expired := dddLeaveIntentRequest(
		t,
		"leave-expired",
		dddFederationID,
		groupID,
		member,
		"station-a",
		created.Conversation.Head,
		now.Add(-2*time.Minute),
	)
	expired.ExpiresAt = now.Add(-time.Minute)
	signDDDLeaveIntentRequest(t, &expired)
	if _, err := fixture.commands.SubmitLeaveIntent(
		context.Background(),
		expired,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanExpired) {
		t.Fatalf("expired leave intent error = %v", err)
	}
}

func TestConversationDDDCrossConversationLeaveIntentIsNotConsumed(t *testing.T) {
	fixture := newDDDComposition(t)
	ownerA := dddEndpoint("ptid:leave-scope-owner-a", "owner-a")
	memberA := dddEndpoint("ptid:leave-scope-member-a", "member-a")
	groupA := valueobject.ConversationID("leave-scope-group-a")
	createdA := createDDDGroup(t, fixture, groupA, ownerA, memberA)
	intent, err := fixture.commands.SubmitLeaveIntent(
		context.Background(),
		dddLeaveIntentRequest(
			t,
			"leave-scope-intent-a",
			dddFederationID,
			groupA,
			memberA,
			"station-a",
			createdA.Conversation.Head,
			fixture.clock.Now(),
		),
	)
	if err != nil {
		t.Fatal(err)
	}

	ownerB := dddEndpoint("ptid:leave-scope-owner-b", "owner-b")
	memberB := dddEndpoint("ptid:leave-scope-member-b", "member-b")
	groupB := valueobject.ConversationID("leave-scope-group-b")
	createDDDGroup(t, fixture, groupB, ownerB, memberB)
	plan, err := fixture.commands.PrepareMembership(
		context.Background(),
		dddPrepareMembershipRequest(
			t,
			fixture,
			groupB,
			ownerB,
			[]entity.MembershipChange{{
				Action: entity.MembershipActionLeave,
				Actor:  memberB.Actor,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := membershipSubmitRequest(
		t,
		fixture,
		groupB,
		ownerB,
		plan,
		"leave-scope-submit-b",
	)
	request.Membership.LeaveIntentID = intent.ID
	request.Command.Payload = dddMembershipCommandBytes(
		t,
		groupB,
		request.Command.ID,
		ownerB,
		plan,
		string(request.Membership.TransitionID),
		intent.ID,
		request.Command.CommittedAt,
	)
	request.ExactCommandBytes = request.Command.Payload
	if _, err := fixture.commands.Submit(
		context.Background(),
		request,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeAuthorityPlanStale) {
		t.Fatalf("cross-Conversation leave intent error = %v", err)
	}
	var stored persistence.ConversationLeaveIntentModel
	if err := fixture.db.First(&stored, "intent_id = ?", intent.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.State != string(repository.LeaveIntentStatePending) ||
		stored.ConsumedAt != nil ||
		stored.TransitionID != "" {
		t.Fatalf("cross-Conversation attempt consumed leave intent: %+v", stored)
	}
}

func TestConversationDDDTestCompositionFollowerAndPostCommitFailure(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-bob", "bob-1")
	devices := []entity.MemberDevice{
		dddMemberDevice(t, alice, "station-c"),
		dddMemberDevice(t, bob, "station-c"),
	}
	deliveries := []valueobject.PreparedDelivery{
		dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
		dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
	}
	authority, transition, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices:      devices,
		CommandID:    "follower-create",
		Creator:      alice,
		Deliveries:   deliveries,
		EventPayload: []byte("follower-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		transition.Event,
	); err != nil {
		t.Fatal(err)
	}
	head, err := fixture.queries.PublicHead(
		context.Background(),
		authority.ID(),
		bob.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if head.Source != query.SourceFollower || head.Head != authority.AuthorityHead() {
		t.Fatalf("follower head = %+v", head)
	}
	second := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-message-2",
		dddTestTime.Add(time.Minute),
	)
	tampered := second.Event.Clone()
	tampered.EncodedBytes[0] ^= 0xff
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		tampered,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("tampered follower event error = %v", err)
	}
	third := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-message-3",
		dddTestTime.Add(2*time.Minute),
	)
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		third.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("out-of-order follower event error = %v", err)
	}
	var follower persistence.ConversationFollowerHeadModel
	if err := fixture.db.First(
		&follower,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	var followerState persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&followerState,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	if follower.Sequence != 1 ||
		followerState.Status != string(repository.FollowerStatusResyncRequired) {
		t.Fatalf("follower after out-of-order event = %+v", follower)
	}
	head, err = fixture.queries.PublicHead(
		context.Background(),
		authority.ID(),
		bob.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if head.FollowerStatus != repository.FollowerStatusResyncRequired {
		t.Fatalf("public follower status = %q", head.FollowerStatus)
	}
	assertCount(t, fixture.db, &persistence.ConversationFollowerPendingEventModel{}, 1)
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		second.Event,
	); err != nil {
		t.Fatalf("follower did not converge after receiving the missing event: %v", err)
	}
	head, err = fixture.queries.PublicHead(
		context.Background(),
		authority.ID(),
		bob.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if head.Head.Sequence != third.Event.Sequence ||
		head.Head.EventHash != third.Event.Hash ||
		head.FollowerStatus != repository.FollowerStatusActive {
		t.Fatalf("converged follower head = %+v", head)
	}
	assertCount(t, fixture.db, &persistence.ConversationFollowerPendingEventModel{}, 0)
	events, err := fixture.queries.Events(
		context.Background(),
		authority.ID(),
		bob.Actor,
		0,
		10,
	)
	if err != nil {
		t.Fatalf("list follower events: %v", err)
	}
	if len(events) != 3 ||
		events[0].ID != transition.Event.ID ||
		events[1].ID != second.Event.ID ||
		events[2].ID != third.Event.ID {
		t.Fatalf("follower events = %+v, want complete authority history", events)
	}

	fixture.notifier.failNext = true
	seedDDDDevices(t, fixture.db,
		dddDevice(dddEndpoint("ptid:local-a", "a-1"), "station-a"),
		dddDevice(dddEndpoint("ptid:local-b", "b-1"), "station-a"),
	)
	committed, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:        dddEndpoint("ptid:local-a", "a-1"),
			Peer:           "ptid:local-b",
			FederationID:   dddFederationID,
			AuthorityEpoch: dddAuthorityEpoch,
			CommandID:      "post-commit-create",
			VerifiedRoutes: dddDirectRoutes(
				dddEndpoint("ptid:local-a", "a-1"),
				"station-a",
				dddEndpoint("ptid:local-b", "b-1"),
				"station-a",
			),
			ExactCommandBytes: []byte("post-commit-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if committed.PostCommitError == nil {
		t.Fatal("post-commit notification failure was hidden")
	}
	if _, err := fixture.queries.Get(
		context.Background(),
		committed.Conversation.ID,
		"ptid:local-a",
	); err != nil {
		t.Fatalf("committed aggregate was rolled back by notification failure: %v", err)
	}
}

func TestConversationDDDPostCommitFailuresDoNotRollBackCommandOrReadCursor(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:post-commit-alice", "alice-1")
	bob := dddEndpoint("ptid:post-commit-bob", "bob-1")
	seedDDDDevices(t, fixture.db,
		dddDevice(alice, "station-a"),
		dddDevice(bob, "station-a"),
	)
	created, err := fixture.commands.CreateDirect(
		context.Background(),
		command.CreateDirectRequest{
			Creator:           alice,
			Peer:              bob.Actor,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			CommandID:         "post-commit-direct",
			VerifiedRoutes:    dddDirectRoutes(alice, "station-a", bob, "station-a"),
			ExactCommandBytes: []byte("post-commit-direct"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, fixture, created.Conversation.ID, alice),
	)
	if err != nil {
		t.Fatal(err)
	}
	at := fixture.clock.Now()
	commandBytes := dddSendCommandBytes(
		t,
		created.Conversation.ID,
		"post-commit-message",
		alice,
		preparation,
		at,
	)
	fixture.notifier.failNext = true
	committed, err := fixture.commands.Submit(
		context.Background(),
		command.SubmitRequest{
			Command: aggregate.Command{
				ID:                      "post-commit-message",
				ConversationID:          created.Conversation.ID,
				AuthorityStation:        "station-a",
				Sender:                  alice,
				ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
				ObservedMLSEpoch:        preparation.Head.MLSEpoch,
				DeliveryPlanHash:        preparation.DeliveryPlanHash,
				Kind:                    domainevent.KindMessageCommitted,
				MessageID:               "message-post-commit",
				Payload:                 commandBytes,
				Deliveries: []valueobject.PreparedDelivery{
					dddDelivery(t, alice, "station-a", valueobject.DeliveryKindPublicEvent, "alice-marker"),
					dddDelivery(t, bob, "station-a", valueobject.DeliveryKindDirectCiphertext, "bob-ciphertext"),
				},
				CommittedAt: at,
			},
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, alice.Actor, bob.Actor),
			ExactCommandBytes: commandBytes,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if committed.PostCommitError == nil {
		t.Fatal("ordinary command post-commit notification failure was hidden")
	}
	events, err := fixture.queries.Events(
		context.Background(),
		created.Conversation.ID,
		alice.Actor,
		0,
		10,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[1].ID != committed.Event.ID {
		t.Fatalf("ordinary command did not remain committed: %+v", events)
	}

	fixture.notifier.failNext = true
	cursorResult, err := fixture.commands.AdvanceReadCursor(
		context.Background(),
		created.Conversation.ID,
		alice,
		committed.Event.Sequence,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cursorResult.PostCommitError == nil {
		t.Fatal("read cursor post-commit notification failure was hidden")
	}
	cursor, err := fixture.queries.ReadCursor(
		context.Background(),
		created.Conversation.ID,
		alice.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	if cursor.Sequence != committed.Event.Sequence {
		t.Fatalf("read cursor was rolled back by notification failure: %+v", cursor)
	}
}

func TestConversationDDDFollowerRejoinCheckpointCrossesEntitlementGap(t *testing.T) {
	ctx := context.Background()
	authority := newDDDCompositionAtStation(t, "station-a")
	follower := newDDDCompositionAtStation(t, "station-b")
	owner := dddEndpoint("ptid:follower-rejoin-owner", "owner-1")
	member := dddEndpoint("ptid:follower-rejoin-member", "member-1")
	groupID := valueobject.ConversationID("follower-rejoin-group")
	seedDDDDevices(
		t,
		authority.db,
		dddDevice(owner, "station-a"),
		dddDevice(member, "station-b"),
	)
	routes := dddDirectRoutes(owner, "station-a", member, "station-b")
	createPlan, err := authority.commands.PrepareGroup(
		ctx,
		command.PrepareGroupRequest{
			ConversationID:    groupID,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			Name:              "Follower Rejoin",
			Owner:             owner,
			Members:           []valueobject.PTID{member.Actor},
			VerifiedRoutes:    routes,
			ManifestStateHash: dddManifestSetHash,
			ManifestSetHash:   dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	created, err := authority.commands.CreateGroup(
		ctx,
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    routes,
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "follower-rejoin-create",
			AuthorityPlanID:   createPlan.ID,
			AuthorityPlanHash: createPlan.Hash,
			Deliveries: []valueobject.PreparedDelivery{
				dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner-marker"),
				dddDelivery(t, member, "station-b", valueobject.DeliveryKindMLSWelcome, "member-welcome"),
			},
			ExactCommandBytes: []byte("follower-rejoin-create"),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := follower.commands.ApplyFollowerEvent(ctx, created.Event); err != nil {
		t.Fatal(err)
	}

	removePlan, err := authority.commands.PrepareMembership(
		ctx,
		dddPrepareMembershipRequest(
			t,
			authority,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action: entity.MembershipActionRemoveActor,
				Actor:  member.Actor,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	removed, err := authority.commands.Submit(
		ctx,
		membershipSubmitRequest(
			t,
			authority,
			groupID,
			owner,
			removePlan,
			"follower-rejoin-remove",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := follower.commands.ApplyFollowerEvent(ctx, removed.Event); err != nil {
		t.Fatal(err)
	}
	var retiredState persistence.ConversationFollowerStateModel
	if err := follower.db.First(
		&retiredState,
		"conversation_id = ?",
		string(groupID),
	).Error; err != nil {
		t.Fatal(err)
	}
	if retiredState.Status != string(repository.FollowerStatusRetired) {
		t.Fatalf("removed follower status = %q", retiredState.Status)
	}

	messagePreparation, err := authority.commands.PrepareCommand(
		ctx,
		dddPrepareCommandRequest(t, authority, groupID, owner),
	)
	if err != nil {
		t.Fatal(err)
	}
	messageBytes := dddSendCommandBytes(
		t,
		groupID,
		"follower-rejoin-absent-message",
		owner,
		messagePreparation,
		authority.clock.Now(),
	)
	absentMessage, err := authority.commands.Submit(
		ctx,
		command.SubmitRequest{
			Command: aggregate.Command{
				ID:                      "follower-rejoin-absent-message",
				ConversationID:          groupID,
				AuthorityStation:        "station-a",
				Sender:                  owner,
				ObservedMembershipEpoch: messagePreparation.Head.MembershipEpoch,
				ObservedMLSEpoch:        messagePreparation.Head.MLSEpoch,
				DeliveryPlanHash:        messagePreparation.DeliveryPlanHash,
				Kind:                    domainevent.KindMessageCommitted,
				MessageID:               "message-follower-rejoin-absent",
				Payload:                 messageBytes,
				Deliveries: []valueobject.PreparedDelivery{
					dddDelivery(
						t,
						owner,
						"station-a",
						valueobject.DeliveryKindPublicEvent,
						"owner-absent-marker",
					),
				},
				CommittedAt: authority.clock.Now(),
			},
			VerifiedRoutes:    dddActiveRoutes(t, authority.db, owner.Actor),
			ExactCommandBytes: messageBytes,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := follower.commands.ApplyFollowerEvent(
		ctx,
		absentMessage.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("post-removal ordinary follower event error = %v", err)
	}

	addPlan, err := authority.commands.PrepareMembership(
		ctx,
		dddPrepareMembershipRequest(
			t,
			authority,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action:      entity.MembershipActionAddActor,
				Actor:       member.Actor,
				Device:      member.Device,
				HomeStation: "station-b",
				Role:        valueobject.MemberRoleMember,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	rejoined, err := authority.commands.Submit(
		ctx,
		membershipSubmitRequest(
			t,
			authority,
			groupID,
			owner,
			addPlan,
			"follower-rejoin-add",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	forgedInput := rejoined.Event.Input()
	forgedInput.Fact.MembershipChanges[0].HomeStation = "station-c"
	forged, err := (conversationhttp.ProtobufEventSealer{}).Seal(forgedInput)
	if err != nil {
		t.Fatal(err)
	}
	if err := follower.commands.ApplyFollowerEvent(
		ctx,
		forged,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("forged rejoin checkpoint error = %v", err)
	}
	if err := follower.commands.ApplyFollowerEvent(ctx, rejoined.Event); err != nil {
		t.Fatalf("valid rejoin checkpoint error = %v", err)
	}

	head, err := follower.queries.PublicHead(ctx, groupID, member.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if head.Head.Sequence != rejoined.Event.Sequence ||
		head.Head.EventHash != rejoined.Event.Hash ||
		head.FollowerStatus != repository.FollowerStatusActive {
		t.Fatalf("rejoined follower head = %+v", head)
	}
	events, err := follower.queries.Events(ctx, groupID, member.Actor, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 ||
		events[0].ID != created.Event.ID ||
		events[1].ID != removed.Event.ID ||
		events[2].ID != rejoined.Event.ID {
		t.Fatalf("rejoined follower events = %+v", events)
	}
	assertCount(t, follower.db, &persistence.ConversationFollowerPendingEventModel{}, 0)
}

func TestConversationDDDFollowerRejectsAuthorityReplacement(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-authority-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-authority-bob", "bob-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-authority-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-authority-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-authority-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(context.Background(), genesis.Event); err != nil {
		t.Fatal(err)
	}
	next := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-authority-message",
		dddTestTime.Add(time.Minute),
	)
	rogueInput := next.Event.Input()
	rogueInput.AuthorityStation = "station-d"
	rogue, err := (conversationhttp.ProtobufEventSealer{}).Seal(rogueInput)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		rogue,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("authority replacement error = %v", err)
	}
	var follower persistence.ConversationFollowerHeadModel
	if err := fixture.db.First(
		&follower,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	if follower.AuthorityStationPeerID != "station-c" || follower.Sequence != 1 {
		t.Fatalf("follower authority changed: %+v", follower)
	}
	var state persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&state,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	if state.Status != string(repository.FollowerStatusReadOnly) {
		t.Fatalf("authority replacement follower status = %q", state.Status)
	}
}

func TestConversationDDDFollowerMembershipPreservesSettings(t *testing.T) {
	authorityFixture := newDDDComposition(t)
	followerFixture := newDDDComposition(t)
	owner := dddEndpoint("ptid:follower-settings-owner", "owner-1")
	member := dddEndpoint("ptid:follower-settings-member", "member-1")
	groupID := valueobject.ConversationID("follower-settings-group")
	created := createDDDGroup(t, authorityFixture, groupID, owner, member)
	if err := followerFixture.commands.ApplyFollowerEvent(
		context.Background(),
		created.Event,
	); err != nil {
		t.Fatal(err)
	}

	preparation, err := authorityFixture.commands.PrepareCommand(
		context.Background(),
		dddPrepareCommandRequest(t, authorityFixture, groupID, owner),
	)
	if err != nil {
		t.Fatal(err)
	}
	name := "Updated Group"
	description := "Preserved description"
	avatar := "object-avatar"
	visibility := valueobject.ConversationVisibilityPublic
	timer := uint32(3600)
	wireVisibility := chat.GroupVisibilityV1_GROUP_VISIBILITY_V1_PUBLIC
	wireCommand := &chat.ChatCommand{
		CommandId:               "follower-settings-update",
		ConversationId:          string(groupID),
		Sender:                  dddEndpointProto(owner),
		ObservedMembershipEpoch: int64(preparation.Head.MembershipEpoch),
		ObservedMlsEpoch:        int64(preparation.Head.MLSEpoch),
		DeliveryPlanSha256:      preparation.DeliveryPlanHash.Bytes(),
		AuthorityStationPeerId:  "station-a",
		ClientTimestamp:         timestamppb.New(authorityFixture.clock.Now()),
		Payload: &chat.ChatCommand_UpdateConversation{
			UpdateConversation: &chat.UpdateConversationIntent{
				Name:                  &name,
				Description:           &description,
				AvatarObjectId:        &avatar,
				DisappearTimerSeconds: &timer,
				Visibility:            &wireVisibility,
			},
		},
	}
	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(wireCommand)
	if err != nil {
		t.Fatal(err)
	}
	deliveries := make([]valueobject.PreparedDelivery, 0, len(preparation.RequiredEndpoints))
	for _, endpoint := range preparation.RequiredEndpoints {
		deliveries = append(deliveries, dddDelivery(
			t,
			endpoint,
			"station-a",
			valueobject.DeliveryKindPublicEvent,
			"settings-"+endpoint.Key(),
		))
	}
	settingsResult, err := authorityFixture.commands.Submit(
		context.Background(),
		command.SubmitRequest{
			Command: aggregate.Command{
				ID:                      "follower-settings-update",
				ConversationID:          groupID,
				AuthorityStation:        "station-a",
				Sender:                  owner,
				ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
				ObservedMLSEpoch:        preparation.Head.MLSEpoch,
				DeliveryPlanHash:        preparation.DeliveryPlanHash,
				Kind:                    domainevent.KindConversationSettings,
				Payload:                 commandBytes,
				Deliveries:              deliveries,
				RequiredEndpoints:       preparation.RequiredEndpoints,
				CommittedAt:             authorityFixture.clock.Now(),
			},
			Settings: &valueobject.SettingsPatch{
				Name:                  &name,
				Description:           &description,
				AvatarObjectID:        &avatar,
				Visibility:            &visibility,
				DisappearTimerSeconds: &timer,
			},
			VerifiedRoutes:    dddActiveRoutes(t, authorityFixture.db, owner.Actor, member.Actor),
			ExactCommandBytes: commandBytes,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := followerFixture.commands.ApplyFollowerEvent(
		context.Background(),
		settingsResult.Event,
	); err != nil {
		t.Fatal(err)
	}

	plan, err := authorityFixture.commands.PrepareMembership(
		context.Background(),
		dddPrepareMembershipRequest(
			t,
			authorityFixture,
			groupID,
			owner,
			[]entity.MembershipChange{{
				Action: entity.MembershipActionChangeRole,
				Actor:  member.Actor,
				Role:   valueobject.MemberRoleAdmin,
			}},
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	membershipResult, err := authorityFixture.commands.Submit(
		context.Background(),
		membershipSubmitRequest(
			t,
			authorityFixture,
			groupID,
			owner,
			plan,
			"follower-settings-membership",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := followerFixture.commands.ApplyFollowerEvent(
		context.Background(),
		membershipResult.Event,
	); err != nil {
		t.Fatal(err)
	}
	view, err := followerFixture.queries.Get(context.Background(), groupID, member.Actor)
	if err != nil {
		t.Fatal(err)
	}
	want := valueobject.ConversationSettings{
		Name:                  name,
		Description:           description,
		AvatarObjectID:        avatar,
		Visibility:            visibility,
		DisappearTimerSeconds: timer,
	}
	if view.Conversation.Settings != want {
		t.Fatalf("follower settings = %+v, want %+v", view.Conversation.Settings, want)
	}
}

func TestConversationDDDFollowerHistoricalReplayAndForkProtection(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-history-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-history-bob", "bob-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-history-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-history-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-history-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	forkAuthority, err := aggregate.Rehydrate(authority.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	second := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-history-second",
		dddTestTime.Add(time.Minute),
	)
	forkedSecond := commitFollowerMessage(
		t,
		forkAuthority,
		alice,
		"follower-history-fork",
		dddTestTime.Add(time.Minute),
	)
	third := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-history-third",
		dddTestTime.Add(2*time.Minute),
	)

	for _, event := range []domainevent.Record{genesis.Event, second.Event, third.Event} {
		if err := fixture.commands.ApplyFollowerEvent(context.Background(), event); err != nil {
			t.Fatal(err)
		}
	}
	if err := fixture.commands.ApplyFollowerEvent(context.Background(), second.Event); err != nil {
		t.Fatalf("historical exact replay error = %v", err)
	}
	head, err := fixture.queries.PublicHead(context.Background(), authority.ID(), bob.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if head.Head.Sequence != third.Event.Sequence ||
		head.Head.EventHash != third.Event.Hash ||
		head.FollowerStatus != repository.FollowerStatusActive {
		t.Fatalf("head changed after historical replay: %+v", head)
	}

	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		forkedSecond.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("historical fork error = %v", err)
	}
	var state persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&state,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	if state.Status != string(repository.FollowerStatusReadOnly) {
		t.Fatalf("historical fork status = %q", state.Status)
	}
}

func TestConversationDDDRejectedFollowerEventDoesNotPoisonHistory(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-reject-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-reject-bob", "bob-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-reject-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-reject-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-reject-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(context.Background(), genesis.Event); err != nil {
		t.Fatal(err)
	}
	next := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-reject-next",
		dddTestTime.Add(time.Minute),
	)
	invalidInput := next.Event.Input()
	invalidInput.PreviousHash = valueobject.HashBytes([]byte("wrong-previous-hash"))
	invalid, err := (conversationhttp.ProtobufEventSealer{}).Seal(invalidInput)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		invalid,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("previous-hash mismatch error = %v", err)
	}
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 1)
	var rejectedCount int64
	if err := fixture.db.Model(&persistence.ConversationEventModel{}).
		Where("event_id = ?", string(invalid.ID)).
		Count(&rejectedCount).Error; err != nil {
		t.Fatal(err)
	}
	if rejectedCount != 0 {
		t.Fatal("rejected follower event was persisted in canonical history")
	}
}

func TestConversationDDDFollowerRejectsInvalidEpochProgression(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-epoch-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-epoch-bob", "bob-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-epoch-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-epoch-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-epoch-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(context.Background(), genesis.Event); err != nil {
		t.Fatal(err)
	}
	next := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-epoch-next",
		dddTestTime.Add(time.Minute),
	)
	invalidInput := next.Event.Input()
	invalidInput.MembershipEpoch = genesis.Event.MembershipEpoch.Next()
	invalidInput.MLSEpoch = genesis.Event.MLSEpoch.Next()
	invalid, err := (conversationhttp.ProtobufEventSealer{}).Seal(invalidInput)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		invalid,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("ordinary epoch jump error = %v", err)
	}
	var state persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&state,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	if state.Status != string(repository.FollowerStatusReadOnly) {
		t.Fatalf("follower status = %q, want read_only", state.Status)
	}
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 1)
}

func TestConversationDDDFollowerRejectsPostStateEpochMismatch(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-state-epoch-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-state-epoch-bob", "bob-1")
	_, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-state-epoch-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-state-epoch-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-state-epoch-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	invalidInput := genesis.Event.Input()
	postState := *invalidInput.Fact.PostState
	postState.MembershipEpoch = postState.MembershipEpoch.Next()
	invalidInput.Fact.PostState = &postState
	invalid, err := (conversationhttp.ProtobufEventSealer{}).Seal(invalidInput)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		invalid,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("post-state epoch mismatch error = %v", err)
	}
	var state persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&state,
		"conversation_id = ?",
		string(invalid.ConversationID),
	).Error; err != nil {
		t.Fatal(err)
	}
	if state.Status != string(repository.FollowerStatusReadOnly) {
		t.Fatalf("follower status = %q, want read_only", state.Status)
	}
	assertCount(t, fixture.db, &persistence.ConversationFollowerHeadModel{}, 0)
	assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 0)

	factMismatchInput := genesis.Event.Input()
	createdFact := *factMismatchInput.Fact.Created
	createdFact.Members = createdFact.Members[:1]
	factMismatchInput.Fact.Created = &createdFact
	factMismatch, err := (conversationhttp.ProtobufEventSealer{}).Seal(factMismatchInput)
	if err != nil {
		t.Fatal(err)
	}
	factFixture := newDDDComposition(t)
	if err := factFixture.commands.ApplyFollowerEvent(
		context.Background(),
		factMismatch,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("creation fact mismatch error = %v", err)
	}
	assertCount(t, factFixture.db, &persistence.ConversationFollowerHeadModel{}, 0)
	assertCount(t, factFixture.db, &persistence.ConversationEventModel{}, 0)
}

func TestConversationDDDFollowerRejectsEventStateShapeMismatch(t *testing.T) {
	alice := dddEndpoint("ptid:follower-shape-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-shape-bob", "bob-1")
	charlie := dddEndpoint("ptid:follower-shape-charlie", "charlie-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-shape-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-shape-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-shape-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	next := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-shape-next",
		dddTestTime.Add(time.Minute),
	)
	ordinaryWithStateInput := next.Event.Input()
	postState := *genesis.Event.Fact.PostState
	ordinaryWithStateInput.Fact.PostState = &postState
	ordinaryWithState, err := (conversationhttp.ProtobufEventSealer{}).Seal(
		ordinaryWithStateInput,
	)
	if err != nil {
		t.Fatal(err)
	}
	membershipWithoutStateInput := next.Event.Input()
	plan := entity.AuthorityPlan{
		ID:   "follower-shape-plan",
		Hash: valueobject.HashBytes([]byte("follower-shape-plan")),
		AuthorityHead: valueobject.AuthorityHead{
			Sequence:        genesis.Event.Sequence,
			EventHash:       genesis.Event.Hash,
			MembershipEpoch: genesis.Event.MembershipEpoch,
			MLSEpoch:        genesis.Event.MLSEpoch,
		},
	}
	membershipWithoutStateInput.Fact = domainevent.NewMembershipTransitionFact(
		nil,
		dddMembershipCommandBytes(
			t,
			authority.ID(),
			next.Event.CommandID,
			alice,
			plan,
			"follower-shape-transition",
			"",
			next.Event.CommittedAt,
		),
	)
	membershipWithoutStateInput.MembershipEpoch = genesis.Event.MembershipEpoch.Next()
	membershipWithoutStateInput.MLSEpoch = genesis.Event.MLSEpoch.Next()
	membershipWithoutState, err := (conversationhttp.ProtobufEventSealer{}).Seal(
		membershipWithoutStateInput,
	)
	if err != nil {
		t.Fatal(err)
	}
	membershipChanges := []entity.MembershipChange{{
		Action:      entity.MembershipActionAddActor,
		Actor:       charlie.Actor,
		Device:      charlie.Device,
		HomeStation: "station-c",
		Role:        valueobject.MemberRoleMember,
	}}
	membershipMismatchInput := next.Event.Input()
	membershipMismatchState := *genesis.Event.Fact.PostState
	membershipMismatchState.MembershipEpoch = genesis.Event.MembershipEpoch.Next()
	membershipMismatchState.MLSEpoch = genesis.Event.MLSEpoch.Next()
	membershipMismatchPlan := plan
	membershipMismatchPlan.ID = "follower-shape-mismatch-plan"
	membershipMismatchPlan.Hash = valueobject.HashBytes(
		[]byte("follower-shape-mismatch-plan"),
	)
	membershipMismatchPlan.Changes = membershipChanges
	membershipMismatchInput.Fact = domainevent.NewMembershipTransitionFact(
		membershipChanges,
		dddMembershipCommandBytes(
			t,
			authority.ID(),
			next.Event.CommandID,
			alice,
			membershipMismatchPlan,
			"follower-shape-mismatch-transition",
			"",
			next.Event.CommittedAt,
		),
	)
	membershipMismatchInput.Fact.PostState = &membershipMismatchState
	membershipMismatchInput.MembershipEpoch = membershipMismatchState.MembershipEpoch
	membershipMismatchInput.MLSEpoch = membershipMismatchState.MLSEpoch
	membershipMismatch, err := (conversationhttp.ProtobufEventSealer{}).Seal(
		membershipMismatchInput,
	)
	if err != nil {
		t.Fatal(err)
	}
	contradictoryChanges := []entity.MembershipChange{
		{
			Action:      entity.MembershipActionAddActor,
			Actor:       charlie.Actor,
			Device:      charlie.Device,
			HomeStation: "station-c",
			Role:        valueobject.MemberRoleMember,
		},
		{
			Action: entity.MembershipActionRemoveActor,
			Actor:  charlie.Actor,
		},
	}
	contradictoryInput := next.Event.Input()
	contradictoryState := *genesis.Event.Fact.PostState
	contradictoryState.MembershipEpoch = genesis.Event.MembershipEpoch.Next()
	contradictoryState.MLSEpoch = genesis.Event.MLSEpoch.Next()
	contradictoryPlan := plan
	contradictoryPlan.ID = "follower-shape-contradictory-plan"
	contradictoryPlan.Hash = valueobject.HashBytes(
		[]byte("follower-shape-contradictory-plan"),
	)
	contradictoryPlan.Changes = contradictoryChanges
	contradictoryInput.Fact = domainevent.NewMembershipTransitionFact(
		contradictoryChanges,
		dddMembershipCommandBytes(
			t,
			authority.ID(),
			next.Event.CommandID,
			alice,
			contradictoryPlan,
			"follower-shape-contradictory-transition",
			"",
			next.Event.CommittedAt,
		),
	)
	contradictoryInput.Fact.PostState = &contradictoryState
	contradictoryInput.MembershipEpoch = contradictoryState.MembershipEpoch
	contradictoryInput.MLSEpoch = contradictoryState.MLSEpoch
	contradictory, err := (conversationhttp.ProtobufEventSealer{}).Seal(
		contradictoryInput,
	)
	if err != nil {
		t.Fatal(err)
	}

	for _, candidate := range []struct {
		name  string
		event domainevent.Record
	}{
		{name: "ordinary event with post-state", event: ordinaryWithState},
		{name: "membership event without post-state", event: membershipWithoutState},
		{name: "membership fact differs from post-state", event: membershipMismatch},
		{name: "membership fact contains contradictory changes", event: contradictory},
	} {
		t.Run(candidate.name, func(t *testing.T) {
			fixture := newDDDComposition(t)
			if err := fixture.commands.ApplyFollowerEvent(
				context.Background(),
				genesis.Event,
			); err != nil {
				t.Fatal(err)
			}
			if err := fixture.commands.ApplyFollowerEvent(
				context.Background(),
				candidate.event,
			); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
				t.Fatalf("event state shape mismatch error = %v", err)
			}
			var state persistence.ConversationFollowerStateModel
			if err := fixture.db.First(
				&state,
				"conversation_id = ?",
				string(authority.ID()),
			).Error; err != nil {
				t.Fatal(err)
			}
			if state.Status != string(repository.FollowerStatusReadOnly) {
				t.Fatalf("follower status = %q, want read_only", state.Status)
			}
			assertCount(t, fixture.db, &persistence.ConversationEventModel{}, 1)
		})
	}
}

func TestConversationDDDFollowerRejectsPersistedHeadDrift(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-head-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-head-bob", "bob-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-head-group",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-head-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-head-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(context.Background(), genesis.Event); err != nil {
		t.Fatal(err)
	}
	var model persistence.ConversationFollowerHeadModel
	if err := fixture.db.First(
		&model,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	var snapshot aggregate.Snapshot
	if err := json.Unmarshal(model.SnapshotBytes, &snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Head.Sequence = snapshot.Head.Sequence.Next()
	model.SnapshotBytes, err = json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Save(&model).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := fixture.queries.Get(
		context.Background(),
		authority.ID(),
		bob.Actor,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("persisted follower head drift error = %v", err)
	}
}

func TestConversationDDDConcurrentFollowerGenesisDetectsConflict(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-race-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-race-bob", "bob-1")
	devices := []entity.MemberDevice{
		dddMemberDevice(t, alice, "station-c"),
		dddMemberDevice(t, bob, "station-c"),
	}
	deliveries := []valueobject.PreparedDelivery{
		dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
		dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
	}
	createEvent := func(commandID string, name string) domainevent.Record {
		t.Helper()
		_, transition, err := aggregate.CreateGroup(aggregate.CreateInput{
			ID:               "follower-race-group",
			FederationID:     dddFederationID,
			AuthorityStation: "station-c",
			AuthorityEpoch:   dddAuthorityEpoch,
			Owner:            alice.Actor,
			Participants: []aggregate.Participant{
				{Actor: alice.Actor, HomeStation: "station-c"},
				{Actor: bob.Actor, HomeStation: "station-c"},
			},
			Devices:      devices,
			Settings:     valueobject.ConversationSettings{Name: name},
			CommandID:    valueobject.CommandID(commandID),
			Creator:      alice,
			Deliveries:   deliveries,
			EventPayload: []byte(commandID),
			CreatedAt:    dddTestTime,
			EventSealer:  conversationhttp.ProtobufEventSealer{},
		})
		if err != nil {
			t.Fatal(err)
		}
		return transition.Event
	}
	events := []domainevent.Record{
		createEvent("follower-race-a", "Race A"),
		createEvent("follower-race-b", "Race B"),
	}
	start := make(chan struct{})
	results := make(chan error, len(events))
	for _, event := range events {
		event := event
		go func() {
			<-start
			results <- fixture.commands.ApplyFollowerEvent(context.Background(), event)
		}()
	}
	close(start)

	var accepted int
	var rejected int
	for range events {
		err := <-results
		switch {
		case err == nil:
			accepted++
		case conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid):
			rejected++
		default:
			t.Fatalf("concurrent follower genesis error = %v", err)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("concurrent follower outcomes: accepted=%d rejected=%d", accepted, rejected)
	}
	var followerState persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&followerState,
		"conversation_id = ?",
		"follower-race-group",
	).Error; err != nil {
		t.Fatal(err)
	}
	if followerState.Status != string(repository.FollowerStatusReadOnly) {
		t.Fatalf("conflicting follower genesis status = %q", followerState.Status)
	}
}

func TestConversationDDDPreGenesisFollowerForkRemainsReadOnly(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-fork-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-fork-bob", "bob-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-pre-genesis-fork",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-fork-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-fork-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	fork, err := aggregate.Rehydrate(authority.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	first := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-fork-a",
		dddTestTime.Add(time.Minute),
	)
	second := commitFollowerMessage(
		t,
		fork,
		alice,
		"follower-fork-b",
		dddTestTime.Add(time.Minute),
	)

	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		first.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("initial buffered follower event error = %v", err)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		second.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("conflicting buffered follower event error = %v", err)
	}
	var state persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&state,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	if state.Status != string(repository.FollowerStatusReadOnly) {
		t.Fatalf("pre-genesis fork status = %q", state.Status)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		genesis.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
		t.Fatalf("genesis after buffered fork error = %v", err)
	}
	var follower persistence.ConversationFollowerHeadModel
	if err := fixture.db.First(
		&follower,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("follower head after buffered fork error = %v", err)
	}
}

func TestConversationDDDFullFollowerBufferAcceptsExactReplay(t *testing.T) {
	fixture := newDDDComposition(t)
	alice := dddEndpoint("ptid:follower-buffer-alice", "alice-1")
	bob := dddEndpoint("ptid:follower-buffer-bob", "bob-1")
	authority, genesis, err := aggregate.CreateGroup(aggregate.CreateInput{
		ID:               "follower-full-buffer",
		FederationID:     dddFederationID,
		AuthorityStation: "station-c",
		AuthorityEpoch:   dddAuthorityEpoch,
		Owner:            alice.Actor,
		Participants: []aggregate.Participant{
			{Actor: alice.Actor, HomeStation: "station-c"},
			{Actor: bob.Actor, HomeStation: "station-c"},
		},
		Devices: []entity.MemberDevice{
			dddMemberDevice(t, alice, "station-c"),
			dddMemberDevice(t, bob, "station-c"),
		},
		CommandID: "follower-buffer-create",
		Creator:   alice,
		Deliveries: []valueobject.PreparedDelivery{
			dddDelivery(t, alice, "station-c", valueobject.DeliveryKindPublicEvent, "alice-state"),
			dddDelivery(t, bob, "station-c", valueobject.DeliveryKindMLSWelcome, "bob-state"),
		},
		EventPayload: []byte("follower-buffer-create"),
		CreatedAt:    dddTestTime,
		EventSealer:  conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(context.Background(), genesis.Event); err != nil {
		t.Fatal(err)
	}
	_ = commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-buffer-second",
		dddTestTime.Add(time.Minute),
	)
	third := commitFollowerMessage(
		t,
		authority,
		alice,
		"follower-buffer-third",
		dddTestTime.Add(2*time.Minute),
	)
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		third.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("initial buffered follower event error = %v", err)
	}
	dummy := make([]persistence.ConversationFollowerPendingEventModel, 0, 127)
	for sequence := uint64(4); sequence <= 130; sequence++ {
		dummy = append(dummy, persistence.ConversationFollowerPendingEventModel{
			ConversationID: string(authority.ID()),
			Sequence:       sequence,
			EventID:        fmt.Sprintf("follower-buffer-dummy-%d", sequence),
			EventHash:      []byte{byte(sequence)},
			HashScheme:     string(domainevent.HashSchemeTransport),
			EventBytes:     []byte{byte(sequence)},
			DomainSnapshot: []byte{byte(sequence)},
			ReceivedAt:     dddTestTime,
		})
	}
	if err := fixture.db.Create(&dummy).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.commands.ApplyFollowerEvent(
		context.Background(),
		third.Event,
	); !conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
		t.Fatalf("exact replay against full follower buffer error = %v", err)
	}
	var state persistence.ConversationFollowerStateModel
	if err := fixture.db.First(
		&state,
		"conversation_id = ?",
		string(authority.ID()),
	).Error; err != nil {
		t.Fatal(err)
	}
	if state.Status != string(repository.FollowerStatusResyncRequired) {
		t.Fatalf("exact replay changed follower status to %q", state.Status)
	}
}

func commitFollowerMessage(
	t *testing.T,
	conversation *aggregate.Conversation,
	sender valueobject.Endpoint,
	commandID valueobject.CommandID,
	at time.Time,
) aggregate.Transition {
	t.Helper()
	preparation, err := conversation.PrepareCommand(sender, conversation.ActiveEndpoints())
	if err != nil {
		t.Fatal(err)
	}
	payload := dddSendCommandBytes(
		t,
		conversation.ID(),
		commandID,
		sender,
		preparation,
		at,
	)
	deliveries := make([]valueobject.PreparedDelivery, 0, len(preparation.RequiredEndpoints))
	for _, endpoint := range preparation.RequiredEndpoints {
		kind := valueobject.DeliveryKindMLSApplication
		if endpoint == sender {
			kind = valueobject.DeliveryKindPublicEvent
		}
		deliveries = append(deliveries, dddDelivery(
			t,
			endpoint,
			"station-c",
			kind,
			"follower-"+endpoint.Key(),
		))
	}
	transition, err := conversation.ApplyCommand(aggregate.Command{
		ID:                      commandID,
		ConversationID:          conversation.ID(),
		AuthorityStation:        "station-c",
		Sender:                  sender,
		ObservedMembershipEpoch: preparation.Head.MembershipEpoch,
		ObservedMLSEpoch:        preparation.Head.MLSEpoch,
		DeliveryPlanHash:        preparation.DeliveryPlanHash,
		Kind:                    domainevent.KindMessageCommitted,
		MessageID:               valueobject.MessageID("message-" + string(commandID)),
		Payload:                 payload,
		Deliveries:              deliveries,
		RequiredEndpoints:       preparation.RequiredEndpoints,
		CommittedAt:             at,
		EventSealer:             conversationhttp.ProtobufEventSealer{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return transition
}

func dddEndpoint(actor string, device string) valueobject.Endpoint {
	return valueobject.Endpoint{
		Actor:  valueobject.PTID(actor),
		Device: valueobject.DeviceID(device),
	}
}

func dddDevice(
	endpoint valueobject.Endpoint,
	station string,
) dddActorDeviceModel {
	return dddActorDeviceModel{
		PTID:        string(endpoint.Actor),
		DeviceID:    string(endpoint.Device),
		HomeStation: station,
		Active:      true,
	}
}

func dddDirectRoutes(
	first valueobject.Endpoint,
	firstStation string,
	second valueobject.Endpoint,
	secondStation string,
) []ports.EndpointRoute {
	return []ports.EndpointRoute{
		{
			Endpoint:    first,
			HomeStation: valueobject.StationID(firstStation),
		},
		{
			Endpoint:    second,
			HomeStation: valueobject.StationID(secondStation),
		},
	}
}

func dddActiveRoutes(
	t *testing.T,
	db *gorm.DB,
	actors ...valueobject.PTID,
) []ports.EndpointRoute {
	t.Helper()
	routes, err := (dddIdentityDirectory{db: db}).ListActiveEndpoints(
		context.Background(),
		actors,
	)
	if err != nil {
		t.Fatal(err)
	}
	return routes
}

func dddPrepareCommandRequest(
	t *testing.T,
	fixture dddFixture,
	conversationID valueobject.ConversationID,
	sender valueobject.Endpoint,
) command.PrepareCommandRequest {
	t.Helper()
	actors, err := fixture.commands.CommandRouteActors(
		context.Background(),
		conversationID,
		sender.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	routes := dddActiveRoutes(t, fixture.db, actors...)
	var senderHomeStation valueobject.StationID
	for _, route := range routes {
		if route.Endpoint == sender {
			senderHomeStation = route.HomeStation
			break
		}
	}
	if senderHomeStation == "" {
		t.Fatalf("sender %s is absent from command routes", sender.Key())
	}
	return command.PrepareCommandRequest{
		ConversationID:    conversationID,
		Sender:            sender,
		SenderHomeStation: senderHomeStation,
		VerifiedRoutes:    routes,
	}
}

func dddPrepareMembershipRequest(
	t *testing.T,
	fixture dddFixture,
	conversationID valueobject.ConversationID,
	requester valueobject.Endpoint,
	changes []entity.MembershipChange,
) command.PrepareMembershipRequest {
	t.Helper()
	actors, err := fixture.commands.CommandRouteActors(
		context.Background(),
		conversationID,
		requester.Actor,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range changes {
		actors = append(actors, change.Actor)
	}
	return command.PrepareMembershipRequest{
		ConversationID:    conversationID,
		Requester:         requester,
		Changes:           changes,
		VerifiedRoutes:    dddActiveRoutes(t, fixture.db, actors...),
		ManifestSetHash:   dddManifestSetHash,
		ManifestStateHash: dddManifestSetHash,
	}
}

func dddMemberDevice(
	t *testing.T,
	endpoint valueobject.Endpoint,
	station valueobject.StationID,
) entity.MemberDevice {
	t.Helper()
	device, err := entity.NewMemberDevice(endpoint, station, 1)
	if err != nil {
		t.Fatal(err)
	}
	return device
}

func dddLeaveIntentRequest(
	t *testing.T,
	intentID string,
	federationID valueobject.FederationID,
	conversationID valueobject.ConversationID,
	actor valueobject.Endpoint,
	station valueobject.StationID,
	head valueobject.AuthorityHead,
	createdAt time.Time,
) command.LeaveIntentRequest {
	t.Helper()
	request := command.LeaveIntentRequest{
		Version:          1,
		ID:               intentID,
		FederationID:     federationID,
		ConversationID:   conversationID,
		Actor:            actor,
		SigningKeyID:     "signing-key:" + actor.Key(),
		HomeStation:      station,
		AuthorityStation: station,
		AuthorityEpoch:   dddAuthorityEpoch,
		AuthorityHead:    head,
		CreatedAt:        createdAt.UTC(),
		ExpiresAt:        createdAt.UTC().Add(time.Minute),
	}
	signDDDLeaveIntentRequest(t, &request)
	return request
}

func dddForwardedCommandRequest(
	t *testing.T,
	submit command.SubmitRequest,
	federationID valueobject.FederationID,
	authorityEpoch valueobject.AuthorityEpoch,
	homeStation valueobject.StationID,
) command.ForwardedCommandRequest {
	t.Helper()
	commandHash := valueobject.HashBytes(submit.ExactCommandBytes)
	createdAt := submit.Command.CommittedAt.UTC()
	request := command.ForwardedCommandRequest{
		Version:          1,
		FederationID:     federationID,
		AuthorityStation: submit.Command.AuthorityStation,
		AuthorityEpoch:   authorityEpoch,
		HomeStation:      homeStation,
		Actor:            submit.Command.Sender,
		SigningKeyID:     "test-signing-key",
		CommandHash:      commandHash,
		CreatedAt:        createdAt,
		ExpiresAt:        createdAt.Add(5 * time.Minute),
		Command:          submit,
	}
	request.Claims = command.ForwardedCommandClaims{
		Scope:          "conversation-command-proposal",
		Issuer:         request.HomeStation,
		Audience:       request.AuthorityStation,
		Subject:        request.Actor.Actor,
		FederationID:   request.FederationID,
		ConversationID: submit.Command.ConversationID,
		CommandID:      submit.Command.ID,
		CommandKind:    submit.Command.Kind,
		DeviceID:       request.Actor.Device,
		SigningKeyID:   request.SigningKeyID,
		CommandHash:    request.CommandHash,
		AuthorityEpoch: request.AuthorityEpoch,
		ExpiresAt:      request.ExpiresAt,
	}
	signDDDForwardedCommandRequest(t, &request)
	return request
}

func signDDDForwardedCommandRequest(
	t *testing.T,
	request *command.ForwardedCommandRequest,
) {
	t.Helper()
	signingBytes, err := (conversationhttp.ProtobufCommandProposalSigningEncoder{}).
		EncodeCommandProposalSigningInput(ports.CommandProposalSigningInput{
			Version:             request.Version,
			FederationID:        request.FederationID,
			AuthorityStation:    request.AuthorityStation,
			AuthorityEpoch:      request.AuthorityEpoch,
			HomeStation:         request.HomeStation,
			ConversationID:      request.Command.Command.ConversationID,
			CommandID:           request.Command.Command.ID,
			CommandKind:         request.Command.Command.Kind,
			Actor:               request.Actor,
			SigningKeyID:        request.SigningKeyID,
			CommandHash:         request.CommandHash,
			CreatedAtUnixMillis: request.CreatedAt.UnixMilli(),
			ExpiresAtUnixMillis: request.ExpiresAt.UnixMilli(),
		})
	if err != nil {
		t.Fatal(err)
	}
	request.Signature = valueobject.HashBytes(signingBytes).Bytes()
}

func signDDDLeaveIntentRequest(t *testing.T, request *command.LeaveIntentRequest) {
	t.Helper()
	signingBytes, err := (conversationhttp.ProtobufLeaveIntentSigningEncoder{}).
		EncodeLeaveIntentSigningInput(ports.LeaveIntentSigningInput{
			Version:             request.Version,
			IntentID:            request.ID,
			FederationID:        request.FederationID,
			AuthorityStation:    request.AuthorityStation,
			AuthorityEpoch:      request.AuthorityEpoch,
			HomeStation:         request.HomeStation,
			ConversationID:      request.ConversationID,
			Actor:               request.Actor,
			SigningKeyID:        request.SigningKeyID,
			AuthorityHead:       request.AuthorityHead,
			CreatedAtUnixMillis: request.CreatedAt.UnixMilli(),
			ExpiresAtUnixMillis: request.ExpiresAt.UnixMilli(),
		})
	if err != nil {
		t.Fatal(err)
	}
	request.Signature = valueobject.HashBytes(signingBytes).Bytes()
}

func seedDDDDevices(t *testing.T, db *gorm.DB, devices ...dddActorDeviceModel) {
	t.Helper()
	if err := db.Create(&devices).Error; err != nil {
		t.Fatal(err)
	}
}

func dddDelivery(
	t *testing.T,
	endpoint valueobject.Endpoint,
	station valueobject.StationID,
	kind valueobject.DeliveryKind,
	payload string,
) valueobject.PreparedDelivery {
	t.Helper()
	delivery, err := valueobject.NewPreparedDelivery(
		endpoint,
		station,
		kind,
		[]byte(payload),
	)
	if err != nil {
		t.Fatal(err)
	}
	return delivery
}

func dddPreparedPayload(
	t *testing.T,
	endpoint valueobject.Endpoint,
	payload string,
) *chat.PreparedEndpointPayload {
	t.Helper()
	bytes := []byte(payload)
	return &chat.PreparedEndpointPayload{
		Recipient:     dddEndpointProto(endpoint),
		Kind:          chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_CIPHERTEXT,
		OpaquePayload: bytes,
		PayloadSha256: valueobject.HashBytes(bytes).Bytes(),
	}
}

func otherEndpoint(
	sender valueobject.Endpoint,
	left valueobject.Endpoint,
	right valueobject.Endpoint,
) valueobject.Endpoint {
	if sender == left {
		return right
	}
	return left
}

func createDDDGroup(
	t *testing.T,
	fixture dddFixture,
	groupID valueobject.ConversationID,
	owner valueobject.Endpoint,
	member valueobject.Endpoint,
) command.Result {
	t.Helper()
	seedDDDDevices(t, fixture.db,
		dddDevice(owner, "station-a"),
		dddDevice(member, "station-a"),
	)
	plan, err := fixture.commands.PrepareGroup(
		context.Background(),
		command.PrepareGroupRequest{
			ConversationID:    groupID,
			FederationID:      dddFederationID,
			AuthorityEpoch:    dddAuthorityEpoch,
			Name:              "Test Group",
			Owner:             owner,
			Members:           []valueobject.PTID{member.Actor},
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			ManifestSetHash:   dddManifestSetHash,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err := fixture.commands.CreateGroup(
		context.Background(),
		command.CreateGroupRequest{
			ConversationID:    groupID,
			Owner:             owner,
			VerifiedRoutes:    dddActiveRoutes(t, fixture.db, owner.Actor, member.Actor),
			ManifestStateHash: dddManifestSetHash,
			CommandID:         "create-" + valueobject.CommandID(groupID),
			AuthorityPlanID:   plan.ID,
			AuthorityPlanHash: plan.Hash,
			Deliveries: []valueobject.PreparedDelivery{
				dddDelivery(t, owner, "station-a", valueobject.DeliveryKindPublicEvent, "owner-marker"),
				dddDelivery(t, member, "station-a", valueobject.DeliveryKindMLSWelcome, "member-welcome"),
			},
			ExactCommandBytes: []byte("create-" + string(groupID)),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func membershipSubmitRequest(
	t *testing.T,
	fixture dddFixture,
	groupID valueobject.ConversationID,
	owner valueobject.Endpoint,
	plan entity.AuthorityPlan,
	commandID valueobject.CommandID,
) command.SubmitRequest {
	t.Helper()
	actors := []valueobject.PTID{plan.Requester.Actor}
	for _, change := range plan.Changes {
		actors = append(actors, change.Actor)
	}
	for _, endpoint := range endpointUnionDDD(plan.PreEndpoints, plan.PostEndpoints) {
		actors = append(actors, endpoint.Actor)
	}
	return membershipSubmitRequestWithRoutes(
		t,
		fixture,
		groupID,
		owner,
		plan,
		commandID,
		dddActiveRoutes(t, fixture.db, actors...),
	)
}

func membershipSubmitRequestWithRoutes(
	t *testing.T,
	fixture dddFixture,
	groupID valueobject.ConversationID,
	owner valueobject.Endpoint,
	plan entity.AuthorityPlan,
	commandID valueobject.CommandID,
	routes []ports.EndpointRoute,
) command.SubmitRequest {
	t.Helper()
	required := endpointUnionDDD(plan.PreEndpoints, plan.PostEndpoints)
	deliveries := make([]valueobject.PreparedDelivery, 0, len(required))
	homeByEndpoint := make(map[string]valueobject.StationID, len(routes))
	homeByActor := make(map[valueobject.PTID]valueobject.StationID, len(routes))
	for _, route := range routes {
		homeByEndpoint[route.Endpoint.Key()] = route.HomeStation
		homeByActor[route.Endpoint.Actor] = route.HomeStation
	}
	for _, change := range plan.Changes {
		if change.HomeStation != "" {
			homeByActor[change.Actor] = change.HomeStation
		}
	}
	added := make(map[string]struct{}, len(plan.AddedEndpoints))
	for _, endpoint := range plan.AddedEndpoints {
		added[endpoint.Key()] = struct{}{}
	}
	removed := make(map[string]struct{}, len(plan.RemovedEndpoints))
	for _, endpoint := range plan.RemovedEndpoints {
		removed[endpoint.Key()] = struct{}{}
	}
	for _, endpoint := range required {
		kind := valueobject.DeliveryKindMLSCommit
		if _, exists := removed[endpoint.Key()]; exists {
			kind = valueobject.DeliveryKindMLSRetirement
		} else if endpoint == owner {
			kind = valueobject.DeliveryKindPublicEvent
		} else if _, exists := added[endpoint.Key()]; exists {
			kind = valueobject.DeliveryKindMLSWelcome
		}
		homeStation := homeByEndpoint[endpoint.Key()]
		if homeStation == "" {
			homeStation = homeByActor[endpoint.Actor]
		}
		if homeStation == "" {
			t.Fatalf("endpoint %s has no verified Home Station route", endpoint.Key())
		}
		deliveries = append(
			deliveries,
			dddDelivery(t, endpoint, homeStation, kind, "membership-"+endpoint.Key()),
		)
	}
	at := fixture.clock.Now()
	transitionID := "transition-" + string(commandID)
	payload := dddMembershipCommandBytes(
		t,
		groupID,
		commandID,
		owner,
		plan,
		transitionID,
		"",
		at,
	)
	return command.SubmitRequest{
		Command: aggregate.Command{
			ID:                      commandID,
			ConversationID:          groupID,
			AuthorityStation:        "station-a",
			Sender:                  owner,
			ObservedMembershipEpoch: plan.AuthorityHead.MembershipEpoch,
			ObservedMLSEpoch:        plan.AuthorityHead.MLSEpoch,
			DeliveryPlanHash:        plan.Hash,
			Kind:                    domainevent.KindMembershipCommitted,
			Payload:                 payload,
			Deliveries:              deliveries,
			CommittedAt:             at,
		},
		Membership: &aggregate.MembershipTransition{
			TransitionID:   valueobject.TransitionID(transitionID),
			FromMembership: plan.AuthorityHead.MembershipEpoch,
			FromMLS:        plan.AuthorityHead.MLSEpoch,
			ToMLS:          plan.AuthorityHead.MLSEpoch.Next(),
			Changes:        append([]entity.MembershipChange(nil), plan.Changes...),
		},
		VerifiedRoutes:    append([]ports.EndpointRoute(nil), routes...),
		ManifestStateHash: plan.EndpointManifestStateHash,
		AuthorityPlanID:   plan.ID,
		AuthorityPlanHash: plan.Hash,
		ExactCommandBytes: payload,
	}
}

func dddSendCommandBytes(
	t *testing.T,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
	sender valueobject.Endpoint,
	preparation aggregate.CommandPreparation,
	at time.Time,
) []byte {
	t.Helper()
	wire := &chat.ChatCommand{
		CommandId:               string(commandID),
		ConversationId:          string(conversationID),
		Sender:                  dddEndpointProto(sender),
		ObservedMembershipEpoch: int64(preparation.Head.MembershipEpoch),
		ObservedMlsEpoch:        int64(preparation.Head.MLSEpoch),
		ClientTimestamp:         timestamppb.New(at),
		DeliveryPlanSha256:      preparation.DeliveryPlanHash.Bytes(),
		AuthorityStationPeerId:  string(preparation.AuthorityStation),
		Payload: &chat.ChatCommand_SendMessage{
			SendMessage: &chat.SendMessageIntent{
				MessageId:   "message-" + string(commandID),
				ContentKind: chat.MessagingContentKind_MESSAGING_CONTENT_KIND_TEXT,
			},
		},
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func dddMemberAuthoritySubmitRequest(
	t *testing.T,
	fixture dddFixture,
	conversationID valueobject.ConversationID,
	operator valueobject.Endpoint,
	target valueobject.PTID,
	commandID valueobject.CommandID,
	action domainevent.MemberAuthorityAction,
	role *valueobject.MemberRole,
	muted *bool,
	mutedUntil *time.Time,
) command.SubmitRequest {
	t.Helper()

	prepareRequest := dddPrepareCommandRequest(t, fixture, conversationID, operator)
	preparation, err := fixture.commands.PrepareCommand(
		context.Background(),
		prepareRequest,
	)
	if err != nil {
		t.Fatalf("PrepareCommand(member authority) error = %v", err)
	}
	return dddMemberAuthoritySubmitRequestWithPreparation(
		t,
		fixture,
		preparation,
		prepareRequest.VerifiedRoutes,
		conversationID,
		operator,
		target,
		commandID,
		action,
		role,
		muted,
		mutedUntil,
	)
}

func dddMemberAuthoritySubmitRequestWithPreparation(
	t *testing.T,
	fixture dddFixture,
	preparation aggregate.CommandPreparation,
	verifiedRoutes []ports.EndpointRoute,
	conversationID valueobject.ConversationID,
	operator valueobject.Endpoint,
	target valueobject.PTID,
	commandID valueobject.CommandID,
	action domainevent.MemberAuthorityAction,
	role *valueobject.MemberRole,
	muted *bool,
	mutedUntil *time.Time,
) command.SubmitRequest {
	t.Helper()

	at := fixture.clock.Now()
	wire := &chat.ConversationMemberAuthorityCommand{
		Version:                 1,
		CommandId:               string(commandID),
		ConversationId:          string(conversationID),
		Operator:                dddEndpointProto(operator),
		TargetPtid:              string(target),
		Action:                  dddMemberAuthorityActionProto(action),
		FederationId:            string(dddFederationID),
		AuthorityStationPeerId:  string(preparation.AuthorityStation),
		AuthorityEpoch:          int64(dddAuthorityEpoch),
		AuthoritySequence:       int64(preparation.Head.Sequence),
		AuthorityHash:           preparation.Head.EventHash.Bytes(),
		ObservedMembershipEpoch: int64(preparation.Head.MembershipEpoch),
		ObservedMlsEpoch:        int64(preparation.Head.MLSEpoch),
		ClientTimestamp:         timestamppb.New(at),
		Deadline:                timestamppb.New(at.Add(5 * time.Minute)),
		MutedUntil:              optionalDDDTimestamp(mutedUntil),
	}
	if role != nil {
		mappedRole := dddMemberRoleProto(*role)
		wire.Role = &mappedRole
	}
	if muted != nil {
		mappedMuted := *muted
		wire.Muted = &mappedMuted
	}
	mapped, err := conversationhttp.MapMemberAuthorityCommand(
		conversationhttp.AuthenticatedActor{
			PTID:     string(operator.Actor),
			DeviceID: string(operator.Device),
		},
		wire,
		preparation,
		at,
	)
	if err != nil {
		t.Fatalf("MapMemberAuthorityCommand() error = %v", err)
	}
	mapped.VerifiedRoutes = append([]ports.EndpointRoute(nil), verifiedRoutes...)
	return mapped
}

func dddMemberAuthorityActionProto(
	action domainevent.MemberAuthorityAction,
) chat.ConversationMemberAuthorityAction {
	switch action {
	case domainevent.MemberAuthorityActionUpdateMember:
		return chat.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UPDATE_MEMBER
	case domainevent.MemberAuthorityActionTransferOwnership:
		return chat.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_TRANSFER_OWNERSHIP
	default:
		return chat.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UNSPECIFIED
	}
}

func dddMemberRoleProto(role valueobject.MemberRole) chat.MemberRole {
	switch role {
	case valueobject.MemberRoleMember:
		return chat.MemberRole_MEMBER_ROLE_MEMBER
	case valueobject.MemberRoleAdmin:
		return chat.MemberRole_MEMBER_ROLE_ADMIN
	case valueobject.MemberRoleOwner:
		return chat.MemberRole_MEMBER_ROLE_OWNER
	default:
		return chat.MemberRole_MEMBER_ROLE_UNSPECIFIED
	}
}

func optionalDDDTimestamp(value *time.Time) *timestamppb.Timestamp {
	if value == nil {
		return nil
	}
	return timestamppb.New(value.UTC())
}

func dddMembershipCommandBytes(
	t *testing.T,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
	sender valueobject.Endpoint,
	plan entity.AuthorityPlan,
	transitionID string,
	leaveIntentID string,
	at time.Time,
) []byte {
	t.Helper()
	changes := make([]*chat.MessagingMembershipChangeIntent, 0, len(plan.Changes))
	for _, change := range plan.Changes {
		changes = append(changes, &chat.MessagingMembershipChangeIntent{
			Action:   dddMembershipActionProto(change.Action),
			Ptid:     string(change.Actor),
			DeviceId: string(change.Device),
			Role:     string(change.Role),
		})
	}
	wire := &chat.ChatCommand{
		CommandId:               string(commandID),
		ConversationId:          string(conversationID),
		Sender:                  dddEndpointProto(sender),
		ObservedMembershipEpoch: int64(plan.AuthorityHead.MembershipEpoch),
		ObservedMlsEpoch:        int64(plan.AuthorityHead.MLSEpoch),
		ClientTimestamp:         timestamppb.New(at),
		DeliveryPlanSha256:      plan.Hash.Bytes(),
		AuthorityStationPeerId:  "station-a",
		Payload: &chat.ChatCommand_MembershipTransition{
			MembershipTransition: &chat.MembershipTransitionIntent{
				TransitionId:        transitionID,
				FromMembershipEpoch: int64(plan.AuthorityHead.MembershipEpoch),
				FromMlsEpoch:        int64(plan.AuthorityHead.MLSEpoch),
				ToMlsEpoch:          int64(plan.AuthorityHead.MLSEpoch.Next()),
				Changes:             changes,
				MlsCommit:           []byte("mls-commit"),
				MlsCommitSha256:     valueobject.HashBytes([]byte("mls-commit")).Bytes(),
				LeaveIntentId:       leaveIntentID,
				AuthorityPlanId:     string(plan.ID),
				AuthorityPlanSha256: plan.Hash.Bytes(),
			},
		},
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func dddEndpointProto(endpoint valueobject.Endpoint) *chat.CryptoEndpoint {
	return &chat.CryptoEndpoint{
		Ptid:     string(endpoint.Actor),
		DeviceId: string(endpoint.Device),
	}
}

func dddMembershipActionProto(
	action entity.MembershipAction,
) chat.MessagingMembershipAction {
	switch action {
	case entity.MembershipActionAddActor:
		return chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR
	case entity.MembershipActionRemoveActor:
		return chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR
	case entity.MembershipActionLeave:
		return chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_LEAVE
	case entity.MembershipActionChangeRole:
		return chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_CHANGE_ROLE
	case entity.MembershipActionAddDevice:
		return chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE
	case entity.MembershipActionRemoveDevice:
		return chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_DEVICE
	default:
		return chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_UNSPECIFIED
	}
}

func endpointUnionDDD(
	left []valueobject.Endpoint,
	right []valueobject.Endpoint,
) []valueobject.Endpoint {
	byKey := make(map[string]valueobject.Endpoint, len(left)+len(right))
	for _, endpoint := range append(append([]valueobject.Endpoint(nil), left...), right...) {
		byKey[endpoint.Key()] = endpoint
	}
	result := make([]valueobject.Endpoint, 0, len(byKey))
	for _, endpoint := range byKey {
		result = append(result, endpoint)
	}
	return valueobject.SortEndpoints(result)
}

func containsEndpointDDD(
	endpoints []valueobject.Endpoint,
	target valueobject.Endpoint,
) bool {
	for _, endpoint := range endpoints {
		if endpoint == target {
			return true
		}
	}
	return false
}

func snapshotHasEndpoint(snapshot aggregate.Snapshot, endpoint valueobject.Endpoint) bool {
	for _, device := range snapshot.Devices {
		if device.Endpoint == endpoint && device.Active {
			return true
		}
	}
	return false
}

func snapshotHasActor(snapshot aggregate.Snapshot, actor valueobject.PTID) bool {
	for _, member := range snapshot.Members {
		if member.Actor == actor && member.Active() {
			return true
		}
	}
	return false
}

func dddSnapshotMember(
	t *testing.T,
	snapshot aggregate.Snapshot,
	actor valueobject.PTID,
) entity.Member {
	t.Helper()
	for _, member := range snapshot.Members {
		if member.Actor == actor {
			return member
		}
	}
	t.Fatalf("snapshot member %q is missing", actor)
	return entity.Member{}
}

func assertCount(t *testing.T, db *gorm.DB, model any, expected int64) {
	t.Helper()
	if count := rowCount(t, db, model); count != expected {
		t.Fatalf("%T row count = %d, want %d", model, count, expected)
	}
}

func assertExpiredPlanAndReleasedReservations(
	t *testing.T,
	db *gorm.DB,
	plan entity.AuthorityPlan,
) {
	t.Helper()
	var persisted persistence.ConversationAuthorityPlanModel
	if err := db.First(&persisted, "plan_id = ?", string(plan.ID)).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.State != string(entity.AuthorityPlanStateExpired) {
		t.Fatalf("plan state = %q, want expired", persisted.State)
	}
	var released int64
	if err := db.Model(&dddKeyPackageReservationModel{}).
		Where("plan_id = ? AND state = ?", string(plan.ID), "released").
		Count(&released).Error; err != nil {
		t.Fatal(err)
	}
	if released != int64(len(plan.KeyPackageReservations)) {
		t.Fatalf("released reservations = %d, want %d", released, len(plan.KeyPackageReservations))
	}
}

func rowCount(t *testing.T, db *gorm.DB, model any) int64 {
	t.Helper()
	var count int64
	if err := db.Model(model).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}
