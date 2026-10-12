package command

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// G-BOT-03 structural proof: the bot edge drives service-plaintext delivery
// exclusively through the Conversation application port. The test never
// implements or reaches into bot-registry repositories — authorization is an
// injected transaction port, and Federation scope / recipient routes are
// sourced internally from the loaded authority and identity directory.

type immediateUnitOfWork struct {
	transaction *ports.Transaction
}

func (u immediateUnitOfWork) Execute(
	ctx context.Context,
	operation func(ports.Transaction) error,
) error {
	return operation(*u.transaction)
}

func (u immediateUnitOfWork) ExecuteSerialized(
	ctx context.Context,
	_ string,
	operation func(ports.Transaction) error,
) error {
	return operation(*u.transaction)
}

type systemAuthorityRepo struct {
	snapshot aggregate.Snapshot
	saved    []aggregate.Snapshot
}

func (r *systemAuthorityRepo) Create(
	_ context.Context,
	_ aggregate.Snapshot,
) error {
	return errors.New("authority create not expected")
}

func (r *systemAuthorityRepo) LoadForUpdate(
	_ context.Context,
	_ valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	return r.snapshot, nil
}

func (r *systemAuthorityRepo) Get(
	_ context.Context,
	_ valueobject.ConversationID,
) (aggregate.Snapshot, error) {
	return r.snapshot, nil
}

func (r *systemAuthorityRepo) ListByActor(
	_ context.Context,
	_ valueobject.PTID,
) ([]aggregate.Snapshot, error) {
	return nil, nil
}

func (r *systemAuthorityRepo) Save(
	_ context.Context,
	snapshot aggregate.Snapshot,
) error {
	r.saved = append(r.saved, snapshot)
	return nil
}

type systemEventRepo struct {
	appended []domainevent.Record
}

func (r *systemEventRepo) Append(
	_ context.Context,
	event domainevent.Record,
) error {
	r.appended = append(r.appended, event)
	return nil
}

func (r *systemEventRepo) GetByID(
	_ context.Context,
	_ valueobject.EventID,
) (domainevent.Record, error) {
	return domainevent.Record{}, errors.New("event GetByID not expected")
}

func (r *systemEventRepo) GetByCommand(
	_ context.Context,
	_ valueobject.ConversationID,
	_ valueobject.CommandID,
) (domainevent.Record, error) {
	return domainevent.Record{}, errors.New("event GetByCommand not expected")
}

func (r *systemEventRepo) GetBySequence(
	_ context.Context,
	_ valueobject.ConversationID,
	_ valueobject.Sequence,
) (domainevent.Record, error) {
	return domainevent.Record{}, errors.New("event GetBySequence not expected")
}

func (r *systemEventRepo) GetMessageIdentity(
	_ context.Context,
	_ valueobject.ConversationID,
	_ valueobject.MessageID,
) (repository.MessageIdentity, error) {
	return repository.MessageIdentity{}, errors.New("event GetMessageIdentity not expected")
}

func (r *systemEventRepo) List(
	_ context.Context,
	_ valueobject.ConversationID,
	_ valueobject.Sequence,
	_ int,
) ([]domainevent.Record, error) {
	return nil, errors.New("event List not expected")
}

func (r *systemEventRepo) ListMessages(
	_ context.Context,
	_ valueobject.ConversationID,
	_ valueobject.Sequence,
	_ int,
) ([]domainevent.Record, error) {
	return nil, errors.New("event ListMessages not expected")
}

func (r *systemEventRepo) ListThreadMessages(
	_ context.Context,
	_ valueobject.ConversationID,
	_ valueobject.MessageID,
	_ valueobject.Sequence,
	_ int,
) ([]domainevent.Record, error) {
	return nil, errors.New("event ListThreadMessages not expected")
}

func (r *systemEventRepo) ThreadCounts(
	_ context.Context,
	_ valueobject.ConversationID,
	_ []valueobject.MessageID,
) ([]repository.ThreadCount, error) {
	return nil, errors.New("event ThreadCounts not expected")
}

type systemReceiptRepo struct {
	created []repository.CommandReceipt
}

