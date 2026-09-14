package federation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	conversationports "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const (
	conversationCommandProposalVersion = uint32(1)
	maxCommandProposalLifetime         = 5 * time.Minute
	maxProposalClockSkew               = 30 * time.Second
	maxFederatedTypingRecipients       = 256
)

// ReceiverConfig binds the three Conversation payload receivers to their
// identity, governance, authority, follower, and result-store ports.
type ReceiverConfig struct {
	LocalStationPeerID string
	ActorKeys          VerifiedActorDeviceKeyResolver
	Federation         FederationMembershipProjection
	AuthorityCommands  AuthorityCommandPort
	AuthorityResults   AuthorityResultPort
	DeviceDeliveries   DeviceDeliveryPort
	DeliveryReceipts   DeliveryReceiptPort
	Typing             interactionapp.FederatedTypingReceiver
	Sender             *Sender
	Clock              federationdelivery.Clock
}

// Receiver is the typed Conversation adapter registered with shared Federation.
type Receiver struct {
	localStationPeerID string
	actorKeys          VerifiedActorDeviceKeyResolver
	federation         FederationMembershipProjection
	authorityCommands  AuthorityCommandPort
	authorityResults   AuthorityResultPort
	deviceDeliveries   DeviceDeliveryPort
	deliveryReceipts   DeliveryReceiptPort
	typing             interactionapp.FederatedTypingReceiver
	sender             *Sender
	clock              federationdelivery.Clock
}

// NewReceiver validates the complete test-composable Conversation adapter graph.
func NewReceiver(config ReceiverConfig) (*Receiver, error) {
	if strings.TrimSpace(config.LocalStationPeerID) == "" ||
		config.LocalStationPeerID != strings.TrimSpace(config.LocalStationPeerID) ||
		config.ActorKeys == nil ||
		config.Federation == nil ||
		config.AuthorityCommands == nil ||
		config.AuthorityResults == nil ||
		config.DeviceDeliveries == nil ||
		config.DeliveryReceipts == nil ||
		config.Sender == nil ||
		config.Clock == nil {
		return nil, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"create Conversation Federation receiver",
			fmt.Errorf("all receiver dependencies are required"),
		)
	}
	return &Receiver{
		localStationPeerID: config.LocalStationPeerID,
		actorKeys:          config.ActorKeys,
		federation:         config.Federation,
		authorityCommands:  config.AuthorityCommands,
		authorityResults:   config.AuthorityResults,
		deviceDeliveries:   config.DeviceDeliveries,
		deliveryReceipts:   config.DeliveryReceipts,
		typing:             config.Typing,
		sender:             config.Sender,
		clock:              config.Clock,
	}, nil
}

// RegisterReceivers binds each Conversation payload kind exactly once.
func RegisterReceivers(
	registry *federationdelivery.Registry,
	receiver *Receiver,
) error {
	if registry == nil || receiver == nil {
		return federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"register Conversation Federation receivers",
			fmt.Errorf("registry and receiver are required"),
		)
	}
	for _, kind := range []federationdelivery.PayloadKind{
		federationdelivery.PayloadKindConversationAuthorityCommand,
		federationdelivery.PayloadKindConversationAuthorityResult,
		federationdelivery.PayloadKindConversationDeviceDelivery,
		federationdelivery.PayloadKindConversationDeliveryReceipt,
		federationdelivery.PayloadKindConversationTyping,
	} {
		if _, exists := registry.Lookup(kind); exists {
			return federationdelivery.NewError(
				federationdelivery.FailureInvalidArgument,
				"register Conversation Federation receivers",
				fmt.Errorf("payload kind %s is already registered", kind),
			)
		}
	}
	if err := federationdelivery.RegisterProtoReceiver(
		registry,
		federationdelivery.PayloadKindConversationAuthorityCommand,
		func() *chatmodel.ConversationCommandProposal {
			return &chatmodel.ConversationCommandProposal{}
		},
		receiver.receiveAuthorityCommand,
	); err != nil {
		return err
	}
	if err := federationdelivery.RegisterProtoReceiver(
		registry,
		federationdelivery.PayloadKindConversationAuthorityResult,
		func() *chatmodel.ConversationCommandResultDelivery {
			return &chatmodel.ConversationCommandResultDelivery{}
		},
		receiver.receiveAuthorityResult,
	); err != nil {
		return err
	}
	if err := federationdelivery.RegisterProtoReceiver(
		registry,
		federationdelivery.PayloadKindConversationDeviceDelivery,
		func() *chatmodel.DurableDeviceInboxItem {
			return &chatmodel.DurableDeviceInboxItem{}
		},
		receiver.receiveDeviceDelivery,
	); err != nil {
		return err
	}
	if err := federationdelivery.RegisterProtoReceiver(
		registry,
		federationdelivery.PayloadKindConversationDeliveryReceipt,
		func() *chatmodel.DeviceConsumptionReceipt {
			return &chatmodel.DeviceConsumptionReceipt{}
		},
		receiver.receiveDeliveryReceipt,
	); err != nil {
		return err
	}

	return federationdelivery.RegisterEphemeralProtoReceiver(
		registry,
		federationdelivery.PayloadKindConversationTyping,
		func() *chatmodel.FederatedConversationTypingSignal {
			return &chatmodel.FederatedConversationTypingSignal{}
		},
		receiver.receiveTyping,
	)
}

