package federation

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	conversationports "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	authorityCommandFrameDomain   = "conversation-authority-command"
	authorityResultFrameDomain    = "conversation-authority-result"
	deviceDeliveryFrameDomain     = "conversation-device-delivery"
	deliveryReceiptFrameDomain    = "conversation-delivery-receipt"
	readCursorFrameDomain         = "conversation-read-cursor"
	typingFrameDomain             = "conversation-typing"
	conversationTypingVersion     = uint32(1)
	conversationReadCursorVersion = uint32(1)
)

// Sender converts canonical Conversation protobufs into immutable, signed
// Federation frames. The caller supplies a transaction-bound outbox writer.
type Sender struct {
	localStationPeerID string
	signer             federationdelivery.Signer
	clock              federationdelivery.Clock
	frameLifetime      time.Duration
}

// NewSender constructs the typed Conversation Federation sender.
func NewSender(
	localStationPeerID string,
	signer federationdelivery.Signer,
	clock federationdelivery.Clock,
	frameLifetime time.Duration,
) (*Sender, error) {
	if strings.TrimSpace(localStationPeerID) == "" ||
		localStationPeerID != strings.TrimSpace(localStationPeerID) ||
		signer == nil ||
		clock == nil ||
		frameLifetime <= 0 ||
		frameLifetime > federationdelivery.DefaultFramePolicy(localStationPeerID).MaxLifetime {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"create Conversation Federation sender",
			fmt.Errorf("local Station, signer, clock, and bounded frame lifetime are required"),
		)
	}
	return &Sender{
		localStationPeerID: localStationPeerID,
		signer:             signer,
		clock:              clock,
		frameLifetime:      frameLifetime,
	}, nil
}

// TypingSender signs and immediately dispatches ephemeral typing frames.
type TypingSender struct {
	sender    *Sender
	transport TypingTransport
}

// TypingTransport exposes only the shared Federation runtime's ephemeral path.
type TypingTransport interface {
	DeliverConversationTyping(
		context.Context,
		*federationdelivery.Frame,
	) (federationdelivery.Result, error)
}

// NewTypingSender creates the no-outbox, no-retry Conversation typing sender.
func NewTypingSender(
	sender *Sender,
	transport TypingTransport,
) (*TypingSender, error) {
	if sender == nil || transport == nil {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"create Conversation typing sender",
			fmt.Errorf("frame signer and ephemeral transport are required"),
		)
	}

	return &TypingSender{sender: sender, transport: transport}, nil
}

// DispatchTyping sends one signed frame directly and never writes or retries it.
func (s *TypingSender) DispatchTyping(
	ctx context.Context,
	target valueobject.StationID,
	signal interactionapp.FederatedTypingSignal,
) (interactionapp.FederatedTypingResult, error) {
	wire, err := typingSignalToWire(signal)
	if err != nil {
		return interactionapp.FederatedTypingResult{}, err
	}
	payload, err := canonicalPayloadBytes(wire)
	if err != nil {
		return interactionapp.FederatedTypingResult{}, err
	}
	payloadID := typingPayloadID(wire)
	issuedAt := s.sender.clock.Now().UTC()
	frame, err := s.sender.signedFrame(
		ctx,
		federationdelivery.PayloadKindConversationTyping,
		string(target),
		payloadID,
		typingFrameDomain+":"+payloadID,
		conversationOrderingKey(typingFrameDomain, wire.GetConversationId()),
		0,
		payload,
		issuedAt,
		wire.GetExpiresAt().AsTime().UTC(),
	)
	if err != nil {
		return interactionapp.FederatedTypingResult{}, err
	}
	result, err := s.transport.DeliverConversationTyping(ctx, frame)
	if err != nil {
		return interactionapp.FederatedTypingResult{}, err
	}
	switch {
	case result.Disposition == federationdelivery.DispositionAccepted,
		result.Disposition == federationdelivery.DispositionDuplicate:
		return interactionapp.FederatedTypingResult{
			Accepted:  true,
			Duplicate: result.Disposition == federationdelivery.DispositionDuplicate,
			Attempted: 1,
			Delivered: 1,
		}, nil
	case result.Disposition == federationdelivery.DispositionTerminal &&
		result.ErrorCode == federationdelivery.FrameErrorOverloaded:
		return interactionapp.FederatedTypingResult{
			Accepted:  true,
			Attempted: 1,
			Dropped:   1,
		}, nil
	default:
		return interactionapp.FederatedTypingResult{}, federationdelivery.NewError(
			federationdelivery.FailureDomainRejected,
			"dispatch Conversation typing",
			fmt.Errorf(
				"receiver disposition=%s error_code=%s",
				result.Disposition,
				result.ErrorCode,
			),
		)
	}
}

