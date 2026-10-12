package systemdelivery_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/ingest"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	systemdelivery "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/systemdelivery"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

// --- in-memory unit of work / adapters ---

type fixedUnitOfWork struct{ tx ports.Transaction }

func (u fixedUnitOfWork) Execute(ctx context.Context, fn func(ports.Transaction) error) error {
	return fn(u.tx)
}
func (u fixedUnitOfWork) ExecuteSerialized(
	ctx context.Context, _ string, fn func(ports.Transaction) error,
) error {
	return fn(u.tx)
}

type memoryAuthority struct {
	mu       sync.Mutex
	snapshot aggregate.Snapshot
	exists   bool
}

func (r *memoryAuthority) Create(_ context.Context, snapshot aggregate.Snapshot) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.exists {
		return errors.New("authority already exists")
	}
	r.snapshot = snapshot
	r.exists = true
	return nil
}
func (r *memoryAuthority) LoadForUpdate(
	_ context.Context, _ valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.exists {
		return aggregate.Snapshot{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeNotFound,
			"test.authority",
			"authority",
			"not found",
		)
	}
	return r.snapshot, nil
}
func (r *memoryAuthority) Get(
	_ context.Context, id valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	return r.LoadForUpdate(context.Background(), id)
}
func (r *memoryAuthority) ListByActor(
	_ context.Context, _ valueobject.PTID,
) ([]aggregate.Snapshot, error) {
	return nil, nil
}
func (r *memoryAuthority) Save(_ context.Context, snapshot aggregate.Snapshot) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.snapshot = snapshot
	r.exists = true
	return nil
}

type memoryEvents struct{ records []domainevent.Record }

func (r *memoryEvents) Append(_ context.Context, event domainevent.Record) error {
	r.records = append(r.records, event)
	return nil
}
func (r *memoryEvents) GetByID(_ context.Context, id valueobject.EventID) (domainevent.Record, error) {
	for _, record := range r.records {
		if record.ID == id {
			return record, nil
		}
	}
	return domainevent.Record{}, repositoryErr("event not found")
}
func (r *memoryEvents) GetByCommand(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.CommandID,
) (domainevent.Record, error) {
	return domainevent.Record{}, repositoryErr("not found")
}
func (r *memoryEvents) GetBySequence(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.Sequence,
) (domainevent.Record, error) {
	return domainevent.Record{}, repositoryErr("not found")
}
func (r *memoryEvents) GetMessageIdentity(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.MessageID,
) (repository.MessageIdentity, error) {
	return repository.MessageIdentity{}, repositoryErr("not found")
}
func (r *memoryEvents) List(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.Sequence, _ int,
) ([]domainevent.Record, error) {
	return nil, nil
}
func (r *memoryEvents) ListMessages(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.Sequence, _ int,
) ([]domainevent.Record, error) {
	return nil, nil
}
func (r *memoryEvents) ListThreadMessages(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.MessageID,
	_ valueobject.Sequence, _ int,
) ([]domainevent.Record, error) {
	return nil, nil
}
func (r *memoryEvents) ThreadCounts(
	_ context.Context, _ valueobject.ConversationID, _ []valueobject.MessageID,
) ([]repository.ThreadCount, error) {
	return nil, nil
}

type memoryReceipts struct {
	created map[string]repository.CommandReceipt
}

func newMemoryReceipts() *memoryReceipts {
	return &memoryReceipts{created: map[string]repository.CommandReceipt{}}
}
func (r *memoryReceipts) Get(
	_ context.Context, _ valueobject.ConversationID, command valueobject.CommandID,
) (repository.CommandReceipt, error) {
	if receipt, ok := r.created[string(command)]; ok {
		return receipt, nil
	}
	return repository.CommandReceipt{}, repositoryErr("receipt not found")
}
func (r *memoryReceipts) Create(_ context.Context, receipt repository.CommandReceipt) error {
	r.created[string(receipt.CommandID)] = receipt
	return nil
}

type noopPlans struct{}

func (noopPlans) Create(_ context.Context, _ entity.AuthorityPlan) error {
	return errors.New("plan create not expected")
}
func (noopPlans) LoadForUpdate(_ context.Context, _ valueobject.PlanID) (entity.AuthorityPlan, error) {
	return entity.AuthorityPlan{}, errors.New("plan load not expected")
}
func (noopPlans) Save(_ context.Context, _ entity.AuthorityPlan) error {
	return errors.New("plan save not expected")
}