func (r *Receiver) receiveAuthorityCommand(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	proposal *chatmodel.ConversationCommandProposal,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	if transaction == nil || transaction.DB() == nil || transaction.Outbox() == nil {
		return federationdelivery.Result{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"receive Conversation authority command",
			fmt.Errorf("transaction-bound database and outbox are required"),
		)
	}
	if err := validateCanonicalFramePayload(frame, proposal); err != nil {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	commandKind, rejection := validateAuthorityProposalShape(
		proposal,
		frame,
		r.localStationPeerID,
		r.clock.Now().UTC(),
	)
	if rejection != nil {
		return r.deliverProposalRejection(ctx, transaction, proposal, frame, *rejection)
	}

	active, err := r.federation.IsActiveStation(
		ctx,
		transaction,
		proposal.GetFederationId(),
		frame.GetSourceStationPeerId(),
	)
	if err != nil {
		return federationdelivery.Result{}, fmt.Errorf(
			"conversation Federation: resolve source Station membership: %w",
			err,
		)
	}
	if !active {
		return r.deliverProposalRejection(
			ctx,
			transaction,
			proposal,
			frame,
			commandRejection{
				code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INACTIVE_FEDERATION_STATION,
			},
		)
	}

	key, err := r.actorKeys.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		transaction,
		proposal.GetActorPtid(),
		frame.GetSourceStationPeerId(),
		proposal.GetActorDeviceId(),
		proposal.GetActorSigningKeyId(),
	)
	if err != nil {
		return federationdelivery.Result{}, fmt.Errorf(
			"conversation Federation: resolve verified actor-device signing key: %w",
			err,
		)
	}
	if key == nil {
		return r.deliverProposalRejection(
			ctx,
			transaction,
			proposal,
			frame,
			commandRejection{
				code:      chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_UNAVAILABLE,
				retryable: true,
			},
		)
	}

	signingBytes, keyCurrentlyRevoked, rejection := verifyProposalActorIdentity(
		proposal,
		commandKind,
		key,
		frame.GetSourceStationPeerId(),
		r.localStationPeerID,
		r.clock.Now().UTC(),
	)
	if rejection != nil {
		return r.deliverProposalRejection(ctx, transaction, proposal, frame, *rejection)
	}
	commandBytes, err := canonicalPayloadBytes(proposal.GetCommand())
	if err != nil {
		return federationdelivery.Result{}, err
	}
	outcome, err := r.authorityCommands.ApplyAuthorityCommand(
		ctx,
		transaction,
		VerifiedAuthorityCommand{
			Proposal:              proto.Clone(proposal).(*chatmodel.ConversationCommandProposal),
			SourceHomeStation:     frame.GetSourceStationPeerId(),
			CanonicalCommandBytes: commandBytes,
			CanonicalSigningBytes: signingBytes,
			VerifiedSigningKey:    proto.Clone(key).(*actormodel.VerifiedActorDeviceSigningKey),
			KeyCurrentlyRevoked:   keyCurrentlyRevoked,
		},
	)
	if err != nil {
		return federationdelivery.Result{}, fmt.Errorf(
			"conversation Federation: apply authority command: %w",
			err,
		)
	}
	if err := validateAuthorityOutcome(proposal, outcome); err != nil {
		return federationdelivery.Result{}, err
	}
	// A retryable disposition rolls back the target inbox transaction and keeps
	// the source outbox row eligible for lease-fenced retry. Emitting a result
	// frame here would incorrectly mark the original command frame delivered.
	if outcome.Result.GetRetryable() {
		return federationdelivery.RetryableResult(
			federationdelivery.FrameErrorDomainRejected,
		), nil
	}
	if outcome.Result.GetAccepted() &&
		outcome.Result.GetEvent().GetAuthorityStationPeerId() !=
			r.localStationPeerID {
		return federationdelivery.Result{}, federationdelivery.NewError(
			federationdelivery.FailureDomainDispatch,
			"validate Conversation authority outcome",
			fmt.Errorf("committed event does not identify the local authority Station"),
		)
	}
	if _, err := r.sender.EnqueueAuthorityResult(
		ctx,
		transaction.Outbox(),
		proposal,
		outcome.Result,
	); err != nil {
		return federationdelivery.Result{}, err
	}
	if outcome.Replay {
		return federationdelivery.DuplicateResult(), nil
	}
	return federationdelivery.AcceptedResult(), nil
}