// EnqueueAuthorityCommand writes one exact D-17 proposal to a transaction-bound outbox.
func (s *Sender) EnqueueAuthorityCommand(
	ctx context.Context,
	outbox federationdelivery.OutboxWriter,
	proposal *chatmodel.ConversationCommandProposal,
	orderingSequence int64,
) (federationdelivery.EnqueueResult, error) {
	command, commandErr := ParseProposalCommand(proposal)
	if outbox == nil || commandErr != nil {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation authority command",
			fmt.Errorf("outbox and proposal command are required"),
		)
	}
	if proposal.GetHomeStationPeerId() != s.localStationPeerID ||
		strings.TrimSpace(proposal.GetAuthorityStationPeerId()) == "" ||
		command.AuthorityStationPeerID != proposal.GetAuthorityStationPeerId() ||
		orderingSequence <= 0 {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation authority command",
			fmt.Errorf("proposal route and positive ordering sequence are required"),
		)
	}
	issuedAt := time.UnixMilli(proposal.GetCreatedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(proposal.GetExpiresAtUnixMs()).UTC()
	payload, err := canonicalPayloadBytes(proposal)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	frame, err := s.signedFrame(
		ctx,
		federationdelivery.PayloadKindConversationAuthorityCommand,
		proposal.GetAuthorityStationPeerId(),
		command.CommandID,
		"",
		conversationOrderingKey(authorityCommandFrameDomain, command.ConversationID),
		orderingSequence,
		payload,
		issuedAt,
		expiresAt,
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	return outbox.Enqueue(ctx, frame, s.clock.Now().UTC())
}

// EnqueueAuthorityResult writes the durable authority result addressed to the
// proposal's Home Station. Its identity and timestamps remain stable on replay.
func (s *Sender) EnqueueAuthorityResult(
	ctx context.Context,
	outbox federationdelivery.OutboxWriter,
	proposal *chatmodel.ConversationCommandProposal,
	result *chatmodel.ConversationCommandProposalResult,
) (federationdelivery.EnqueueResult, error) {
	command, commandErr := ParseProposalCommand(proposal)
	if outbox == nil ||
		commandErr != nil ||
		len(proposal.GetCommandSha256()) != sha256.Size ||
		result == nil ||
		result.GetCommandId() != command.CommandID {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation authority result",
			fmt.Errorf("outbox, proposal command hash, and matching result are required"),
		)
	}
	if proposal.GetAuthorityStationPeerId() != s.localStationPeerID ||
		strings.TrimSpace(proposal.GetHomeStationPeerId()) == "" {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation authority result",
			fmt.Errorf("result route is required"),
		)
	}
	if err := validateAuthorityOutcome(
		proposal,
		AuthorityCommandOutcome{Result: result},
	); err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	if result.GetRetryable() {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidResult,
			"enqueue Conversation authority result",
			fmt.Errorf("retryable outcomes must retain the original command frame"),
		)
	}
	if result.GetAccepted() &&
		result.GetEvent().GetAuthorityStationPeerId() != s.localStationPeerID {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation authority result",
			fmt.Errorf("committed event does not identify the local authority Station"),
		)
	}
	state := chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED
	if result.GetAccepted() {
		state = chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED
	}
	delivery := &chatmodel.ConversationCommandResultDelivery{
		ConversationId: command.ConversationID,
		CommandId:      command.CommandID,
		State:          state,
		Result:         proto.Clone(result).(*chatmodel.ConversationCommandProposalResult),
	}
	payload, err := canonicalPayloadBytes(delivery)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	payloadID := authorityResultPayloadID(
		delivery,
		payload,
		proposal.GetCommandSha256(),
	)
	issuedAt := time.UnixMilli(proposal.GetCreatedAtUnixMs()).UTC()
	frame, err := s.signedFrame(
		ctx,
		federationdelivery.PayloadKindConversationAuthorityResult,
		proposal.GetHomeStationPeerId(),
		payloadID,
		"",
		conversationOrderingKey(authorityResultFrameDomain, delivery.GetConversationId()),
		0,
		payload,
		issuedAt,
		issuedAt.Add(s.frameLifetime),
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	return outbox.Enqueue(ctx, frame, s.clock.Now().UTC())
}