func (r *systemReceiptRepo) Get(
	_ context.Context,
	_ valueobject.ConversationID,
	_ valueobject.CommandID,
) (repository.CommandReceipt, error) {
	return repository.CommandReceipt{}, conversationdomain.NewError(
		conversationdomain.ErrorCodeNotFound,
		"test.receipt",
		"receipt",
		"not found",
	)
}

func (r *systemReceiptRepo) Create(
	_ context.Context,
	receipt repository.CommandReceipt,
) error {
	r.created = append(r.created, receipt)
	return nil
}

type noopPlanRepo struct{}

func (noopPlanRepo) Create(_ context.Context, _ entity.AuthorityPlan) error {
	return errors.New("plan create not expected")
}

func (noopPlanRepo) LoadForUpdate(
	_ context.Context,
	_ valueobject.PlanID,
) (entity.AuthorityPlan, error) {
	return entity.AuthorityPlan{}, errors.New("plan load not expected")
}

func (noopPlanRepo) Save(_ context.Context, _ entity.AuthorityPlan) error {
	return errors.New("plan save not expected")
}

type systemIdentity struct {
	routes []ports.EndpointRoute
}

func (systemIdentity) IsActive(
	_ context.Context,
	_ valueobject.Endpoint,
) (bool, error) {
	return true, nil
}

func (systemIdentity) ActorIdentityPublicKey(
	_ context.Context,
	_ valueobject.PTID,
) ([]byte, error) {
	return make([]byte, 32), nil
}

func (systemIdentity) VerifyDeviceSignature(
	_ context.Context,
	_ valueobject.Endpoint,
	_ string,
	_ []byte,
	_ []byte,
) (ports.DeviceSignatureVerification, error) {
	return ports.DeviceSignatureVerification{}, nil
}

func (i systemIdentity) ListActiveEndpoints(
	_ context.Context,
	_ []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	return i.routes, nil
}

type systemFederation struct{}

func (systemFederation) IsActiveStation(
	_ context.Context,
	_ valueobject.FederationID,
	_ valueobject.StationID,
) (bool, error) {
	return true, nil
}

type scriptedSystemGrant struct {
	calls []systemGrantCall
	deny  error
}

type systemGrantCall struct {
	bot          valueobject.PTID
	owner        valueobject.PTID
	conversation valueobject.ConversationID
}

func (g *scriptedSystemGrant) AuthorizeSystemMessage(
	_ context.Context,
	bot valueobject.PTID,
	owner valueobject.PTID,
	conversation valueobject.ConversationID,
) error {
	g.calls = append(g.calls, systemGrantCall{
		bot:          bot,
		owner:        owner,
		conversation: conversation,
	})
	return g.deny
}

type recordingDeviceInbox struct {
	intents []ports.DeviceInboxIntent
}

func (w *recordingDeviceInbox) Enqueue(
	_ context.Context,
	intent ports.DeviceInboxIntent,
) error {
	w.intents = append(w.intents, intent)
	return nil
}

type recordingFederationOutbox struct {
	intents []ports.FederationOutboxIntent
}

func (w *recordingFederationOutbox) Enqueue(
	_ context.Context,
	intent ports.FederationOutboxIntent,
) error {
	w.intents = append(w.intents, intent)
	return nil
}

type recordingCommitments struct {
	commitments []ports.AuthorityDeliveryCommitment
}

func (w *recordingCommitments) RecordCommitments(
	_ context.Context,
	commitments []ports.AuthorityDeliveryCommitment,
) error {
	w.commitments = append(w.commitments, commitments...)
	return nil
}

type noopObjectGrants struct{}

func (noopObjectGrants) GrantBatch(
	_ context.Context,
	_ ports.ObjectGrantBatch,
) error {
	return errors.New("object grants not expected")
}

type noopKeyPackages struct{}

func (noopKeyPackages) Reserve(
	_ context.Context,
	_ valueobject.PlanID,
	_ []ports.EndpointRoute,
	_ time.Time,
) ([]valueobject.KeyPackageReservation, error) {
	return nil, errors.New("key package reserve not expected")
}

func (noopKeyPackages) Consume(
	_ context.Context,
	_ []valueobject.KeyPackageReservation,
	_ time.Time,
) error {
	return errors.New("key package consume not expected")
}