func (r *Receiver) deliverProposalRejection(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	proposal *chatmodel.ConversationCommandProposal,
	frame *federationdelivery.Frame,
	rejection commandRejection,
) (federationdelivery.Result, error) {
	if transaction == nil || transaction.DB() == nil || transaction.Outbox() == nil {
		return federationdelivery.Result{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"deliver Conversation authority rejection",
			fmt.Errorf("transaction-bound database and outbox are required"),
		)
	}
	if rejection.retryable {
		// Preserve the original transport identity; a replacement frame would
		// be suppressed by the delivered-row idempotency and lane constraints.
		return federationdelivery.RetryableResult(
			federationdelivery.FrameErrorDomainRejected,
		), nil
	}
	if frame == nil ||
		proposal == nil ||
		proposal.GetCommand() == nil ||
		proposal.GetCommand().GetCommandId() == "" ||
		proposal.GetCommand().GetConversationId() == "" ||
		proposal.GetHomeStationPeerId() == "" ||
		proposal.GetAuthorityStationPeerId() == "" ||
		proposal.GetHomeStationPeerId() != frame.GetSourceStationPeerId() ||
		proposal.GetAuthorityStationPeerId() != frame.GetTargetStationPeerId() ||
		proposal.GetAuthorityStationPeerId() != r.localStationPeerID ||
		len(proposal.GetCommandSha256()) != sha256.Size ||
		proposal.GetCreatedAtUnixMs() <= 0 ||
		!time.UnixMilli(proposal.GetCreatedAtUnixMs()).
			Add(r.sender.frameLifetime).
			After(r.clock.Now().UTC()) ||
		frame.GetOrderingSequence() <= 0 {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	result := &chatmodel.ConversationCommandProposalResult{
		CommandId:  proposal.GetCommand().GetCommandId(),
		RejectCode: rejection.code,
		Retryable:  rejection.retryable,
	}
	if _, err := r.sender.EnqueueAuthorityResult(
		ctx,
		transaction.Outbox(),
		proposal,
		result,
	); err != nil {
		return federationdelivery.Result{}, err
	}
	return federationdelivery.AcceptedResult(), nil
}

func (r *Receiver) receiveAuthorityResult(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	result *chatmodel.ConversationCommandResultDelivery,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	if transaction == nil || transaction.DB() == nil {
		return federationdelivery.Result{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"receive Conversation authority result",
			fmt.Errorf("transaction-bound database is required"),
		)
	}
	if err := validateCanonicalFramePayload(frame, result); err != nil {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	originatingCommandSHA256, err := validateAuthorityResult(result, frame)
	if err != nil {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	duplicate, err := r.authorityResults.ApplyAuthorityResult(
		ctx,
		transaction,
		proto.Clone(result).(*chatmodel.ConversationCommandResultDelivery),
		originatingCommandSHA256,
		frame.GetSourceStationPeerId(),
	)
	if err != nil {
		if errors.Is(err, ErrAuthorityResultCommandHashMismatch) {
			return federationdelivery.PayloadHashConflictResult(), nil
		}
		return federationdelivery.Result{}, fmt.Errorf(
			"conversation Federation: apply authority result: %w",
			err,
		)
	}
	if duplicate {
		return federationdelivery.DuplicateResult(), nil
	}
	return federationdelivery.AcceptedResult(), nil
}

func (r *Receiver) receiveDeviceDelivery(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	item *chatmodel.DurableDeviceInboxItem,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	if transaction == nil || transaction.DB() == nil {
		return federationdelivery.Result{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"receive Conversation device delivery",
			fmt.Errorf("transaction-bound database is required"),
		)
	}
	if err := validateCanonicalFramePayload(frame, item); err != nil {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	intent, orderingSequence, err := canonicalDeviceDelivery(
		item,
		frame.GetSourceStationPeerId(),
		valueobject.Sequence(frame.GetOrderingSequence()),
	)
	if err != nil ||
		validateDeviceDeliveryFrame(item, intent, orderingSequence, frame) != nil {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	duplicate, err := r.deviceDeliveries.ApplyDeviceDelivery(
		ctx,
		transaction,
		intent,
		frame.GetSourceStationPeerId(),
	)
	if err != nil {
		return federationdelivery.Result{}, fmt.Errorf(
			"conversation Federation: atomically apply follower and device delivery: %w",
			err,
		)
	}
	if duplicate {
		return federationdelivery.DuplicateResult(), nil
	}
	return federationdelivery.AcceptedResult(), nil
}

func (r *Receiver) receiveDeliveryReceipt(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	receipt *chatmodel.DeviceConsumptionReceipt,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	if transaction == nil || transaction.DB() == nil {
		return federationdelivery.Result{}, federationdelivery.NewError(
			federationdelivery.FailureInvalidArgument,
			"receive Conversation delivery receipt",
			fmt.Errorf("transaction-bound database is required"),
		)
	}
	if err := validateCanonicalFramePayload(frame, receipt); err != nil ||
		validateDeliveryReceiptFrame(
			receipt,
			frame,
			r.localStationPeerID,
		) != nil {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorInvalidFrame,
		), nil
	}
	replay, err := r.deliveryReceipts.ApplyDeliveryReceipt(
		ctx,
		transaction,
		proto.Clone(receipt).(*chatmodel.DeviceConsumptionReceipt),
		frame.GetSourceStationPeerId(),
	)
	switch {
	case errors.Is(err, ErrDeliveryReceiptConflict):
		return federationdelivery.PayloadHashConflictResult(), nil
	case errors.Is(err, ErrDeliveryReceiptRejected):
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorDomainRejected,
		), nil
	case err != nil:
		return federationdelivery.Result{}, fmt.Errorf(
			"conversation Federation: apply delivery receipt: %w",
			err,
		)
	case replay:
		return federationdelivery.DuplicateResult(), nil
	default:
		return federationdelivery.AcceptedResult(), nil
	}
}

func (r *Receiver) receiveTyping(
	ctx context.Context,
	signal *chatmodel.FederatedConversationTypingSignal,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	if r.typing == nil {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorUnsupportedPayload,
		), nil
	}
	if err := validateCanonicalFramePayload(frame, signal); err != nil ||
		validateTypingFrame(signal, frame, r.localStationPeerID) != nil {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorInvalidFrame,
		), nil
	}
	applicationSignal, err := typingSignalFromWire(signal)
	if err != nil {
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorInvalidFrame,
		), nil
	}
	result, err := r.typing.ReceiveFederatedTyping(
		ctx,
		valueobject.StationID(frame.GetSourceStationPeerId()),
		applicationSignal,
	)
	switch {
	case interactionapp.IsCode(err, interactionapp.ErrorCodeQuotaExceeded):
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorOverloaded,
		), nil
	case interactionapp.IsCode(err, interactionapp.ErrorCodeStalePulse):
		return federationdelivery.DuplicateResult(), nil
	case interactionapp.IsCode(err, interactionapp.ErrorCodeIdempotencyConflict):
		return federationdelivery.PayloadHashConflictResult(), nil
	case interactionapp.IsCode(err, interactionapp.ErrorCodeInvalidArgument),
		interactionapp.IsCode(err, interactionapp.ErrorCodeUnauthorized),
		interactionapp.IsCode(err, interactionapp.ErrorCodeIntegrityFailed):
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorDomainRejected,
		), nil
	case err != nil:
		return federationdelivery.Result{}, fmt.Errorf(
			"conversation Federation: receive typing: %w",
			err,
		)
	case result.Duplicate:
		return federationdelivery.DuplicateResult(), nil
	default:
		return federationdelivery.AcceptedResult(), nil
	}
}