// EnqueueDeliveryReceipt durably returns one exact device-consumption receipt
// from its Home Station to the Conversation authority.
func (s *Sender) EnqueueDeliveryReceipt(
	ctx context.Context,
	outbox federationdelivery.OutboxWriter,
	authorityStationPeerID string,
	receipt *chatmodel.DeviceConsumptionReceipt,
) (federationdelivery.EnqueueResult, error) {
	if outbox == nil ||
		receipt == nil ||
		receipt.GetConsumer() == nil ||
		receipt.GetReceiptId() == "" ||
		receipt.GetConversationId() == "" ||
		receipt.GetEventId() == "" ||
		receipt.GetConsumer().GetPtid() == "" ||
		receipt.GetConsumer().GetDeviceId() == "" ||
		receipt.GetEventSequence() <= 0 ||
		receipt.GetLaneSequence() <= 0 ||
		len(receipt.GetPayloadSha256()) != sha256.Size ||
		receipt.GetConsumedAt() == nil ||
		!receipt.GetConsumedAt().IsValid() {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation delivery receipt",
			fmt.Errorf("outbox and complete device-consumption receipt are required"),
		)
	}
	if strings.TrimSpace(authorityStationPeerID) == "" ||
		authorityStationPeerID == s.localStationPeerID {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation delivery receipt",
			fmt.Errorf("remote authority Station is required"),
		)
	}
	payload, err := canonicalPayloadBytes(receipt)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	issuedAt := s.clock.Now().UTC()
	frame, err := s.signedFrame(
		ctx,
		federationdelivery.PayloadKindConversationDeliveryReceipt,
		authorityStationPeerID,
		receipt.GetReceiptId(),
		deliveryReceiptFrameDomain+":"+receipt.GetReceiptId(),
		conversationOrderingKey(
			deliveryReceiptFrameDomain,
			receipt.GetConversationId(),
		),
		0,
		payload,
		issuedAt,
		issuedAt.Add(s.frameLifetime),
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}

	return outbox.Enqueue(ctx, frame, s.clock.Now().UTC())
}

// EnqueueReadCursor durably forwards one actor-scoped cursor from its Home
// Station to the Conversation authority.
func (s *Sender) EnqueueReadCursor(
	ctx context.Context,
	outbox federationdelivery.OutboxWriter,
	authorityStationPeerID string,
	cursor *chatmodel.FederatedConversationReadCursor,
) (federationdelivery.EnqueueResult, error) {
	if outbox == nil ||
		cursor == nil ||
		cursor.GetFormatVersion() != conversationReadCursorVersion ||
		cursor.GetReader() == nil ||
		cursor.GetFederationId() == "" ||
		cursor.GetConversationId() == "" ||
		cursor.GetAuthorityStationPeerId() != authorityStationPeerID ||
		cursor.GetAuthorityEpoch() == 0 ||
		cursor.GetReader().GetPtid() == "" ||
		cursor.GetReader().GetDeviceId() == "" ||
		cursor.GetReaderHomeStationPeerId() != s.localStationPeerID ||
		cursor.GetLastReadSequence() <= 0 {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation read cursor",
			fmt.Errorf("outbox and complete read cursor are required"),
		)
	}
	if strings.TrimSpace(authorityStationPeerID) == "" ||
		authorityStationPeerID == s.localStationPeerID {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation read cursor",
			fmt.Errorf("remote authority Station is required"),
		)
	}
	payload, err := canonicalPayloadBytes(cursor)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	payloadID, err := ReadCursorPayloadID(cursor)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	issuedAt := s.clock.Now().UTC()
	frame, err := s.signedFrame(
		ctx,
		federationdelivery.PayloadKindConversationReadCursor,
		authorityStationPeerID,
		payloadID,
		readCursorFrameDomain+":"+payloadID,
		readCursorOrderingKey(cursor),
		cursor.GetLastReadSequence(),
		payload,
		issuedAt,
		issuedAt.Add(s.frameLifetime),
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}

	return outbox.Enqueue(ctx, frame, s.clock.Now().UTC())
}

