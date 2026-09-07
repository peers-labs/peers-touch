package federation

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	authorityCommandFrameDomain = "conversation-authority-command"
	authorityResultFrameDomain  = "conversation-authority-result"
	deviceDeliveryFrameDomain   = "conversation-device-delivery"
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

// EnqueueAuthorityCommand writes one exact D-17 proposal to a transaction-bound outbox.
func (s *Sender) EnqueueAuthorityCommand(
	ctx context.Context,
	outbox federationdelivery.OutboxWriter,
	proposal *chatmodel.ConversationCommandProposal,
	orderingSequence int64,
) (federationdelivery.EnqueueResult, error) {
	if outbox == nil || proposal == nil || proposal.GetCommand() == nil {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation authority command",
			fmt.Errorf("outbox and proposal command are required"),
		)
	}
	if proposal.GetHomeStationPeerId() != s.localStationPeerID ||
		strings.TrimSpace(proposal.GetAuthorityStationPeerId()) == "" ||
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
		proposal.GetCommand().GetCommandId(),
		"",
		conversationOrderingKey(authorityCommandFrameDomain, proposal.GetCommand().GetConversationId()),
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
	orderingSequence int64,
) (federationdelivery.EnqueueResult, error) {
	if outbox == nil ||
		proposal == nil ||
		proposal.GetCommand() == nil ||
		result == nil ||
		result.GetCommandId() != proposal.GetCommand().GetCommandId() {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation authority result",
			fmt.Errorf("outbox, proposal, and matching result are required"),
		)
	}
	if proposal.GetAuthorityStationPeerId() != s.localStationPeerID ||
		strings.TrimSpace(proposal.GetHomeStationPeerId()) == "" ||
		orderingSequence <= 0 {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation authority result",
			fmt.Errorf("result route and positive ordering sequence are required"),
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
		result.GetCommittedEvent().GetCommittedByStationPeerId() != s.localStationPeerID {
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
		ConversationId: proposal.GetCommand().GetConversationId(),
		CommandId:      proposal.GetCommand().GetCommandId(),
		State:          state,
		Result:         proto.Clone(result).(*chatmodel.ConversationCommandProposalResult),
	}
	payload, err := canonicalPayloadBytes(delivery)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	issuedAt := time.UnixMilli(proposal.GetCreatedAtUnixMs()).UTC()
	frame, err := s.signedFrame(
		ctx,
		federationdelivery.PayloadKindConversationAuthorityResult,
		proposal.GetHomeStationPeerId(),
		result.GetCommandId(),
		"",
		conversationOrderingKey(authorityResultFrameDomain, delivery.GetConversationId()),
		orderingSequence,
		payload,
		issuedAt,
		issuedAt.Add(s.frameLifetime),
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	return outbox.Enqueue(ctx, frame, s.clock.Now().UTC())
}

// EnqueueDeviceDelivery forwards one canonical device inbox item while
// preserving its per-device lane sequence and immutable expiry.
func (s *Sender) EnqueueDeviceDelivery(
	ctx context.Context,
	outbox federationdelivery.OutboxWriter,
	targetStationPeerID string,
	item *chatmodel.DurableDeviceInboxItem,
) (federationdelivery.EnqueueResult, error) {
	if outbox == nil ||
		item == nil ||
		item.GetRecipient() == nil ||
		item.GetRecipient().GetActor() == nil ||
		strings.TrimSpace(item.GetRecipient().GetActor().GetPtid()) == "" ||
		strings.TrimSpace(item.GetRecipient().GetDeviceId()) == "" {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"enqueue Conversation device delivery",
			fmt.Errorf("outbox and complete PTID/device route are required"),
		)
	}
	if strings.TrimSpace(targetStationPeerID) == "" ||
		item.GetLaneSequence() <= 0 ||
		item.GetFirstQueuedAt() == nil ||
		!item.GetFirstQueuedAt().IsValid() {
		return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidFrame,
			"enqueue Conversation device delivery",
			fmt.Errorf("target, lane sequence, and first queued time are required"),
		)
	}
	issuedAt := item.GetFirstQueuedAt().AsTime().UTC()
	expiresAt := issuedAt.Add(s.frameLifetime)
	if item.GetExpiresAt() != nil {
		if !item.GetExpiresAt().IsValid() {
			return federationdelivery.EnqueueResult{}, federationdelivery.NewError(
				federationdelivery.FailureInvalidFrame,
				"enqueue Conversation device delivery",
				fmt.Errorf("device item expiry is invalid"),
			)
		}
		expiresAt = item.GetExpiresAt().AsTime().UTC()
	}
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
			item.GetRecipient().GetActor().GetPtid(),
			item.GetRecipient().GetDeviceId(),
		),
		item.GetLaneSequence(),
		payload,
		issuedAt,
		expiresAt,
	)
	if err != nil {
		return federationdelivery.EnqueueResult{}, err
	}
	return outbox.Enqueue(ctx, frame, s.clock.Now().UTC())
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
		orderingSequence <= 0 ||
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

func deviceOrderingKey(actorPTID string, deviceID string) string {
	return deviceDeliveryFrameDomain + ":" + actorPTID + ":" + deviceID
}