func (noopKeyPackages) Release(
	_ context.Context,
	_ []valueobject.KeyPackageReservation,
	_ time.Time,
) error {
	return errors.New("key package release not expected")
}

type fixedSystemClock struct {
	now time.Time
}

func (c fixedSystemClock) Now() time.Time { return c.now }

type fixedIDGenerator struct{}

func (fixedIDGenerator) NewPlanID() valueobject.PlanID { return "plan-system-test" }

type systemStateEncoder struct{}

func (systemStateEncoder) EncodeConversationStateMarker(
	_ valueobject.ConversationID,
	_ valueobject.EventID,
) ([]byte, error) {
	return []byte("state-marker"), nil
}

type systemDeviceEventEncoder struct{}

func (systemDeviceEventEncoder) EncodeDeviceEvent(
	event domainevent.Record,
	delivery valueobject.PreparedDelivery,
	commitment valueobject.Hash,
	senderIdentityKey []byte,
) ([]byte, error) {
	kind := mapTestDeliveryKind(delivery.Kind)
	wireEvent := &chat.ConversationEvent{
		EventId:                string(event.ID),
		ConversationId:         string(event.ConversationID),
		Sequence:               int64(event.Sequence),
		CommandId:              string(event.CommandID),
		Actor:                  testEndpointProto(event.Actor),
		PreviousHash:           event.PreviousHash.Bytes(),
		EventHash:              event.Hash.Bytes(),
		CommittedAt:            timestamppb.New(event.CommittedAt),
		DeliveryCommitments:    [][]byte{},
		MembershipEpoch:        int64(event.MembershipEpoch),
		MlsEpoch:               int64(event.MLSEpoch),
		AuthorityStationPeerId: string(event.AuthorityStation),
		Payload: &chat.ConversationEvent_MessageCommitted{
			MessageCommitted: &chat.MessageCommittedFact{
				MessageId:        string(event.Fact.MessageID),
				Sender:           testEndpointProto(event.Actor),
				ContentKind:      chat.MessagingContentKind_MESSAGING_CONTENT_KIND_SYSTEM,
				DeliverySecurity: chat.MessageDeliverySecurity_MESSAGE_DELIVERY_SECURITY_SERVICE_PLAINTEXT,
			},
		},
	}
	return proto.Marshal(&chat.DeviceEventDelivery{
		Event:                        wireEvent,
		Recipient:                    testEndpointProto(delivery.Recipient),
		PayloadKind:                  kind,
		EndpointPayload:              append([]byte(nil), delivery.Opaque...),
		EndpointPayloadSha256:        delivery.PayloadHash.Bytes(),
		DeliveryCommitment:           commitment.Bytes(),
		SenderActorIdentityPublicKey: senderIdentityKey,
	})
}

func mapTestDeliveryKind(kind valueobject.DeliveryKind) chat.PreparedEndpointPayloadKind {
	switch kind {
	case valueobject.DeliveryKindDirectServicePlaintext:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_SERVICE_PLAINTEXT
	default:
		return chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_UNSPECIFIED
	}
}

func testEndpointProto(endpoint valueobject.Endpoint) *chat.CryptoEndpoint {
	return &chat.CryptoEndpoint{
		Ptid:     string(endpoint.Actor),
		DeviceId: string(endpoint.Device),
	}
}

type systemCursorEncoder struct{}

func (systemCursorEncoder) EncodeReadCursor(
	_ repository.ReadCursor,
) ([]byte, error) {
	return []byte("read-cursor"), nil
}

type systemLeaveEncoder struct{}

func (systemLeaveEncoder) EncodeLeaveIntentSigningInput(
	_ ports.LeaveIntentSigningInput,
) ([]byte, error) {
	return []byte("leave-input"), nil
}

type systemProposalEncoder struct{}

func (systemProposalEncoder) EncodeCommandProposalSigningInput(
	_ ports.CommandProposalSigningInput,
) ([]byte, error) {
	return []byte("proposal-input"), nil
}

type systemSealer struct{}

func (systemSealer) Seal(input domainevent.RecordInput) (domainevent.Record, error) {
	canonical, err := (domainevent.CanonicalSealer{}).Seal(input)
	if err != nil {
		return domainevent.Record{}, err
	}
	return domainevent.SealTransportRecord(input, canonical.Hash, canonical.Bytes())
}