// EnqueueDeviceDelivery forwards a target-local Device Inbox intent. The
// target Home Station owns lane allocation and all queue lifecycle state.
func (s *Sender) EnqueueDeviceDelivery(
	ctx context.Context,
	outbox federationdelivery.OutboxWriter,
	federationIntent conversationports.FederationOutboxIntent,
) (federationdelivery.EnqueueResult, error) {
	if outbox == nil ||
		strings.TrimSpace(string(federationIntent.Recipient.Actor)) == "" ||
		strings.TrimSpace(string(federationIntent.Recipient.Device)) == "" {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation device delivery",
			fmt.Errorf("transaction-bound outbox and complete PTID/device route are required"),
		)
	}
	payloadType, err := deviceInboxPayloadType(federationIntent.PayloadKind)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	item := &chatmodel.DurableDeviceInboxItem{
		ItemId: string(federationIntent.IntentID),
		Recipient: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: string(federationIntent.Recipient.Actor),
			},
			DeviceId: string(federationIntent.Recipient.Device),
		},
		EventId:        string(federationIntent.EventID),
		ConversationId: string(federationIntent.ConversationID),
		IdempotencyKey: federationIntent.IdempotencyKey,
		PayloadType:    payloadType,
		OpaquePayload:  append([]byte(nil), federationIntent.OpaquePayload...),
		PayloadSha256:  federationIntent.PayloadHash.Bytes(),
		FirstQueuedAt:  timestamppb.New(federationIntent.CreatedAt.UTC()),
	}
	intent, orderingSequence, err := canonicalDeviceDelivery(
		item,
		s.localStationPeerID,
		federationIntent.EventSequence,
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation device delivery",
			err,
		)
	}
	if intent.EventSequence != federationIntent.EventSequence {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation device delivery",
			fmt.Errorf("event sequence does not match the canonical payload"),
		)
	}
	targetStationPeerID := string(federationIntent.TargetStation)
	if strings.TrimSpace(targetStationPeerID) == "" {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation device delivery",
			fmt.Errorf("target Station is required"),
		)
	}
	issuedAt := item.GetFirstQueuedAt().AsTime().UTC()
	expiresAt := issuedAt.Add(s.frameLifetime)
	payload, err := canonicalPayloadBytes(item)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	frame, err := s.signedFrame(
		ctx,
		federationdelivery.PayloadKindConversationDeviceDelivery,
		targetStationPeerID,
		item.GetItemId(),
		item.GetIdempotencyKey(),
		deviceOrderingKey(
			string(intent.Recipient.Actor),
			string(intent.Recipient.Device),
			string(intent.ConversationID),
			string(intent.PayloadKind),
			intent.IntentID,
		),
		orderingSequence,
		payload,
		issuedAt,
		expiresAt,
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	return outbox.Enqueue(ctx, frame, s.clock.Now().UTC())
}

func deviceInboxPayloadType(
	kind conversationports.DeviceInboxPayloadKind,
) (chatmodel.DeviceInboxPayloadType, error) {
	switch kind {
	case conversationports.DeviceInboxPayloadConversationEvent:
		return chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_CONVERSATION_EVENT, nil
	case conversationports.DeviceInboxPayloadDeviceReceipt:
		return chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DEVICE_RECEIPT, nil
	default:
		return chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_UNSPECIFIED,
			federationdelivery.NewError(
				federationdelivery.FailureInvalidFrame,
				"enqueue Conversation device delivery",
				fmt.Errorf("payload kind is not owned by Conversation delivery"),
			)
	}
}