type commandRejection struct {
	code      chatmodel.ConversationCommandRejectCode
	retryable bool
}

func validateAuthorityProposalShape(
	proposal *chatmodel.ConversationCommandProposal,
	frame *federationdelivery.Frame,
	localStationPeerID string,
	now time.Time,
) (chatmodel.ConversationCommandKind, *commandRejection) {
	if proposal == nil ||
		proposal.GetVersion() != conversationCommandProposalVersion ||
		proposal.GetCommand() == nil ||
		proposal.GetFederationId() == "" ||
		proposal.GetAuthorityStationPeerId() == "" ||
		proposal.GetHomeStationPeerId() == "" ||
		proposal.GetActorPtid() == "" ||
		proposal.GetActorDeviceId() == "" ||
		proposal.GetActorSigningKeyId() == "" ||
		proposal.GetCommand().GetSender() == nil ||
		proposal.GetCommand().GetCommandId() == "" ||
		proposal.GetCommand().GetConversationId() == "" ||
		proposal.GetCommand().GetAuthorityStationPeerId() == "" ||
		len(proposal.GetCommandSha256()) != sha256.Size ||
		len(proposal.GetActorSignature()) != ed25519.SignatureSize {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		}
	}
	if frame.GetSourceStationPeerId() != proposal.GetHomeStationPeerId() ||
		frame.GetTargetStationPeerId() != proposal.GetAuthorityStationPeerId() ||
		proposal.GetAuthorityStationPeerId() != localStationPeerID ||
		proposal.GetCommand().GetAuthorityStationPeerId() != proposal.GetAuthorityStationPeerId() ||
		frame.GetPayloadId() != proposal.GetCommand().GetCommandId() {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		}
	}
	createdAt := time.UnixMilli(proposal.GetCreatedAtUnixMs()).UTC()
	expiresAt := time.UnixMilli(proposal.GetExpiresAtUnixMs()).UTC()
	if proposal.GetCreatedAtUnixMs() <= 0 ||
		proposal.GetExpiresAtUnixMs() <= proposal.GetCreatedAtUnixMs() ||
		expiresAt.Sub(createdAt) > maxCommandProposalLifetime ||
		createdAt.After(now.Add(maxProposalClockSkew)) {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		}
	}
	if !expiresAt.After(now) {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_EXPIRED,
		}
	}
	commandKind := authorityCommandKind(proposal.GetCommand())
	if commandKind == chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSUPPORTED_COMMAND,
		}
	}
	commandBytes, err := canonicalPayloadBytes(proposal.GetCommand())
	if err != nil ||
		!bytes.Equal(proposal.GetCommandSha256(), federationdelivery.PayloadSHA256(commandBytes)) {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_HASH_MISMATCH,
		}
	}
	if proposal.GetCommand().GetSender().GetPtid() != proposal.GetActorPtid() ||
		proposal.GetCommand().GetSender().GetDeviceId() != proposal.GetActorDeviceId() {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		}
	}
	return commandKind, nil
}

func verifyProposalActorIdentity(
	proposal *chatmodel.ConversationCommandProposal,
	commandKind chatmodel.ConversationCommandKind,
	key *actormodel.VerifiedActorDeviceSigningKey,
	sourceStationPeerID string,
	localStationPeerID string,
	now time.Time,
) ([]byte, bool, *commandRejection) {
	if key.GetActorPtid() != proposal.GetActorPtid() ||
		key.GetActorDeviceId() != proposal.GetActorDeviceId() ||
		key.GetHomeStationPeerId() != proposal.GetHomeStationPeerId() ||
		key.GetHomeStationPeerId() != sourceStationPeerID ||
		key.GetSigningKeyId() != proposal.GetActorSigningKeyId() ||
		key.GetProfileVersion() <= 0 ||
		key.GetValidFromUnixMs() <= 0 ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize {
		return nil, false, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		}
	}
	switch key.GetVerificationSource() {
	case actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR:
	case actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION:
		if sourceStationPeerID != localStationPeerID {
			return nil, false, &commandRejection{
				code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
			}
		}
	default:
		return nil, false, &commandRejection{
			code:      chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_UNAVAILABLE,
			retryable: true,
		}
	}
	createdAt := time.UnixMilli(proposal.GetCreatedAtUnixMs()).UTC()
	if time.UnixMilli(key.GetValidFromUnixMs()).UTC().After(createdAt) {
		return nil, false, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
		}
	}
	keyCurrentlyRevoked := false
	if key.GetRevokedAtUnixMs() > 0 {
		revokedAt := time.UnixMilli(key.GetRevokedAtUnixMs()).UTC()
		if revokedAt.After(now) {
			return nil, false, &commandRejection{
				code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
			}
		}
		if !createdAt.Before(revokedAt) {
			return nil, false, &commandRejection{
				code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_REVOKED,
			}
		}
		keyCurrentlyRevoked = true
	}
	signingInput := &chatmodel.ConversationCommandProposalSigningInput{
		Version:                proposal.GetVersion(),
		FederationId:           proposal.GetFederationId(),
		AuthorityStationPeerId: proposal.GetAuthorityStationPeerId(),
		AuthorityEpoch:         proposal.GetAuthorityEpoch(),
		HomeStationPeerId:      proposal.GetHomeStationPeerId(),
		ConversationId:         proposal.GetCommand().GetConversationId(),
		CommandId:              proposal.GetCommand().GetCommandId(),
		CommandKind:            commandKind,
		ActorPtid:              proposal.GetActorPtid(),
		ActorDeviceId:          proposal.GetActorDeviceId(),
		ActorSigningKeyId:      proposal.GetActorSigningKeyId(),
		CommandSha256:          append([]byte(nil), proposal.GetCommandSha256()...),
		CreatedAtUnixMs:        proposal.GetCreatedAtUnixMs(),
		ExpiresAtUnixMs:        proposal.GetExpiresAtUnixMs(),
	}
	signingBytes, err := canonicalPayloadBytes(signingInput)
	if err != nil {
		return nil, false, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		}
	}
	if !ed25519.Verify(
		ed25519.PublicKey(key.GetEd25519PublicKey()),
		signingBytes,
		proposal.GetActorSignature(),
	) {
		return nil, false, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_ACTOR_SIGNATURE,
		}
	}
	return signingBytes, keyCurrentlyRevoked, nil
}

