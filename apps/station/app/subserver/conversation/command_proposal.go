package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

const (
	conversationCommandProposalVersion = 1
	conversationCommandProposalScope   = "conversation-command-proposal"
	maxCommandProposalLifetime         = 5 * time.Minute
)

type ActorDeviceSigningKeyResolver interface {
	ResolveSigningKey(
		ctx context.Context,
		ptid string,
		deviceID string,
		signingKeyID string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
}

type ActorDeviceSigningKeyHydrator interface {
	Hydrate(
		ctx context.Context,
		federationID string,
		homeStationPeerID string,
		actorPtid string,
	) error
}

type FederationStationMembershipResolver interface {
	IsActiveStation(ctx context.Context, federationID string, stationPeerID string) (bool, error)
}

type ConversationCommandStationClaims struct {
	Scope          string
	Issuer         string
	Audience       string
	Subject        string
	Federation     string
	Conversation   string
	Command        string
	CommandKind    string
	Device         string
	SigningKey     string
	CommandHash    string
	AuthorityEpoch string
	ExpiresAt      string
}

type ConversationCommandProposalService struct {
	authority      *DefaultService
	actorKeys      ActorDeviceSigningKeyResolver
	federation     FederationStationMembershipResolver
	keyHydrator    ActorDeviceSigningKeyHydrator
	localStationID string
	clock          Clock
}

func (s *ConversationCommandProposalService) WithActorKeyHydrator(
	hydrator ActorDeviceSigningKeyHydrator,
) *ConversationCommandProposalService {
	s.keyHydrator = hydrator
	return s
}

func NewConversationCommandProposalService(
	authority *DefaultService,
	actorKeys ActorDeviceSigningKeyResolver,
	federation FederationStationMembershipResolver,
	localStationID string,
) *ConversationCommandProposalService {
	return &ConversationCommandProposalService{
		authority:      authority,
		actorKeys:      actorKeys,
		federation:     federation,
		localStationID: localStationID,
		clock:          time.Now,
	}
}

func (s *ConversationCommandProposalService) VerifyAndSubmit(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
	claims ConversationCommandStationClaims,
) (*chat.ConversationCommandProposalResult, error) {
	reject := func(code chat.ConversationCommandRejectCode, retryable bool) (*chat.ConversationCommandProposalResult, error) {
		result := s.rejectedResult(ctx, proposal, code)
		result.Retryable = retryable
		return result, nil
	}
	if !validCommandProposalShape(proposal) {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
			false,
		)
	}
	if proposal.ExpiresAtUnixMs <= s.clock().UnixMilli() {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_EXPIRED,
			false,
		)
	}
	if !validCommandProposalTime(
		s.clock(),
		proposal.CreatedAtUnixMs,
		proposal.ExpiresAtUnixMs,
	) {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL,
			false,
		)
	}
	kind := conversationCommandKind(proposal.Command)
	if kind == chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSUPPORTED_COMMAND,
			false,
		)
	}
	if proposal.AuthorityStationPeerId != s.localStationID {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_NOT_AUTHORITY,
			false,
		)
	}
	conversation, err := s.authority.repo.GetConversation(ctx, proposal.Command.ConversationId)
	if err != nil {
		return nil, fmt.Errorf("conversation: load proposal conversation: %w", err)
	}
	if conversation.FederationId != proposal.FederationId ||
		conversation.AuthorityStationPeerId != proposal.AuthorityStationPeerId ||
		conversation.AuthorityEpoch != proposal.AuthorityEpoch {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
			false,
		)
	}

	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(proposal.Command)
	if err != nil {
		return nil, fmt.Errorf("conversation: marshal proposed command: %w", err)
	}
	commandHash := sha256.Sum256(commandBytes)
	if !bytes.Equal(commandHash[:], proposal.CommandSha256) {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_HASH_MISMATCH,
			false,
		)
	}
	if !proposalFieldsMatchCommand(proposal) ||
		!proposalClaimsMatch(proposal, kind, claims) {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
			false,
		)
	}

	active, err := s.federation.IsActiveStation(
		ctx,
		proposal.FederationId,
		proposal.HomeStationPeerId,
	)
	if err != nil {
		return nil, fmt.Errorf("conversation: resolve Federation membership: %w", err)
	}
	if !active {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INACTIVE_FEDERATION_STATION,
			false,
		)
	}

	key, err := s.resolveActorKey(ctx, proposal)
	if err != nil {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_UNAVAILABLE,
			true,
		)
	}
	if key.RevokedAtUnixMs > 0 {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_ACTOR_KEY_REVOKED,
			false,
		)
	}
	if key.ActorPtid != proposal.ActorPtid ||
		key.ActorDeviceId != proposal.ActorDeviceId ||
		key.SigningKeyId != proposal.ActorSigningKeyId ||
		key.HomeStationPeerId != proposal.HomeStationPeerId ||
		len(key.Ed25519PublicKey) != ed25519.PublicKeySize {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_FIELD_BINDING_MISMATCH,
			false,
		)
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		proposalSigningInput(proposal, kind),
	)
	if err != nil {
		return nil, fmt.Errorf("conversation: marshal proposal signing input: %w", err)
	}
	if !ed25519.Verify(
		ed25519.PublicKey(key.Ed25519PublicKey),
		signingBytes,
		proposal.ActorSignature,
	) {
		return reject(
			chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_ACTOR_SIGNATURE,
			false,
		)
	}

	event, err := s.authority.SubmitCommand(ctx, proposal.Command)
	if err != nil {
		var transitionErr *TransitionError
		if errors.As(err, &transitionErr) {
			return reject(rejectCodeForCommandError(transitionErr.Code), false)
		}
		return reject(rejectCodeForCommandError(err.Error()), false)
	}
	result := &chat.ConversationCommandProposalResult{
		CommandId:               proposal.Command.CommandId,
		Accepted:                true,
		CommittedEvent:          event,
		AuthorityGroupSeq:       event.GroupSeq,
		AuthorityEventHash:      event.EventHash,
		RequiredMembershipEpoch: event.MembershipEpoch,
	}
	if transition := event.GetMembershipTransitionCommitted(); transition != nil {
		result.RequiredMlsEpoch = transition.ToMlsEpoch
	} else {
		result.RequiredMlsEpoch = conversation.MlsEpoch
	}
	return result, nil
}