func typingSignalToWire(
	signal interactionapp.FederatedTypingSignal,
) (*chatmodel.FederatedConversationTypingSignal, error) {
	phase := chatmodel.FederatedConversationTypingPhase_FEDERATED_CONVERSATION_TYPING_PHASE_UNSPECIFIED
	switch signal.Phase {
	case interactionapp.FederatedTypingPhaseAuthorityAdmission:
		phase = chatmodel.FederatedConversationTypingPhase_FEDERATED_CONVERSATION_TYPING_PHASE_AUTHORITY_ADMISSION
	case interactionapp.FederatedTypingPhaseHomeFanout:
		phase = chatmodel.FederatedConversationTypingPhase_FEDERATED_CONVERSATION_TYPING_PHASE_HOME_FANOUT
	default:
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"encode Conversation typing signal",
			fmt.Errorf("typing phase is invalid"),
		)
	}
	if signal.FederationID == "" ||
		signal.ConversationID == "" ||
		signal.AuthorityStation == "" ||
		signal.AuthorityEpoch <= 0 ||
		signal.Sender.Validate() != nil ||
		signal.SenderHomeStation == "" ||
		signal.Generation == 0 ||
		signal.ExpiresAt.IsZero() {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"encode Conversation typing signal",
			fmt.Errorf("typing signal is incomplete"),
		)
	}
	recipients := make([]string, 0, len(signal.Recipients))
	for _, recipient := range signal.Recipients {
		recipients = append(recipients, string(recipient))
	}

	return &chatmodel.FederatedConversationTypingSignal{
		FormatVersion:  conversationTypingVersion,
		Phase:          phase,
		FederationId:   string(signal.FederationID),
		ConversationId: string(signal.ConversationID),
		AuthorityStationPeerId: string(
			signal.AuthorityStation,
		),
		AuthorityEpoch: uint64(signal.AuthorityEpoch),
		Sender: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: string(signal.Sender.Actor),
			},
			DeviceId: string(signal.Sender.Device),
		},
		SenderHomeStationPeerId: string(signal.SenderHomeStation),
		PulseGeneration:         signal.Generation,
		ExpiresAt:               timestamppb.New(signal.ExpiresAt.UTC()),
		IsTyping:                signal.IsTyping,
		RecipientActorPtids:     recipients,
	}, nil
}

func typingPayloadID(signal *chatmodel.FederatedConversationTypingSignal) string {
	recipients := strings.Join(signal.GetRecipientActorPtids(), ",")

	return typingFrameDomain + ":" + stableIdentifier(
		signal.GetFederationId(),
		signal.GetConversationId(),
		signal.GetAuthorityStationPeerId(),
		strconv.FormatUint(signal.GetAuthorityEpoch(), 10),
		signal.GetSender().GetActor().GetPtid(),
		signal.GetSender().GetDeviceId(),
		signal.GetSenderHomeStationPeerId(),
		strconv.FormatUint(signal.GetPulseGeneration(), 10),
		strconv.FormatBool(signal.GetIsTyping()),
		strconv.FormatInt(signal.GetExpiresAt().AsTime().UnixNano(), 10),
		strconv.Itoa(int(signal.GetPhase())),
		recipients,
	)
}