func validateAuthorityOutcome(
	proposal *chatmodel.ConversationCommandProposal,
	outcome AuthorityCommandOutcome,
) error {
	if outcome.Result == nil ||
		outcome.Result.GetCommandId() != proposal.GetCommand().GetCommandId() {
		return federationdelivery.NewError(
			federationdelivery.FailureDomainDispatch,
			"validate Conversation authority outcome",
			fmt.Errorf("authority result does not match the command"),
		)
	}
	result := outcome.Result
	switch {
	case result.GetAccepted():
		event := result.GetEvent()
		if result.GetRetryable() ||
			result.GetRejectCode() != chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED ||
			event == nil ||
			event.GetConversationId() != proposal.GetCommand().GetConversationId() ||
			event.GetCommandId() != proposal.GetCommand().GetCommandId() ||
			event.GetSequence() <= 0 ||
			result.GetAuthoritySequence() != event.GetSequence() ||
			!bytes.Equal(result.GetAuthorityEventHash(), event.GetEventHash()) {
			return federationdelivery.NewError(
				federationdelivery.FailureDomainDispatch,
				"validate Conversation authority outcome",
				fmt.Errorf("accepted result is incomplete or inconsistent"),
			)
		}
	case result.GetRetryable():
		if result.GetEvent() != nil ||
			result.GetRejectCode() == chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED {
			return federationdelivery.NewError(
				federationdelivery.FailureDomainDispatch,
				"validate Conversation authority outcome",
				fmt.Errorf("retryable result is incomplete or inconsistent"),
			)
		}
	default:
		if result.GetEvent() != nil ||
			result.GetRejectCode() == chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED {
			return federationdelivery.NewError(
				federationdelivery.FailureDomainDispatch,
				"validate Conversation authority outcome",
				fmt.Errorf("terminal result is incomplete or inconsistent"),
			)
		}
	}
	return nil
}

func validateAuthorityResult(
	delivery *chatmodel.ConversationCommandResultDelivery,
	frame *federationdelivery.Frame,
) ([]byte, error) {
	if delivery == nil || frame == nil {
		return nil, fmt.Errorf("authority result identity is incomplete")
	}
	payload, err := canonicalPayloadBytes(delivery)
	if err != nil {
		return nil, err
	}
	originatingCommandSHA256, err := authorityResultCommandSHA256(
		frame.GetPayloadId(),
	)
	if err != nil {
		return nil, err
	}
	if delivery.GetConversationId() == "" ||
		delivery.GetCommandId() == "" ||
		delivery.GetResult() == nil ||
		delivery.GetResult().GetCommandId() != delivery.GetCommandId() ||
		frame.GetPayloadId() != authorityResultPayloadID(
			delivery,
			payload,
			originatingCommandSHA256,
		) {
		return nil, fmt.Errorf("authority result identity is incomplete")
	}
	result := delivery.GetResult()
	switch delivery.GetState() {
	case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED:
		event := result.GetEvent()
		if !result.GetAccepted() ||
			result.GetRetryable() ||
			event == nil ||
			event.GetConversationId() != delivery.GetConversationId() ||
			event.GetCommandId() != delivery.GetCommandId() ||
			event.GetAuthorityStationPeerId() != frame.GetSourceStationPeerId() ||
			event.GetSequence() != result.GetAuthoritySequence() ||
			!bytes.Equal(event.GetEventHash(), result.GetAuthorityEventHash()) {
			return nil, fmt.Errorf("accepted authority result is inconsistent")
		}
	case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED:
		if result.GetAccepted() ||
			result.GetRetryable() ||
			result.GetEvent() != nil ||
			result.GetRejectCode() == chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED {
			return nil, fmt.Errorf("terminal authority result is inconsistent")
		}
	default:
		return nil, fmt.Errorf("authority result state is not final or retryable")
	}
	return originatingCommandSHA256, nil
}

func authorityResultCommandSHA256(payloadID string) ([]byte, error) {
	binding := strings.TrimPrefix(
		payloadID,
		authorityResultFrameDomain+":",
	)
	if binding == payloadID {
		return nil, fmt.Errorf("authority result command hash binding is missing")
	}
	commandSHA256Hex, resultIdentity, found := strings.Cut(binding, ":")
	if !found || resultIdentity == "" {
		return nil, fmt.Errorf("authority result command hash binding is malformed")
	}
	commandSHA256, err := hex.DecodeString(commandSHA256Hex)
	if err != nil || len(commandSHA256) != sha256.Size {
		return nil, fmt.Errorf("authority result command hash binding is invalid")
	}
	return commandSHA256, nil
}