func validCommandProposalShape(proposal *chat.ConversationCommandProposal) bool {
	return proposal != nil &&
		proposal.Version == conversationCommandProposalVersion &&
		proposal.FederationId != "" &&
		proposal.AuthorityStationPeerId != "" &&
		proposal.HomeStationPeerId != "" &&
		proposal.ActorPtid != "" &&
		proposal.ActorDeviceId != "" &&
		proposal.ActorSigningKeyId != "" &&
		proposal.Command != nil &&
		proposal.Command.CommandId != "" &&
		proposal.Command.ConversationId != "" &&
		len(proposal.CommandSha256) == sha256.Size &&
		len(proposal.ActorSignature) == ed25519.SignatureSize
}

func validCommandProposalTime(now time.Time, createdAtUnixMs, expiresAtUnixMs int64) bool {
	if createdAtUnixMs <= 0 || expiresAtUnixMs <= createdAtUnixMs {
		return false
	}
	createdAt := time.UnixMilli(createdAtUnixMs)
	expiresAt := time.UnixMilli(expiresAtUnixMs)
	return !createdAt.After(now.Add(30*time.Second)) &&
		expiresAt.Sub(createdAt) <= maxCommandProposalLifetime
}

func proposalFieldsMatchCommand(proposal *chat.ConversationCommandProposal) bool {
	return proposal.Command.SenderPtid == proposal.ActorPtid &&
		proposal.Command.SenderDeviceId == proposal.ActorDeviceId
}

func proposalClaimsMatch(
	proposal *chat.ConversationCommandProposal,
	kind chat.ConversationCommandKind,
	claims ConversationCommandStationClaims,
) bool {
	return claims.Scope == conversationCommandProposalScope &&
		claims.Issuer == proposal.HomeStationPeerId &&
		claims.Audience == proposal.AuthorityStationPeerId &&
		claims.Subject == proposal.ActorPtid &&
		claims.Federation == proposal.FederationId &&
		claims.Conversation == proposal.Command.ConversationId &&
		claims.Command == proposal.Command.CommandId &&
		claims.CommandKind == strconv.Itoa(int(kind)) &&
		claims.Device == proposal.ActorDeviceId &&
		claims.SigningKey == proposal.ActorSigningKeyId &&
		claims.CommandHash == hex.EncodeToString(proposal.CommandSha256) &&
		claims.AuthorityEpoch == strconv.FormatInt(proposal.AuthorityEpoch, 10) &&
		claims.ExpiresAt == strconv.FormatInt(proposal.ExpiresAtUnixMs, 10)
}

