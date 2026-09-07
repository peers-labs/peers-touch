package federation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

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
	return federationdelivery.RegisterProtoReceiver(
		registry,
		federationdelivery.PayloadKindConversationDeviceDelivery,
		func() *chatmodel.DurableDeviceInboxItem {
			return &chatmodel.DurableDeviceInboxItem{}
		},
		receiver.receiveDeviceDelivery,
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
		outcome.Result.GetCommittedEvent().GetCommittedByStationPeerId() !=
			r.localStationPeerID {
		return federationdelivery.Result{}, federationdelivery.NewError(
			federationdelivery.FailureDomainDispatch,
			"validate Conversation authority outcome",
			fmt.Errorf("committed event does not identify the local authority Station"),
		)
	}
	if outcome.Result.GetRejectCode() ==
		chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_CONFLICT {
		return federationdelivery.PayloadHashConflictResult(), nil
	}
	if _, err := r.sender.EnqueueAuthorityResult(
		ctx,
		transaction.Outbox(),
		proposal,
		outcome.Result,
		frame.GetOrderingSequence(),
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
		frame.GetOrderingSequence(),
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
	if err := validateCanonicalFramePayload(frame, result); err != nil ||
		validateAuthorityResult(result, frame) != nil {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	duplicate, err := r.authorityResults.ApplyAuthorityResult(
		ctx,
		transaction,
		proto.Clone(result).(*chatmodel.ConversationCommandResultDelivery),
		frame.GetSourceStationPeerId(),
	)
	if err != nil {
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
	if err := validateCanonicalFramePayload(frame, item); err != nil ||
		validateDeviceDelivery(item, frame) != nil {
		return federationdelivery.TerminalResult(federationdelivery.FrameErrorInvalidFrame), nil
	}
	duplicate, err := r.deviceDeliveries.ApplyDeviceDelivery(
		ctx,
		transaction,
		proto.Clone(item).(*chatmodel.DurableDeviceInboxItem),
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
		proposal.GetCommand().GetCommandId() == "" ||
		proposal.GetCommand().GetConversationId() == "" ||
		len(proposal.GetCommandSha256()) != sha256.Size ||
		len(proposal.GetActorSignature()) != ed25519.SignatureSize {
		return 0, &commandRejection{
			code: chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
		}
	}
	if frame.GetSourceStationPeerId() != proposal.GetHomeStationPeerId() ||
		frame.GetTargetStationPeerId() != proposal.GetAuthorityStationPeerId() ||
		proposal.GetAuthorityStationPeerId() != localStationPeerID ||
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
	if proposal.GetCommand().GetSenderPtid() != proposal.GetActorPtid() ||
		proposal.GetCommand().GetSenderDeviceId() != proposal.GetActorDeviceId() {
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
		event := result.GetCommittedEvent()
		if result.GetRetryable() ||
			result.GetRejectCode() != chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED ||
			event == nil ||
			event.GetConversationId() != proposal.GetCommand().GetConversationId() ||
			event.GetGroupSeq() <= 0 ||
			result.GetAuthorityGroupSeq() != event.GetGroupSeq() ||
			!bytes.Equal(result.GetAuthorityEventHash(), event.GetEventHash()) {
			return federationdelivery.NewError(
				federationdelivery.FailureDomainDispatch,
				"validate Conversation authority outcome",
				fmt.Errorf("accepted result is incomplete or inconsistent"),
			)
		}
	case result.GetRetryable():
		if result.GetCommittedEvent() != nil ||
			result.GetRejectCode() == chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED {
			return federationdelivery.NewError(
				federationdelivery.FailureDomainDispatch,
				"validate Conversation authority outcome",
				fmt.Errorf("retryable result is incomplete or inconsistent"),
			)
		}
	default:
		if result.GetCommittedEvent() != nil ||
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
) error {
	if delivery == nil ||
		delivery.GetConversationId() == "" ||
		delivery.GetCommandId() == "" ||
		delivery.GetResult() == nil ||
		delivery.GetResult().GetCommandId() != delivery.GetCommandId() ||
		frame.GetPayloadId() != delivery.GetCommandId() {
		return fmt.Errorf("authority result identity is incomplete")
	}
	result := delivery.GetResult()
	switch delivery.GetState() {
	case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED:
		event := result.GetCommittedEvent()
		if !result.GetAccepted() ||
			result.GetRetryable() ||
			event == nil ||
			event.GetConversationId() != delivery.GetConversationId() ||
			event.GetCommittedByStationPeerId() != frame.GetSourceStationPeerId() ||
			event.GetGroupSeq() != result.GetAuthorityGroupSeq() ||
			!bytes.Equal(event.GetEventHash(), result.GetAuthorityEventHash()) {
			return fmt.Errorf("accepted authority result is inconsistent")
		}
	case chatmodel.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED:
		if result.GetAccepted() ||
			result.GetRetryable() ||
			result.GetCommittedEvent() != nil ||
			result.GetRejectCode() == chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED {
			return fmt.Errorf("terminal authority result is inconsistent")
		}
	default:
		return fmt.Errorf("authority result state is not final or retryable")
	}
	return nil
}

func validateDeviceDelivery(
	item *chatmodel.DurableDeviceInboxItem,
	frame *federationdelivery.Frame,
) error {
	if item == nil ||
		item.GetRecipient() == nil ||
		item.GetRecipient().GetActor() == nil ||
		item.GetRecipient().GetActor().GetPtid() == "" ||
		item.GetRecipient().GetDeviceId() == "" ||
		item.GetItemId() == "" ||
		item.GetEventId() == "" ||
		item.GetConversationId() == "" ||
		item.GetIdempotencyKey() == "" ||
		item.GetLaneSequence() <= 0 ||
		len(item.GetOpaquePayload()) == 0 ||
		len(item.GetPayloadSha256()) != sha256.Size ||
		!bytes.Equal(
			item.GetPayloadSha256(),
			federationdelivery.PayloadSHA256(item.GetOpaquePayload()),
		) ||
		frame.GetPayloadId() != item.GetItemId() ||
		frame.GetIdempotencyKey() != item.GetIdempotencyKey() ||
		frame.GetOrderingSequence() != item.GetLaneSequence() {
		return fmt.Errorf("device delivery identity is incomplete or inconsistent")
	}
	if item.GetState() != chatmodel.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_UNSPECIFIED &&
		item.GetState() != chatmodel.DeviceInboxItemState_DEVICE_INBOX_ITEM_STATE_PENDING {
		return fmt.Errorf("device delivery carries receiver-local lifecycle state")
	}
	switch item.GetPayloadType() {
	case chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_CONVERSATION_EVENT:
		eventDelivery := &chatmodel.DeviceEventDelivery{}
		if err := decodeCanonicalInnerPayload(item.GetOpaquePayload(), eventDelivery); err != nil {
			return err
		}
		if eventDelivery.GetRecipient() == nil ||
			eventDelivery.GetEvent() == nil ||
			eventDelivery.GetRecipient().GetPtid() != item.GetRecipient().GetActor().GetPtid() ||
			eventDelivery.GetRecipient().GetDeviceId() != item.GetRecipient().GetDeviceId() ||
			eventDelivery.GetEvent().GetEventId() != item.GetEventId() ||
			eventDelivery.GetEvent().GetConversationId() != item.GetConversationId() ||
			eventDelivery.GetEvent().GetAuthorityStationId() != frame.GetSourceStationPeerId() {
			return fmt.Errorf("Conversation event delivery is not bound to its device item")
		}
	case chatmodel.DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DEVICE_RECEIPT:
		cursor := &chatmodel.ActorReadCursor{}
		if err := decodeCanonicalInnerPayload(item.GetOpaquePayload(), cursor); err != nil {
			return err
		}
		if cursor.GetConversationId() != item.GetConversationId() ||
			cursor.GetReaderPtid() != item.GetRecipient().GetActor().GetPtid() {
			return fmt.Errorf("read cursor delivery is not bound to its device item")
		}
	default:
		return fmt.Errorf("device delivery payload type is not owned by the Conversation adapter")
	}
	return nil
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
	command *chatmodel.ConversationCommand,
) chatmodel.ConversationCommandKind {
	if command == nil {
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
	switch command.GetPayload().(type) {
	case *chatmodel.ConversationCommand_SendMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE
	case *chatmodel.ConversationCommand_EditMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_EDIT_MESSAGE
	case *chatmodel.ConversationCommand_RetractMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_RETRACT_MESSAGE
	case *chatmodel.ConversationCommand_Dissolve:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_DISSOLVE
	case *chatmodel.ConversationCommand_UpdateSettings:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UPDATE_SETTINGS
	case *chatmodel.ConversationCommand_React:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_REACT
	case *chatmodel.ConversationCommand_PinMessage:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_PIN_MESSAGE
	case *chatmodel.ConversationCommand_MembershipTransition:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBERSHIP_TRANSITION
	default:
		return chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
}