func canonicalDeviceDelivery(
	item *chatmodel.DurableDeviceInboxItem,
	sourceStationPeerID string,
	eventSequence valueobject.Sequence,
) (conversationports.DeviceInboxIntent, int64, error) {
	if item == nil ||
		item.GetRecipient() == nil ||
		item.GetRecipient().GetActor() == nil ||
		strings.TrimSpace(item.GetRecipient().GetActor().GetPtid()) == "" ||
		item.GetRecipient().GetActor().GetPtid() !=
			strings.TrimSpace(item.GetRecipient().GetActor().GetPtid()) ||
		strings.TrimSpace(item.GetRecipient().GetDeviceId()) == "" ||
		item.GetRecipient().GetDeviceId() !=
			strings.TrimSpace(item.GetRecipient().GetDeviceId()) ||
		item.GetItemId() == "" ||
		item.GetEventId() == "" ||
		item.GetConversationId() == "" ||
		item.GetIdempotencyKey() == "" ||
		item.GetLaneSequence() != 0 ||
		len(item.GetOpaquePayload()) == 0 ||
		len(item.GetPayloadSha256()) != sha256.Size ||
		!bytes.Equal(
			item.GetPayloadSha256(),
			federationdelivery.PayloadSHA256(item.GetOpaquePayload()),
		) {
		return conversationports.DeviceInboxIntent{}, 0,
			fmt.Errorf("device delivery identity is incomplete or inconsistent")
	}
	if item.GetState() !=
		chatmodel.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_UNSPECIFIED ||
		item.GetAttemptCount() != 0 ||
		item.GetLease() != nil ||
		item.GetNextAttemptAt() != nil ||
		item.GetExpiresAt() != nil ||
		item.GetAckedAt() != nil ||
		item.GetLastErrorCode() !=
			chatmodel.DeviceInboxRejectCode_DEVICE_INBOX_REJECT_CODE_UNSPECIFIED {
		return conversationports.DeviceInboxIntent{}, 0,
			fmt.Errorf("device delivery carries receiver-local queue state")
	}
	if item.GetFirstQueuedAt() == nil || !item.GetFirstQueuedAt().IsValid() {
		return conversationports.DeviceInboxIntent{}, 0,
			fmt.Errorf("device delivery creation time is invalid")
	}
	payloadHash, err := valueobject.NewHash(item.GetPayloadSha256())
	if err != nil {
		return conversationports.DeviceInboxIntent{}, 0, err
	}
	intent := conversationports.DeviceInboxIntent{
		IntentID:       item.GetItemId(),
		ConversationID: valueobject.ConversationID(item.GetConversationId()),
		EventID:        valueobject.EventID(item.GetEventId()),
		Recipient: valueobject.Endpoint{
			Actor:  valueobject.PTID(item.GetRecipient().GetActor().GetPtid()),
			Device: valueobject.DeviceID(item.GetRecipient().GetDeviceId()),
		},
		IdempotencyKey: item.GetIdempotencyKey(),
		OpaquePayload:  append([]byte(nil), item.GetOpaquePayload()...),
		PayloadHash:    payloadHash,
		CreatedAt:      item.GetFirstQueuedAt().AsTime().UTC(),
	}
	var orderingSequence int64
	switch item.GetPayloadType() {
	case chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_CONVERSATION_EVENT:
		eventDelivery := &chatmodel.DeviceEventDelivery{}
		if err := decodeCanonicalInnerPayload(item.GetOpaquePayload(), eventDelivery); err != nil {
			return conversationports.DeviceInboxIntent{}, 0, err
		}
		if eventDelivery.GetRecipient() == nil ||
			eventDelivery.GetEvent() == nil ||
			eventDelivery.GetRecipient().GetPtid() != item.GetRecipient().GetActor().GetPtid() ||
			eventDelivery.GetRecipient().GetDeviceId() != item.GetRecipient().GetDeviceId() ||
			eventDelivery.GetEvent().GetEventId() != item.GetEventId() ||
			eventDelivery.GetEvent().GetConversationId() != item.GetConversationId() ||
			eventDelivery.GetEvent().GetSequence() <= 0 ||
			valueobject.Sequence(eventDelivery.GetEvent().GetSequence()) != eventSequence ||
			eventDelivery.GetEvent().GetAuthorityStationPeerId() != sourceStationPeerID {
			return conversationports.DeviceInboxIntent{}, 0,
				fmt.Errorf("Conversation event delivery is not bound to its device item")
		}
		commitment, err := valueobject.NewHash(eventDelivery.GetDeliveryCommitment())
		if err != nil || commitment.IsZero() {
			return conversationports.DeviceInboxIntent{}, 0,
				fmt.Errorf("Conversation event delivery commitment is invalid")
		}
		intent.EventSequence = valueobject.Sequence(eventDelivery.GetEvent().GetSequence())
		intent.PayloadKind = conversationports.DeviceInboxPayloadConversationEvent
		intent.Commitment = commitment
		orderingSequence = eventDelivery.GetEvent().GetSequence()
	case chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DEVICE_RECEIPT:
		cursor := &chatmodel.ActorReadCursor{}
		if err := decodeCanonicalInnerPayload(item.GetOpaquePayload(), cursor); err == nil {
			if cursor.GetConversationId() != item.GetConversationId() ||
				strings.TrimSpace(cursor.GetReaderPtid()) == "" ||
				cursor.GetLastReadSequence() <= 0 ||
				(eventSequence != 0 &&
					valueobject.Sequence(cursor.GetLastReadSequence()) != eventSequence) ||
				item.GetEventId() != valueobject.HashBytes(item.GetOpaquePayload()).String() {
				return conversationports.DeviceInboxIntent{}, 0,
					fmt.Errorf("read cursor delivery is not bound to its device item")
			}
			intent.EventSequence = valueobject.Sequence(cursor.GetLastReadSequence())
			intent.PayloadKind = conversationports.DeviceInboxPayloadDeviceReceipt
			break
		}
		receipt := &chatmodel.MessageReceipt{}
		if err := decodeCanonicalInnerPayload(item.GetOpaquePayload(), receipt); err != nil {
			return conversationports.DeviceInboxIntent{}, 0, err
		}
		if receipt.GetReceiptType() !=
			chatmodel.ReceiptType_RECEIPT_TYPE_DELIVERED ||
			receipt.GetConversationId() != item.GetConversationId() ||
			receipt.GetMessageId() != item.GetEventId() ||
			receipt.GetPtid() == "" ||
			receipt.GetDeviceId() == "" ||
			receipt.GetPtid() == item.GetRecipient().GetActor().GetPtid() ||
			eventSequence == 0 {
			return conversationports.DeviceInboxIntent{}, 0,
				fmt.Errorf("delivery receipt is not bound to its device item")
		}
		intent.EventSequence = eventSequence
		intent.PayloadKind = conversationports.DeviceInboxPayloadDeviceReceipt
		orderingSequence = int64(eventSequence)
	default:
		return conversationports.DeviceInboxIntent{}, 0,
			fmt.Errorf("device delivery payload type is not owned by the Conversation adapter")
	}
	return intent, orderingSequence, nil
}