type noopSettings struct{}

func (noopSettings) Get(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.PTID,
) (repository.MemberSettings, error) {
	return repository.MemberSettings{}, repositoryErr("not found")
}
func (noopSettings) Save(_ context.Context, _ repository.MemberSettings) error {
	return nil
}

type noopCursors struct{}

func (noopCursors) Get(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.PTID,
) (repository.ReadCursor, error) {
	return repository.ReadCursor{}, repositoryErr("not found")
}
func (noopCursors) Advance(
	_ context.Context, cursor repository.ReadCursor,
) (repository.ReadCursor, bool, error) {
	return cursor, false, nil
}

type noopLeaves struct{}

func (noopLeaves) Create(_ context.Context, intent repository.LeaveIntent) (repository.LeaveIntent, error) {
	return intent, nil
}
func (noopLeaves) LoadForUpdate(_ context.Context, _ string) (repository.LeaveIntent, error) {
	return repository.LeaveIntent{}, repositoryErr("not found")
}
func (noopLeaves) Save(_ context.Context, intent repository.LeaveIntent) error {
	return nil
}
func (noopLeaves) ListPending(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.PTID, _ int,
) ([]repository.LeaveIntent, error) {
	return nil, nil
}

type noopFollowers struct{}

func (noopFollowers) Get(
	_ context.Context, _ valueobject.ConversationID,
) (repository.FollowerProjection, error) {
	return repository.FollowerProjection{}, repositoryErr("not found")
}
func (noopFollowers) ListByActor(_ context.Context, _ valueobject.PTID) ([]repository.FollowerProjection, error) {
	return nil, nil
}
func (noopFollowers) ListByStatus(
	_ context.Context, _ repository.FollowerStatus, _ int,
) ([]repository.FollowerProjection, error) {
	return nil, nil
}
func (noopFollowers) Apply(
	_ context.Context, _ repository.FollowerProjection, _ domainevent.Record,
) error {
	return nil
}
func (noopFollowers) Buffer(_ context.Context, _ domainevent.Record) error { return nil }
func (noopFollowers) GetBuffered(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.Sequence,
) (domainevent.Record, error) {
	return domainevent.Record{}, repositoryErr("not found")
}
func (noopFollowers) NextBuffered(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.Sequence,
) (domainevent.Record, error) {
	return domainevent.Record{}, repositoryErr("not found")
}
func (noopFollowers) DeleteBuffered(
	_ context.Context, _ valueobject.ConversationID, _ valueobject.Sequence,
) error {
	return nil
}
func (noopFollowers) SetStatus(
	_ context.Context, _ valueobject.ConversationID, _ repository.FollowerStatus,
) error {
	return nil
}
func (noopFollowers) Status(
	_ context.Context, _ valueobject.ConversationID,
) (repository.FollowerStatus, error) {
	return "", nil
}

type memoryIdentity struct{ routes []ports.EndpointRoute }

func (memoryIdentity) IsActive(_ context.Context, _ valueobject.Endpoint) (bool, error) {
	return true, nil
}
func (memoryIdentity) ActorIdentityPublicKey(
	_ context.Context, _ valueobject.PTID,
) ([]byte, error) {
	return make([]byte, 32), nil
}
func (memoryIdentity) VerifyDeviceSignature(
	_ context.Context, _ valueobject.Endpoint, _ string, _, _ []byte,
) (ports.DeviceSignatureVerification, error) {
	return ports.DeviceSignatureVerification{}, nil
}
func (i memoryIdentity) ListActiveEndpoints(
	_ context.Context, _ []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	return i.routes, nil
}

type memoryFederation struct{}

func (memoryFederation) IsActiveStation(
	_ context.Context, _ valueobject.FederationID, _ valueobject.StationID,
) (bool, error) {
	return true, nil
}

type memorySystemDirectories struct {
	mu        sync.Mutex
	grants    map[string]bool
	ingestion map[string]string
	denyGrant bool
}