func (s *Sender) signedFrame(
	ctx context.Context,
	kind federationdelivery.PayloadKind,
	targetStationPeerID string,
	payloadID string,
	idempotencyKey string,
	orderingKey string,
	orderingSequence int64,
	payload []byte,
	issuedAt time.Time,
	expiresAt time.Time,
) (*federationdelivery.Frame, error) {
	if strings.TrimSpace(targetStationPeerID) == "" ||
		strings.TrimSpace(payloadID) == "" ||
		strings.TrimSpace(orderingKey) == "" ||
		orderingSequence < 0 ||
		len(payload) == 0 ||
		issuedAt.IsZero() ||
		expiresAt.IsZero() {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"build Conversation Federation frame",
			fmt.Errorf("complete route, ordering, payload, and timestamps are required"),
		)
	}
	frameIdentity := stableIdentifier(
		kind.String(),
		s.localStationPeerID,
		targetStationPeerID,
		payloadID,
	)
	if idempotencyKey == "" {
		idempotencyKey = "conversation-delivery:" + frameIdentity
	}
	frame := &federationdelivery.Frame{
		FormatVersion:       federationdelivery.CurrentFormatVersion,
		FrameId:             "conversation-frame:" + frameIdentity,
		SourceStationPeerId: s.localStationPeerID,
		TargetStationPeerId: targetStationPeerID,
		IdempotencyKey:      idempotencyKey,
		PayloadKind:         kind,
		PayloadId:           payloadID,
		OrderingKey:         orderingKey,
		OrderingSequence:    orderingSequence,
		OpaquePayload:       append([]byte(nil), payload...),
		IssuedAt:            timestamppb.New(issuedAt.UTC()),
		ExpiresAt:           timestamppb.New(expiresAt.UTC()),
	}
	if err := federationdelivery.SignFrame(
		ctx,
		frame,
		federationdelivery.DefaultFramePolicy(targetStationPeerID),
		s.signer,
	); err != nil {
		return nil, err
	}
	return frame, nil
}

func canonicalPayloadBytes(message proto.Message) ([]byte, error) {
	if message == nil {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"encode Conversation Federation payload",
			fmt.Errorf("payload is nil"),
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"encode Conversation Federation payload",
			err,
		)
	}
	return encoded, nil
}

func stableIdentifier(parts ...string) string {
	hasher := sha256.New()
	var size [8]byte
	for _, part := range parts {
		binary.BigEndian.PutUint64(size[:], uint64(len(part)))
		_, _ = hasher.Write(size[:])
		_, _ = hasher.Write([]byte(part))
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func conversationOrderingKey(domain string, conversationID string) string {
	return domain + ":" + conversationID
}

// ReadCursorPayloadID returns the deterministic identity shared by the sender,
// durable outbox replay check, and receiver validation.
func ReadCursorPayloadID(
	cursor *chatmodel.FederatedConversationReadCursor,
) (string, error) {
	if cursor == nil || cursor.GetReader() == nil {
		return "", federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"identify Conversation read cursor",
			fmt.Errorf("cursor and reader are required"),
		)
	}
	return stableIdentifier(
		cursor.GetFederationId(),
		cursor.GetConversationId(),
		cursor.GetAuthorityStationPeerId(),
		strconv.FormatUint(cursor.GetAuthorityEpoch(), 10),
		cursor.GetReader().GetPtid(),
		cursor.GetReader().GetDeviceId(),
		cursor.GetReaderHomeStationPeerId(),
		strconv.FormatInt(cursor.GetLastReadSequence(), 10),
	), nil
}

func readCursorOrderingKey(cursor *chatmodel.FederatedConversationReadCursor) string {
	return readCursorFrameDomain + ":" + stableIdentifier(
		cursor.GetConversationId(),
		cursor.GetAuthorityStationPeerId(),
		strconv.FormatUint(cursor.GetAuthorityEpoch(), 10),
		cursor.GetReader().GetPtid(),
		cursor.GetReader().GetDeviceId(),
	)
}

func authorityResultPayloadID(
	delivery *chatmodel.ConversationCommandResultDelivery,
	payload []byte,
	originatingCommandSHA256 []byte,
) string {
	return authorityResultFrameDomain + ":" +
		hex.EncodeToString(originatingCommandSHA256) + ":" +
		stableIdentifier(
			delivery.GetCommandId(),
			hex.EncodeToString(federationdelivery.PayloadSHA256(payload)),
		)
}

func deviceOrderingKey(
	actorPTID string,
	deviceID string,
	conversationID string,
	payloadKind string,
	payloadID string,
) string {
	key := deviceDeliveryFrameDomain + ":" +
		actorPTID + ":" +
		deviceID + ":" +
		conversationID + ":" +
		payloadKind
	if payloadKind == string(conversationports.DeviceInboxPayloadDeviceReceipt) {
		key += ":" + payloadID
	}

	return key
}