func validateDeviceDeliveryFrame(
	item *chatmodel.DurableDeviceInboxItem,
	intent conversationports.DeviceInboxIntent,
	orderingSequence int64,
	frame *federationdelivery.Frame,
) error {
	if frame == nil ||
		frame.GetIssuedAt() == nil ||
		!frame.GetIssuedAt().IsValid() ||
		frame.GetPayloadId() != item.GetItemId() ||
		frame.GetIdempotencyKey() != item.GetIdempotencyKey() ||
		frame.GetOrderingKey() != deviceOrderingKey(
			string(intent.Recipient.Actor),
			string(intent.Recipient.Device),
			string(intent.ConversationID),
			string(intent.PayloadKind),
			intent.IntentID,
		) ||
		frame.GetOrderingSequence() != orderingSequence ||
		!frame.GetIssuedAt().AsTime().Equal(intent.CreatedAt) {
		return fmt.Errorf("device delivery frame is not bound to its target-local intent")
	}
	return nil
}

func validateDeliveryReceiptFrame(
	receipt *chatmodel.DeviceConsumptionReceipt,
	frame *federationdelivery.Frame,
	localStationPeerID string,
) error {
	if receipt == nil ||
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
		return fmt.Errorf("delivery receipt identity is incomplete")
	}
	if frame == nil ||
		frame.GetSourceStationPeerId() == "" ||
		frame.GetSourceStationPeerId() == localStationPeerID ||
		frame.GetTargetStationPeerId() != localStationPeerID ||
		frame.GetPayloadId() != receipt.GetReceiptId() ||
		frame.GetIdempotencyKey() !=
			deliveryReceiptFrameDomain+":"+receipt.GetReceiptId() ||
		frame.GetOrderingKey() != conversationOrderingKey(
			deliveryReceiptFrameDomain,
			receipt.GetConversationId(),
		) ||
		frame.GetOrderingSequence() != 0 ||
		frame.GetIssuedAt() == nil ||
		!frame.GetIssuedAt().IsValid() {
		return fmt.Errorf("delivery receipt frame binding is invalid")
	}

	return nil
}

func validateTypingFrame(
	signal *chatmodel.FederatedConversationTypingSignal,
	frame *federationdelivery.Frame,
	localStationPeerID string,
) error {
	if signal == nil ||
		signal.GetFormatVersion() != conversationTypingVersion ||
		signal.GetFederationId() == "" ||
		signal.GetConversationId() == "" ||
		signal.GetAuthorityStationPeerId() == "" ||
		signal.GetAuthorityEpoch() <= 0 ||
		signal.GetSender() == nil ||
		signal.GetSender().GetActor() == nil ||
		signal.GetSender().GetActor().GetPtid() == "" ||
		signal.GetSender().GetDeviceId() == "" ||
		signal.GetSenderHomeStationPeerId() == "" ||
		signal.GetPulseGeneration() == 0 ||
		signal.GetExpiresAt() == nil ||
		!signal.GetExpiresAt().IsValid() ||
		len(signal.GetRecipientActorPtids()) > maxFederatedTypingRecipients {
		return fmt.Errorf("typing signal is incomplete")
	}
	if frame == nil ||
		frame.GetTargetStationPeerId() != localStationPeerID ||
		frame.GetOrderingSequence() != 0 ||
		frame.GetPayloadId() != typingPayloadID(signal) ||
		frame.GetIdempotencyKey() != typingFrameDomain+":"+frame.GetPayloadId() ||
		frame.GetOrderingKey() != conversationOrderingKey(
			typingFrameDomain,
			signal.GetConversationId(),
		) ||
		frame.GetExpiresAt() == nil ||
		!frame.GetExpiresAt().AsTime().Equal(signal.GetExpiresAt().AsTime()) {
		return fmt.Errorf("typing frame binding is invalid")
	}
	switch signal.GetPhase() {
	case chatmodel.FederatedConversationTypingPhase_FEDERATED_CONVERSATION_TYPING_PHASE_AUTHORITY_ADMISSION:
		if frame.GetSourceStationPeerId() != signal.GetSenderHomeStationPeerId() ||
			frame.GetTargetStationPeerId() != signal.GetAuthorityStationPeerId() ||
			len(signal.GetRecipientActorPtids()) != 0 {
			return fmt.Errorf("typing authority admission route is invalid")
		}
	case chatmodel.FederatedConversationTypingPhase_FEDERATED_CONVERSATION_TYPING_PHASE_HOME_FANOUT:
		if frame.GetSourceStationPeerId() != signal.GetAuthorityStationPeerId() ||
			len(signal.GetRecipientActorPtids()) == 0 {
			return fmt.Errorf("typing Home fan-out route is invalid")
		}
	default:
		return fmt.Errorf("typing phase is invalid")
	}
	previous := ""
	for _, recipient := range signal.GetRecipientActorPtids() {
		if strings.TrimSpace(recipient) == "" ||
			recipient != strings.TrimSpace(recipient) ||
			(previous != "" && recipient <= previous) {
			return fmt.Errorf("typing recipients are not canonical")
		}
		previous = recipient
	}

	return nil
}