func newMemorySystemDirectories() *memorySystemDirectories {
	return &memorySystemDirectories{
		grants:    map[string]bool{},
		ingestion: map[string]string{},
	}
}
func grantKey(bot, owner, conversation string) string {
	return bot + "|" + owner + "|" + conversation
}
func (m *memorySystemDirectories) EnsureSystemGrant(
	_ context.Context, bot, owner valueobject.PTID,
	conversation valueobject.ConversationID, _ time.Time,
) error {
	if m.denyGrant {
		return errors.New("grant denied")
	}
	m.grants[grantKey(string(bot), string(owner), string(conversation))] = true
	return nil
}
func (m *memorySystemDirectories) LoadIngestion(
	_ context.Context, bot valueobject.PTID, requestID string, _ time.Time,
) (string, bool, error) {
	id, ok := m.ingestion[string(bot)+"|"+requestID]
	return id, ok, nil
}
func (m *memorySystemDirectories) RecordIngestion(
	_ context.Context, bot valueobject.PTID, requestID, eventID string, _ time.Time,
) error {
	m.ingestion[string(bot)+"|"+requestID] = eventID
	return nil
}

func (m *memorySystemDirectories) AuthorizeSystemMessage(
	_ context.Context,
	bot, owner valueobject.PTID,
	conversation valueobject.ConversationID,
) error {
	if m.denyGrant || !m.grants[grantKey(string(bot), string(owner), string(conversation))] {
		return errors.New("system sender is not granted")
	}
	return nil
}

type memoryNotifications struct {
	mu       sync.Mutex
	produced []ports.ServiceNotificationInput
}

func (n *memoryNotifications) ProduceInTx(
	_ context.Context, input ports.ServiceNotificationInput, _ time.Time,
) (ports.ServiceNotificationResult, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, existing := range n.produced {
		if existing.IdempotencyKey != "" &&
			existing.IdempotencyKey == input.IdempotencyKey &&
			existing.RecipientPTID == input.RecipientPTID {
			return ports.ServiceNotificationResult{}, nil
		}
	}
	n.produced = append(n.produced, input)
	return ports.ServiceNotificationResult{
		Produced:       true,
		NotificationID: "ntf-" + input.IdempotencyKey,
	}, nil
}

type memoryLocalScope struct{}

func (memoryLocalScope) LocalFederation(_ context.Context) (
	valueobject.FederationID, valueobject.AuthorityEpoch, error,
) {
	return "federation-local", 1, nil
}

type memoryDeviceInbox struct{ intents []ports.DeviceInboxIntent }

func (m *memoryDeviceInbox) Enqueue(_ context.Context, intent ports.DeviceInboxIntent) error {
	m.intents = append(m.intents, intent)
	return nil
}

type memoryFederationOutbox struct{}

func (memoryFederationOutbox) Enqueue(_ context.Context, _ ports.FederationOutboxIntent) error {
	return errors.New("federation outbox must not be used for home-local bot delivery")
}

type memoryCommitments struct {
	recorded []ports.AuthorityDeliveryCommitment
}

func (m *memoryCommitments) RecordCommitments(
	_ context.Context, commitments []ports.AuthorityDeliveryCommitment,
) error {
	m.recorded = append(m.recorded, commitments...)
	return nil
}

type noopObjectGrants struct{}

func (noopObjectGrants) GrantBatch(_ context.Context, _ ports.ObjectGrantBatch) error {
	return nil
}

type noopKeyPackages struct{}

func (noopKeyPackages) Reserve(
	_ context.Context, _ valueobject.PlanID, _ []ports.EndpointRoute, _ time.Time,
) ([]valueobject.KeyPackageReservation, error) {
	return nil, nil
}
func (noopKeyPackages) Consume(
	_ context.Context, _ []valueobject.KeyPackageReservation, _ time.Time,
) error {
	return nil
}
func (noopKeyPackages) Release(
	_ context.Context, _ []valueobject.KeyPackageReservation, _ time.Time,
) error {
	return nil
}

type testStateEncoder struct{}

func (testStateEncoder) EncodeConversationStateMarker(
	_ valueobject.ConversationID, _ valueobject.EventID,
) ([]byte, error) {
	return []byte("state-marker"), nil
}

type testCursorEncoder struct{}

func (testCursorEncoder) EncodeReadCursor(_ repository.ReadCursor) ([]byte, error) {
	return []byte("read-cursor"), nil
}

type testLeaveEncoder struct{}

func (testLeaveEncoder) EncodeLeaveIntentSigningInput(
	_ ports.LeaveIntentSigningInput,
) ([]byte, error) {
	return []byte("leave"), nil
}