type recordingNotifier struct {
	deliveries []ports.CommittedDelivery
}

func (n *recordingNotifier) NotifyCommitted(
	_ context.Context,
	deliveries []ports.CommittedDelivery,
) error {
	n.deliveries = append(n.deliveries, deliveries...)
	return nil
}

type systemHarness struct {
	conversationID valueobject.ConversationID
	station        valueobject.StationID
	bot            valueobject.Endpoint
	owner          valueobject.Endpoint
	tx             *ports.Transaction
	grant          *scriptedSystemGrant
	inbox          *recordingDeviceInbox
	outbox         *recordingFederationOutbox
	commits        *recordingCommitments
	notify         *recordingNotifier
	service        *Service
}

func newSystemHarness(t *testing.T, ownerDevices []ports.EndpointRoute) *systemHarness {
	t.Helper()
	station := valueobject.StationID("station-a")
	bot, err := valueobject.NewEndpoint("ptid:bot-claude", string(valueobject.SystemStationDeviceID))
	if err != nil {
		t.Fatalf("bot endpoint: %v", err)
	}
	ownerEndpoint, err := valueobject.NewEndpoint("ptid:owner-alice", "owner-device")
	if err != nil {
		t.Fatalf("owner endpoint: %v", err)
	}
	genesisDevices := []entity.MemberDevice{
		mustSystemMemberDevice(t, bot, station),
	}
	var ownerDeviceEndpoints []valueobject.Endpoint
	if len(ownerDevices) == 0 {
		ownerDeviceEndpoints = []valueobject.Endpoint{ownerEndpoint}
	} else {
		ownerDeviceEndpoints = make([]valueobject.Endpoint, 0, len(ownerDevices))
		for _, route := range ownerDevices {
			ownerDeviceEndpoints = append(ownerDeviceEndpoints, route.Endpoint)
		}
	}
	for _, endpoint := range ownerDeviceEndpoints {
		genesisDevices = append(
			genesisDevices,
			mustSystemMemberDevice(t, endpoint, station),
		)
	}
	genesisRoutes := append([]valueobject.Endpoint{bot}, ownerDeviceEndpoints...)
	genesisDeliveries := make([]valueobject.PreparedDelivery, 0, len(genesisRoutes))
	for index, endpoint := range genesisRoutes {
		delivery, err := valueobject.NewPreparedDelivery(
			endpoint,
			station,
			valueobject.DeliveryKindConversation,
			[]byte("bot-direct-genesis-"+string(rune('a'+index))),
		)
		if err != nil {
			t.Fatalf("genesis delivery: %v", err)
		}
		genesisDeliveries = append(genesisDeliveries, delivery)
	}
	conversation, _, err := aggregate.CreateDirect(aggregate.CreateInput{
		AuthorityStation: station,
		FederationID:     "federation-bot",
		AuthorityEpoch:   1,
		Participants: []aggregate.Participant{
			{Actor: bot.Actor, HomeStation: station},
			{Actor: ownerEndpoint.Actor, HomeStation: station},
		},
		Devices:      genesisDevices,
		CommandID:    "bot-direct-create",
		Creator:      bot,
		Deliveries:   genesisDeliveries,
		EventPayload: []byte("bot-direct-created"),
		CreatedAt:    time.Date(2026, time.September, 6, 10, 0, 0, 0, time.UTC),
		EventSealer:  systemSealer{},
	})
	if err != nil {
		t.Fatalf("CreateDirect: %v", err)
	}
	grant := &scriptedSystemGrant{}
	inbox := &recordingDeviceInbox{}
	outbox := &recordingFederationOutbox{}
	commits := &recordingCommitments{}
	identityRoutes := ownerDevices
	if len(identityRoutes) == 0 {
		identityRoutes = []ports.EndpointRoute{
			{Endpoint: ownerEndpoint, HomeStation: station},
		}
	}
	tx := ports.Transaction{
		Repositories: repository.Repositories{
			Authority:      &systemAuthorityRepo{snapshot: conversation.Snapshot()},
			Events:         &systemEventRepo{},
			Receipts:       &systemReceiptRepo{},
			AuthorityPlans: noopPlanRepo{},
		},
		Identity:               systemIdentity{routes: identityRoutes},
		Federation:             systemFederation{},
		SystemSender:           grant,
		DeviceInbox:            inbox,
		FederationOutbox:       outbox,
		DeliveryCommitments:    commits,
		ObjectGrants:           noopObjectGrants{},
		KeyPackageReservations: noopKeyPackages{},
	}
	notifier := &recordingNotifier{}
	service, err := NewService(
		immediateUnitOfWork{transaction: &tx},
		station,
		fixedSystemClock{now: time.Date(2026, time.September, 6, 11, 0, 0, 0, time.UTC)},
		fixedIDGenerator{},
		systemStateEncoder{},
		systemDeviceEventEncoder{},
		systemCursorEncoder{},
		systemLeaveEncoder{},
		systemProposalEncoder{},
		notifier,
		systemSealer{},
	)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return &systemHarness{
		conversationID: conversation.ID(),
		station:        station,
		bot:            bot,
		owner:          ownerEndpoint,
		tx:             &tx,
		grant:          grant,
		inbox:          inbox,
		outbox:         outbox,
		commits:        commits,
		notify:         notifier,
		service:        service,
	}
}