func typingSignalFromWire(
	signal *chatmodel.FederatedConversationTypingSignal,
) (interactionapp.FederatedTypingSignal, error) {
	phase := interactionapp.FederatedTypingPhase(0)
	switch signal.GetPhase() {
	case chatmodel.FederatedConversationTypingPhase_FEDERATED_CONVERSATION_TYPING_PHASE_AUTHORITY_ADMISSION:
		phase = interactionapp.FederatedTypingPhaseAuthorityAdmission
	case chatmodel.FederatedConversationTypingPhase_FEDERATED_CONVERSATION_TYPING_PHASE_HOME_FANOUT:
		phase = interactionapp.FederatedTypingPhaseHomeFanout
	default:
		return interactionapp.FederatedTypingSignal{}, fmt.Errorf("typing phase is invalid")
	}
	recipients := make(
		[]valueobject.PTID,
		0,
		len(signal.GetRecipientActorPtids()),
	)
	for _, recipient := range signal.GetRecipientActorPtids() {
		recipients = append(recipients, valueobject.PTID(recipient))
	}

	return interactionapp.FederatedTypingSignal{
		Phase:            phase,
		FederationID:     valueobject.FederationID(signal.GetFederationId()),
		ConversationID:   valueobject.ConversationID(signal.GetConversationId()),
		AuthorityStation: valueobject.StationID(signal.GetAuthorityStationPeerId()),
		AuthorityEpoch:   valueobject.AuthorityEpoch(signal.GetAuthorityEpoch()),
		Sender: valueobject.Endpoint{
			Actor:  valueobject.PTID(signal.GetSender().GetActor().GetPtid()),
			Device: valueobject.DeviceID(signal.GetSender().GetDeviceId()),
		},
		SenderHomeStation: valueobject.StationID(
			signal.GetSenderHomeStationPeerId(),
		),
		Generation: signal.GetPulseGeneration(),
		ExpiresAt:  signal.GetExpiresAt().AsTime().UTC(),
		IsTyping:   signal.GetIsTyping(),
		Recipients: recipients,
	}, nil
}

func validateCanonicalFramePayload(
	frame *federationdelivery.Frame,
	payload proto.Message,
) error {
	if frame == nil || payload == nil || hasUnknownFields(payload.ProtoReflect()) {
		return fmt.Errorf("frame payload is nil or contains unknown fields")
	}
	canonical, err := canonicalPayloadBytes(payload)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, frame.GetOpaquePayload()) {
		return fmt.Errorf("frame payload is not the exact deterministic protobuf encoding")
	}
	return nil
}

func decodeCanonicalInnerPayload(encoded []byte, target proto.Message) error {
	if len(encoded) == 0 || target == nil {
		return fmt.Errorf("inner payload is required")
	}
	if err := proto.Unmarshal(encoded, target); err != nil {
		return fmt.Errorf("decode inner payload: %w", err)
	}
	if hasUnknownFields(target.ProtoReflect()) {
		return fmt.Errorf("inner payload contains unknown fields")
	}
	canonical, err := canonicalPayloadBytes(target)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, encoded) {
		return fmt.Errorf("inner payload is not the exact deterministic protobuf encoding")
	}
	return nil
}

func hasUnknownFields(message protoreflect.Message) bool {
	if len(message.GetUnknown()) != 0 {
		return true
	}
	unknown := false
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		switch {
		case field.IsList() && field.Message() != nil:
			list := value.List()
			for index := 0; index < list.Len(); index++ {
				if hasUnknownFields(list.Get(index).Message()) {
					unknown = true
					return false
				}
			}
		case field.IsMap() && field.MapValue().Message() != nil:
			value.Map().Range(func(_ protoreflect.MapKey, mapValue protoreflect.Value) bool {
				if hasUnknownFields(mapValue.Message()) {
					unknown = true
					return false
				}
				return true
			})
		case field.Message() != nil:
			unknown = hasUnknownFields(value.Message())
		}
		return !unknown
	})
	return unknown
}

func authorityCommandKind(
	command *chatmodel.ChatCommand,
) chatmodel.ConversationCommandKind {
	if command == nil {
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
	switch command.GetPayload().(type) {
	case *chatmodel.ChatCommand_SendMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE
	case *chatmodel.ChatCommand_EditMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_EDIT_MESSAGE
	case *chatmodel.ChatCommand_RetractMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_RETRACT_MESSAGE
	case *chatmodel.ChatCommand_DissolveConversation:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_DISSOLVE
	case *chatmodel.ChatCommand_UpdateConversation:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UPDATE_SETTINGS
	case *chatmodel.ChatCommand_Reaction:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_REACT
	case *chatmodel.ChatCommand_PinMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_PIN_MESSAGE
	case *chatmodel.ChatCommand_MembershipTransition:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBERSHIP_TRANSITION
	default:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
}