type testProposalEncoder struct{}

func (testProposalEncoder) EncodeCommandProposalSigningInput(
	_ ports.CommandProposalSigningInput,
) ([]byte, error) {
	return []byte("proposal"), nil
}

type testSealer struct{}

func (testSealer) Seal(input domainevent.RecordInput) (domainevent.Record, error) {
	canonical, err := (domainevent.CanonicalSealer{}).Seal(input)
	if err != nil {
		return domainevent.Record{}, err
	}
	return domainevent.SealTransportRecord(input, canonical.Hash, canonical.Bytes())
}

type repositoryError string

func (e repositoryError) Error() string { return string(e) }

func repositoryErr(message string) error { return repositoryError(message) }

// --- harness ---

type harness struct {
	tx        ports.Transaction
	authority *memoryAuthority
	events    *memoryEvents
	inbox     *memoryDeviceInbox
	system    *memorySystemDirectories
	notify    *memoryNotifications
	owner     valueobject.Endpoint
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	station := valueobject.StationID("station-a")
	owner := valueobject.Endpoint{
		Actor:  "ptid:owner-alice",
		Device: "owner-device",
	}
	authority := &memoryAuthority{}
	events := &memoryEvents{}
	inbox := &memoryDeviceInbox{}
	system := newMemorySystemDirectories()
	notify := &memoryNotifications{}
	tx := ports.Transaction{
		Repositories: repository.Repositories{
			Authority:      authority,
			Events:         events,
			Receipts:       newMemoryReceipts(),
			AuthorityPlans: noopPlans{},
			MemberSettings: noopSettings{},
			ReadCursors:    noopCursors{},
			LeaveIntents:   noopLeaves{},
			Followers:      noopFollowers{},
		},
		Identity:               memoryIdentity{routes: []ports.EndpointRoute{{Endpoint: owner, HomeStation: station}}},
		Federation:             memoryFederation{},
		SystemDirectories:      system,
		SystemSender:           system,
		ServiceNotifications:   notify,
		LocalScope:             memoryLocalScope{},
		DeviceInbox:            inbox,
		FederationOutbox:       memoryFederationOutbox{},
		DeliveryCommitments:    &memoryCommitments{},
		ObjectGrants:           noopObjectGrants{},
		KeyPackageReservations: noopKeyPackages{},
	}
	return &harness{
		tx:        tx,
		authority: authority,
		events:    events,
		inbox:     inbox,
		system:    system,
		notify:    notify,
		owner:     owner,
	}
}

func (h *harness) newService() *systemdeliveryServiceHandle {
	commands, err := command.NewService(
		fixedUnitOfWork{tx: h.tx},
		"station-a",
		fixedClock{},
		fixedIDGenerator{},
		testStateEncoder{},
		conversationhttp.ProtobufDeviceEventEncoder{},
		testCursorEncoder{},
		testLeaveEncoder{},
		testProposalEncoder{},
		nil,
		testSealer{},
	)
	if err != nil {
		panic(err)
	}
	service, err := systemdelivery.NewService(
		fixedUnitOfWork{tx: h.tx},
		commands,
		func() time.Time { return fixedClock{}.Now() },
	)
	if err != nil {
		panic(err)
	}
	return &systemdeliveryServiceHandle{service: service}
}

type fixedClock struct{}

func (fixedClock) Now() time.Time {
	return time.Date(2026, 10, 12, 11, 0, 0, 0, time.UTC)
}

type fixedIDGenerator struct{}

func (fixedIDGenerator) NewPlanID() valueobject.PlanID { return "plan-test" }

type systemdeliveryServiceHandle struct {
	service interface {
		Deliver(context.Context, ingest.DeliverCommand) (systemdelivery.Result, error)
	}
}

func botInstruction() ingest.DeliverCommand {
	return ingest.DeliverCommand{
		RequestID: "req-1",
		Bot: &domain.Bot{
			BotPtid:   "ptid:bot-claude",
			OwnerPtid: "ptid:owner-alice",
			Name:      "Build Bot",
			WebhookID: "wh_123",
			State:     domain.StateActive,
		},
		Event: domain.IncomingEvent{
			RequestID: "req-1",
			Kind:      domain.KindTaskCompleted,
			Severity:  domain.SeverityAttention,
			Title:     "Build finished",
			Source: domain.Source{
				Agent:     "claude-code",
				Workspace: "peers-touch",
				Labels:    map[string]string{"repo": "peers-touch"},
			},
		},
		Now: fixedClock{}.Now(),
	}
}