func mustSystemMemberDevice(
	t *testing.T,
	endpoint valueobject.Endpoint,
	station valueobject.StationID,
) entity.MemberDevice {
	t.Helper()
	device, err := entity.NewMemberDevice(endpoint, station, 1)
	if err != nil {
		t.Fatalf("NewMemberDevice: %v", err)
	}
	return device
}

func validSystemRequest(harness *systemHarness) SystemMessageRequest {
	payload, err := proto.Marshal(&chat.DirectServicePlaintextPayload{
		FallbackText: "任务已完成",
	})
	if err != nil {
		panic(err)
	}
	return SystemMessageRequest{
		ConversationID: harness.conversationID,
		Bot:            harness.bot.Actor,
		Owner:          harness.owner.Actor,
		CommandID:      "bot-command-1",
		MessageID:      "bot-message-1",
		Payload:        payload,
	}
}

func TestDeliverSystemMessageCommitsOwnerDeliveryViaApplicationPort(t *testing.T) {
	harness := newSystemHarness(t, nil)
	request := validSystemRequest(harness)

	result, err := harness.service.DeliverSystemMessage(context.Background(), request)
	if err != nil {
		t.Fatalf("DeliverSystemMessage() error = %v", err)
	}
	if result.Event.Sequence != 2 {
		t.Fatalf("event sequence = %d, want 2 chained after genesis", result.Event.Sequence)
	}
	if len(harness.grant.calls) != 1 {
		t.Fatalf("grant checks = %d, want 1", len(harness.grant.calls))
	}
	call := harness.grant.calls[0]
	if call.bot != request.Bot || call.owner != request.Owner ||
		call.conversation != request.ConversationID {
		t.Fatalf("grant call = %+v, want exact {bot, owner, conversation}", call)
	}
	if len(harness.inbox.intents) != 1 {
		t.Fatalf("device inbox intents = %d, want 1", len(harness.inbox.intents))
	}
	if len(harness.outbox.intents) != 0 {
		t.Fatalf("federation outbox intents = %d, want 0 (home-local v1)", len(harness.outbox.intents))
	}
	intent := harness.inbox.intents[0]
	if intent.Recipient.Actor != request.Owner ||
		intent.PayloadKind != ports.DeviceInboxPayloadConversationEvent {
		t.Fatalf("inbox intent = %+v, want owner conversation event", intent)
	}
	var delivery chat.DeviceEventDelivery
	if err := proto.Unmarshal(intent.OpaquePayload, &delivery); err != nil {
		t.Fatalf("decode delivery: %v", err)
	}
	if delivery.PayloadKind !=
		chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_DIRECT_SERVICE_PLAINTEXT {
		t.Fatalf("delivery kind = %v, want DIRECT_SERVICE_PLAINTEXT", delivery.PayloadKind)
	}
	message := delivery.GetEvent().GetMessageCommitted()
	if message.ContentKind !=
		chat.MessagingContentKind_MESSAGING_CONTENT_KIND_SYSTEM ||
		message.DeliverySecurity !=
			chat.MessageDeliverySecurity_MESSAGE_DELIVERY_SECURITY_SERVICE_PLAINTEXT {
		t.Fatalf("fact = %+v, want SYSTEM/SERVICE_PLAINTEXT", message)
	}
	if string(delivery.EndpointPayload) != string(request.Payload) {
		t.Fatal("endpoint payload must be the readable service payload")
	}
	if len(harness.commits.commitments) != 1 ||
		harness.commits.commitments[0].PayloadKind !=
			valueobject.DeliveryKindDirectServicePlaintext ||
		!harness.commits.commitments[0].RequiredRecipient {
		t.Fatalf(
			"commitments = %+v, want one required service-plaintext owner commitment",
			harness.commits.commitments,
		)
	}
	if len(harness.notify.deliveries) != 1 ||
		harness.notify.deliveries[0].Recipient.Actor != request.Owner {
		t.Fatalf("post-commit deliveries = %+v, want owner wake", harness.notify.deliveries)
	}
}