func proposalSigningInput(
	proposal *chat.ConversationCommandProposal,
	kind chat.ConversationCommandKind,
) *chat.ConversationCommandProposalSigningInput {
	return &chat.ConversationCommandProposalSigningInput{
		Version:                proposal.Version,
		FederationId:           proposal.FederationId,
		AuthorityStationPeerId: proposal.AuthorityStationPeerId,
		AuthorityEpoch:         proposal.AuthorityEpoch,
		HomeStationPeerId:      proposal.HomeStationPeerId,
		ConversationId:         proposal.Command.ConversationId,
		CommandId:              proposal.Command.CommandId,
		CommandKind:            kind,
		ActorPtid:              proposal.ActorPtid,
		ActorDeviceId:          proposal.ActorDeviceId,
		ActorSigningKeyId:      proposal.ActorSigningKeyId,
		CommandSha256:          proposal.CommandSha256,
		CreatedAtUnixMs:        proposal.CreatedAtUnixMs,
		ExpiresAtUnixMs:        proposal.ExpiresAtUnixMs,
	}
}

func conversationCommandKind(command *chat.ConversationCommand) chat.ConversationCommandKind {
	if command == nil {
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
	switch command.Payload.(type) {
	case *chat.ConversationCommand_SendMessage:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE
	case *chat.ConversationCommand_EditMessage:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_EDIT_MESSAGE
	case *chat.ConversationCommand_RetractMessage:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_RETRACT_MESSAGE
	case *chat.ConversationCommand_Dissolve:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_DISSOLVE
	case *chat.ConversationCommand_UpdateSettings:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UPDATE_SETTINGS
	case *chat.ConversationCommand_React:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_REACT
	case *chat.ConversationCommand_PinMessage:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_PIN_MESSAGE
	case *chat.ConversationCommand_MembershipTransition:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBERSHIP_TRANSITION
	default:
		return chat.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED
	}
}

func (s *ConversationCommandProposalService) resolveActorKey(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	key, err := s.actorKeys.ResolveSigningKey(
		ctx,
		proposal.ActorPtid,
		proposal.ActorDeviceId,
		proposal.ActorSigningKeyId,
	)
	if err == nil || s.keyHydrator == nil {
		return key, err
	}
	if hydrateErr := s.keyHydrator.Hydrate(
		ctx,
		proposal.FederationId,
		proposal.HomeStationPeerId,
		proposal.ActorPtid,
	); hydrateErr != nil {
		return nil, err
	}
	return s.actorKeys.ResolveSigningKey(
		ctx,
		proposal.ActorPtid,
		proposal.ActorDeviceId,
		proposal.ActorSigningKeyId,
	)
}

func (s *ConversationCommandProposalService) rejectedResult(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
	code chat.ConversationCommandRejectCode,
) *chat.ConversationCommandProposalResult {
	result := &chat.ConversationCommandProposalResult{RejectCode: code}
	if proposal == nil || proposal.Command == nil {
		return result
	}
	result.CommandId = proposal.Command.CommandId
	conversation, err := s.authority.repo.GetConversation(ctx, proposal.Command.ConversationId)
	if err == nil {
		result.RequiredMembershipEpoch = conversation.MembershipEpoch
		result.RequiredMlsEpoch = conversation.MlsEpoch
	}
	head, err := s.authority.repo.GetLastEvent(ctx, proposal.Command.ConversationId)
	if err == nil {
		result.AuthorityGroupSeq = head.GroupSeq
		result.AuthorityEventHash = head.EventHash
	}
	return result
}

func rejectCodeForCommandError(code string) chat.ConversationCommandRejectCode {
	switch {
	case strings.Contains(code, "NOT_AUTHORITY"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_NOT_AUTHORITY
	case strings.Contains(code, "PERMISSION_DENIED"),
		strings.Contains(code, "NOT_MEMBER"),
		strings.Contains(code, "not a member"),
		strings.Contains(code, "membership not active"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_PERMISSION_DENIED
	case strings.Contains(code, "EPOCH_STALE"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_MEMBERSHIP_EPOCH_STALE
	case strings.Contains(code, "EPOCH_MISMATCH"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_MLS_EPOCH_MISMATCH
	case strings.Contains(code, "COMMAND_CONFLICT"),
		strings.Contains(code, "TRANSITION_CONFLICT"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_COMMAND_CONFLICT
	case strings.Contains(code, "GROUP_READ_ONLY"),
		strings.Contains(code, "not active"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_GROUP_READ_ONLY
	case strings.Contains(code, "PAYLOAD_TOO_LARGE"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_PAYLOAD_TOO_LARGE
	case strings.Contains(code, "TOO_MANY_RECIPIENTS"):
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_TOO_MANY_RECIPIENTS
	default:
		return chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_INVALID_PROPOSAL
	}
}