func TestDeliverCreatesConversationMessageNotificationOnce(t *testing.T) {
	h := newHarness(t)
	service := h.newService().service

	result, err := service.Deliver(context.Background(), botInstruction())
	if err != nil {
		t.Fatalf("Deliver() error = %v", err)
	}
	if result.Replayed || result.EventID == "" {
		t.Fatalf("first delivery = (%q,%v), want fresh event id", result.EventID, result.Replayed)
	}
	if !h.authority.exists {
		t.Fatal("system direct conversation was not created")
	}
	if len(h.events.records) != 2 {
		t.Fatalf("events = %d, want genesis + service message", len(h.events.records))
	}
	serviceEvent := h.events.records[1]
	if serviceEvent.Actor.Device != valueobject.SystemStationDeviceID {
		t.Fatalf("service event actor = %+v, want station-system", serviceEvent.Actor)
	}
	// The owner device must have two queue items (genesis marker + message).
	if len(h.inbox.intents) != 2 {
		t.Fatalf("device inbox intents = %d, want 2", len(h.inbox.intents))
	}
	if len(h.notify.produced) != 1 {
		t.Fatalf("notifications = %d, want 1", len(h.notify.produced))
	}
	if h.notify.produced[0].Type != 410 {
		t.Fatalf("notification type = %d, want 410", h.notify.produced[0].Type)
	}
	// A fresh notification must surface one post-commit actor wake descriptor.
	wake := result.NotificationWake
	if wake == nil {
		t.Fatal("first delivery must return a post-commit notification wake")
	}
	if wake.NotificationID != "ntf-bot-event:req-1" ||
		wake.NotificationType != 410 ||
		string(wake.RecipientActor) != "ptid:owner-alice" ||
		wake.CreatedAtUnixMs == 0 {
		t.Fatalf("notification wake = %+v", wake)
	}

	// The committed endpoint payload must be a kind-8 readable service body.
	messageIntent := h.inbox.intents[1]
	var delivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(messageIntent.OpaquePayload, &delivery); err != nil {
		t.Fatalf("decode delivery: %v", err)
	}
	if delivery.PayloadKind !=
		chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_SERVICE_PLAINTEXT {
		t.Fatalf("kind = %v, want DIRECT_SERVICE_PLAINTEXT", delivery.PayloadKind)
	}
	var body chat.DirectServicePlaintextPayload
	if err := proto.Unmarshal(delivery.EndpointPayload, &body); err != nil {
		t.Fatalf("decode service payload: %v", err)
	}
	if body.GetFallbackText() == "" || body.GetBotEvent().GetBotPtid() != "ptid:bot-claude" {
		t.Fatalf("payload = %+v, want fallback + bound bot event", &body)
	}
}

func TestDeliverReplayReturnsSameEventWithoutDuplicates(t *testing.T) {
	h := newHarness(t)
	service := h.newService().service

	first, err := service.Deliver(context.Background(), botInstruction())
	if err != nil {
		t.Fatalf("first Deliver: %v", err)
	}
	second, err := service.Deliver(context.Background(), botInstruction())
	if err != nil {
		t.Fatalf("replay Deliver: %v", err)
	}
	if !second.Replayed || second.EventID != first.EventID {
		t.Fatalf("replay = (%q,%v), want same id (%q) marked replayed", second.EventID, second.Replayed, first.EventID)
	}
	if second.NotificationWake != nil {
		t.Fatal("replay must not surface a new post-commit notification wake")
	}
	if len(h.events.records) != 2 {
		t.Fatalf("events after replay = %d, still want 2", len(h.events.records))
	}
	if len(h.notify.produced) != 1 {
		t.Fatalf("notifications after replay = %d, still want 1", len(h.notify.produced))
	}
}

func TestDeliverRejectsWhenSystemGrantDenied(t *testing.T) {
	h := newHarness(t)
	h.system.denyGrant = true
	if _, err := h.newService().service.Deliver(context.Background(), botInstruction()); err == nil {
		t.Fatal("expected delivery failure when grant is denied")
	}
	if len(h.notify.produced) != 0 {
		t.Fatal("no notification may exist when the transaction fails")
	}
}