func TestDeliverSystemMessageFansOutToEveryOwnerDevice(t *testing.T) {
	first := valueobject.Endpoint{Actor: "ptid:owner-alice", Device: "owner-mobile"}
	second := valueobject.Endpoint{Actor: "ptid:owner-alice", Device: "owner-desktop"}
	routes := []ports.EndpointRoute{
		{Endpoint: second, HomeStation: "station-a"},
		{Endpoint: first, HomeStation: "station-a"},
	}
	harness := newSystemHarness(t, routes)

	result, err := harness.service.DeliverSystemMessage(
		context.Background(),
		validSystemRequest(harness),
	)
	if err != nil {
		t.Fatalf("DeliverSystemMessage() error = %v", err)
	}
	if result.Event.Sequence != 2 {
		t.Fatalf("event sequence = %d, want 2", result.Event.Sequence)
	}
	if len(harness.inbox.intents) != 2 {
		t.Fatalf("device inbox intents = %d, want one per owner device", len(harness.inbox.intents))
	}
	for _, intent := range harness.inbox.intents {
		if intent.Recipient.Actor != "ptid:owner-alice" || intent.Recipient.Device == "" {
			t.Fatalf("unexpected fan-out recipient %+v", intent.Recipient)
		}
	}
}

func TestDeliverSystemMessageRejectedWithoutGrant(t *testing.T) {
	harness := newSystemHarness(t, nil)
	harness.grant.deny = conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		"test.system_grant",
		"grant",
		"bot is not authorized for this owner conversation",
	)

	_, err := harness.service.DeliverSystemMessage(
		context.Background(),
		validSystemRequest(harness),
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("error = %v, want Unauthorized from the grant port", err)
	}
	if len(harness.inbox.intents) != 0 || len(harness.commits.commitments) != 0 ||
		len(harness.notify.deliveries) != 0 {
		t.Fatal("denied grant must produce no deliveries, commitments, or notifications")
	}
}

func TestDeliverSystemMessageRejectsFederatedOwnerRouting(t *testing.T) {
	federated := []ports.EndpointRoute{{
		Endpoint:    valueobject.Endpoint{Actor: "ptid:owner-alice", Device: "owner-remote"},
		HomeStation: "station-b",
	}}
	harness := newSystemHarness(t, federated)

	_, err := harness.service.DeliverSystemMessage(
		context.Background(),
		validSystemRequest(harness),
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("error = %v, want Unauthorized for federated owner route", err)
	}
	if len(harness.inbox.intents) != 0 {
		t.Fatal("federated owner routing must not enqueue a kind-8 delivery")
	}
}

func TestDeliverSystemMessageRequiresWiredGrantPort(t *testing.T) {
	harness := newSystemHarness(t, nil)
	harness.tx.SystemSender = nil

	_, err := harness.service.DeliverSystemMessage(
		context.Background(),
		validSystemRequest(harness),
	)
	if !conversationdomain.IsCode(err, conversationdomain.ErrorCodeUnauthorized) {
		t.Fatalf("error = %v, want Unauthorized when the system grant port is absent", err)
	}
}
