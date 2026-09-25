package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	SocialRelationshipCommandFormatVersion uint32 = 1

	maxSocialRelationshipIdentifierBytes = 255
	maxSocialRelationshipCommandLifetime = 24 * time.Hour
	socialRelationshipClockSkew          = 30 * time.Second
)

type SocialRelationshipCommandRecord struct {
	ActorPTID            string
	CommandID            string
	CommandBytes         []byte
	CommandPayloadSHA256 []byte
	ResultBytes          []byte
	CreatedAt            time.Time
	ResolvedAt           *time.Time
}

type DirectionalRelationshipState struct {
	ActorPTID               string
	TargetActorPTID         string
	ActorHomeStationPeerID  string
	TargetHomeStationPeerID string
	Blocked                 bool
	Revision                int64
	LastEventHash           []byte
	LastEventBytes          []byte
	BlockedAt               *time.Time
	UpdatedAt               time.Time
}

func CanonicalSocialRelationshipSigningBytes(
	command *model.SocialRelationshipCommand,
) ([]byte, error) {
	const operation = "social.canonical_relationship_signing_bytes"
	if command == nil || command.GetBody() == nil {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command.body",
			"is required",
		)
	}
	input := &model.SocialRelationshipCommandSigningInput{
		Body:         command.GetBody(),
		SigningKeyId: command.GetSigningKeyId(),
	}
	if hasUnknownFields(command) ||
		hasUnknownFields(input) ||
		hasUnknownFields(input.GetBody()) {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command",
			"contains unknown fields",
		)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, WrapFederationError(
			FederationErrorInvalidArgument,
			operation,
			err,
		)
	}
	return encoded, nil
}

func ValidateSocialRelationshipCommand(
	command *model.SocialRelationshipCommand,
	localStationPeerID string,
	now time.Time,
) error {
	const operation = "social.validate_relationship_command"
	if command == nil || command.GetBody() == nil {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command.body",
			"is required",
		)
	}
	body := command.GetBody()
	if hasUnknownFields(command) ||
		hasUnknownFields(body) ||
		hasUnknownFields(body.GetActor()) ||
		hasUnknownFields(body.GetTargetActor()) ||
		hasUnknownFields(body.GetAuthorizingDevice()) ||
		hasUnknownFields(body.GetAuthorizingDevice().GetActor()) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command",
			"contains unknown fields",
		)
	}
	if body.GetFormatVersion() != SocialRelationshipCommandFormatVersion {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"format_version",
			"is unsupported",
		)
	}
	for _, identifier := range []struct {
		field string
		value string
	}{
		{field: "command_id", value: body.GetCommandId()},
		{field: "actor_home_station_peer_id", value: body.GetActorHomeStationPeerId()},
		{field: "target_home_station_peer_id", value: body.GetTargetHomeStationPeerId()},
		{field: "signing_key_id", value: command.GetSigningKeyId()},
		{field: "authorizing_device.device_id", value: body.GetAuthorizingDevice().GetDeviceId()},
		{field: "local_station_peer_id", value: localStationPeerID},
	} {
		if err := validateSocialRelationshipIdentifier(
			operation,
			identifier.field,
			identifier.value,
		); err != nil {
			return err
		}
	}
	if err := validateHumanActorRef(operation, "actor", body.GetActor()); err != nil {
		return err
	}
	if err := validateHumanActorRef(
		operation,
		"target_actor",
		body.GetTargetActor(),
	); err != nil {
		return err
	}
	if body.GetActor().GetPtid() == body.GetTargetActor().GetPtid() {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"target_actor.ptid",
			"must differ from actor.ptid",
		)
	}
	if body.GetActorHomeStationPeerId() != localStationPeerID {
		return NewFederationError(
			FederationErrorUnauthorized,
			operation,
			"actor_home_station_peer_id",
			"must be the local Home Station",
		)
	}
	if body.GetAuthorizingDevice().GetActor().GetPtid() !=
		body.GetActor().GetPtid() {
		return NewFederationError(
			FederationErrorUnauthorized,
			operation,
			"authorizing_device.actor",
			"must match the relationship actor",
		)
	}
	switch body.GetAction() {
	case model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_BLOCK,
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_UNBLOCK:
	default:
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"action",
			"is unspecified",
		)
	}
	if body.GetObservedRevision() < 0 {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"observed_revision",
			"must be non-negative",
		)
	}
	if len(command.GetActorDeviceSignature()) != ed25519.SignatureSize {
		return NewFederationError(
			FederationErrorInvalidSignature,
			operation,
			"actor_device_signature",
			"has an invalid length",
		)
	}
	return validateSocialRelationshipCommandTimes(operation, body, now.UTC())
}

func NewSocialRelationshipEvent(
	current *DirectionalRelationshipState,
	command *model.SocialRelationshipCommand,
	now time.Time,
) (*model.SocialRelationshipEvent, bool, error) {
	const operation = "social.apply_relationship_command"
	body := command.GetBody()
	currentRevision := int64(0)
	currentBlocked := false
	var previousHash []byte
	if current != nil {
		currentRevision = current.Revision
		currentBlocked = current.Blocked
		previousHash = append([]byte(nil), current.LastEventHash...)
	}
	if body.GetObservedRevision() != currentRevision {
		return nil, false, NewFederationError(
			FederationErrorStateConflict,
			operation,
			"observed_revision",
			"does not match the authoritative relationship revision",
		)
	}
	nextBlocked := body.GetAction() ==
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_BLOCK
	if currentBlocked == nextBlocked {
		return nil, true, nil
	}
	revision := currentRevision + 1
	event := &model.SocialRelationshipEvent{
		EventId:                 socialRelationshipEventID(body.GetCommandId(), revision),
		CommandId:               body.GetCommandId(),
		Action:                  body.GetAction(),
		Actor:                   cloneActorRef(body.GetActor()),
		TargetActor:             cloneActorRef(body.GetTargetActor()),
		ActorHomeStationPeerId:  body.GetActorHomeStationPeerId(),
		TargetHomeStationPeerId: body.GetTargetHomeStationPeerId(),
		Revision:                revision,
		Blocked:                 nextBlocked,
		CommittedAt:             timestamppb.New(now.UTC()),
		PreviousHash:            previousHash,
		InvalidationClasses:     relationshipInvalidations(nextBlocked),
	}
	canonical, err := canonicalSocialRelationshipEventHashInput(event)
	if err != nil {
		return nil, false, err
	}
	hash := sha256.Sum256(canonical)
	event.EventHash = hash[:]
	return event, false, nil
}

func ValidateSocialRelationshipEvent(
	event *model.SocialRelationshipEvent,
) error {
	const operation = "social.validate_relationship_event"
	if event == nil ||
		hasUnknownFields(event) ||
		hasUnknownFields(event.GetActor()) ||
		hasUnknownFields(event.GetTargetActor()) ||
		hasUnknownFields(event.GetCommittedAt()) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"is required and must not contain unknown fields",
		)
	}
	for _, identifier := range []struct {
		field string
		value string
	}{
		{field: "event_id", value: event.GetEventId()},
		{field: "command_id", value: event.GetCommandId()},
		{field: "actor_home_station_peer_id", value: event.GetActorHomeStationPeerId()},
		{field: "target_home_station_peer_id", value: event.GetTargetHomeStationPeerId()},
	} {
		if err := validateSocialRelationshipIdentifier(
			operation,
			identifier.field,
			identifier.value,
		); err != nil {
			return err
		}
	}
	if err := validateHumanActorRef(operation, "actor", event.GetActor()); err != nil {
		return err
	}
	if err := validateHumanActorRef(
		operation,
		"target_actor",
		event.GetTargetActor(),
	); err != nil {
		return err
	}
	if event.GetActor().GetPtid() == event.GetTargetActor().GetPtid() ||
		event.GetRevision() <= 0 ||
		event.GetCommittedAt().CheckValid() != nil ||
		len(event.GetEventHash()) != sha256.Size {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"contains an invalid actor pair, revision, timestamp, or hash",
		)
	}
	expectedBlocked := event.GetAction() ==
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_BLOCK
	if event.GetAction() !=
		model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_BLOCK &&
		event.GetAction() !=
			model.SocialRelationshipAction_SOCIAL_RELATIONSHIP_ACTION_UNBLOCK ||
		event.GetBlocked() != expectedBlocked {
		return NewFederationError(
			FederationErrorStateConflict,
			operation,
			"action",
			"does not match the resulting block state",
		)
	}
	expectedInvalidations := relationshipInvalidations(event.GetBlocked())
	if len(event.GetInvalidationClasses()) != len(expectedInvalidations) {
		return NewFederationError(
			FederationErrorStateConflict,
			operation,
			"invalidation_classes",
			"does not match the resulting relationship state",
		)
	}
	for index, expected := range expectedInvalidations {
		if event.GetInvalidationClasses()[index] != expected {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"invalidation_classes",
				"is not canonical",
			)
		}
	}
	if event.GetRevision() == 1 && len(event.GetPreviousHash()) != 0 ||
		event.GetRevision() > 1 && len(event.GetPreviousHash()) != sha256.Size {
		return NewFederationError(
			FederationErrorStateConflict,
			operation,
			"previous_hash",
			"does not extend the relationship hash chain",
		)
	}
	canonical, err := canonicalSocialRelationshipEventHashInput(event)
	if err != nil {
		return err
	}
	expected := sha256.Sum256(canonical)
	if !bytes.Equal(expected[:], event.GetEventHash()) {
		return NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"event_hash",
			"does not match deterministic event bytes",
		)
	}
	return nil
}

func ApplySocialRelationshipEvent(
	current *DirectionalRelationshipState,
	event *model.SocialRelationshipEvent,
) (DirectionalRelationshipState, bool, error) {
	const operation = "social.apply_relationship_event"
	if err := ValidateSocialRelationshipEvent(event); err != nil {
		return DirectionalRelationshipState{}, false, err
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return DirectionalRelationshipState{}, false, WrapFederationError(
			FederationErrorInvalidArgument,
			operation,
			err,
		)
	}
	if current != nil && current.Revision == event.GetRevision() {
		if bytes.Equal(current.LastEventHash, event.GetEventHash()) &&
			bytes.Equal(current.LastEventBytes, eventBytes) {
			return cloneDirectionalRelationshipState(*current), true, nil
		}
		return DirectionalRelationshipState{}, false, NewFederationError(
			FederationErrorIdempotencyConflict,
			operation,
			"event",
			"revision was reused with different canonical bytes",
		)
	}
	if current == nil {
		if event.GetRevision() != 1 || len(event.GetPreviousHash()) != 0 {
			return DirectionalRelationshipState{}, false, NewFederationError(
				FederationErrorStateConflict,
				operation,
				"revision",
				"must begin at revision 1",
			)
		}
	} else if event.GetRevision() != current.Revision+1 ||
		!bytes.Equal(event.GetPreviousHash(), current.LastEventHash) {
		return DirectionalRelationshipState{}, false, NewFederationError(
			FederationErrorStateConflict,
			operation,
			"revision",
			"does not extend the current relationship head",
		)
	}
	updatedAt := event.GetCommittedAt().AsTime().UTC()
	next := DirectionalRelationshipState{
		ActorPTID:               event.GetActor().GetPtid(),
		TargetActorPTID:         event.GetTargetActor().GetPtid(),
		ActorHomeStationPeerID:  event.GetActorHomeStationPeerId(),
		TargetHomeStationPeerID: event.GetTargetHomeStationPeerId(),
		Blocked:                 event.GetBlocked(),
		Revision:                event.GetRevision(),
		LastEventHash:           append([]byte(nil), event.GetEventHash()...),
		LastEventBytes:          eventBytes,
		UpdatedAt:               updatedAt,
	}
	if event.GetBlocked() {
		blockedAt := updatedAt
		next.BlockedAt = &blockedAt
	}
	return next, false, nil
}

func ValidateSocialRelationshipCommandResult(
	result *model.SocialRelationshipCommandResult,
) error {
	const operation = "social.validate_relationship_command_result"
	if result == nil || hasUnknownFields(result) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"result",
			"is required and must not contain unknown fields",
		)
	}
	if err := validateSocialRelationshipIdentifier(
		operation,
		"command_id",
		result.GetCommandId(),
	); err != nil {
		return err
	}
	if len(result.GetCommandPayloadSha256()) != sha256.Size {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"command_payload_sha256",
			"must be SHA-256",
		)
	}
	switch result.GetKind() {
	case model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_COMMITTED,
		model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_DUPLICATE:
		if result.GetProjection() == nil {
			return NewFederationError(
				FederationErrorInvalidArgument,
				operation,
				"projection",
				"is required for a successful result",
			)
		}
	case model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_REJECTED,
		model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_CONFLICT:
		if result.GetErrorCode() ==
			model.SocialRelationshipCommandErrorCode_SOCIAL_RELATIONSHIP_COMMAND_ERROR_CODE_UNSPECIFIED {
			return NewFederationError(
				FederationErrorInvalidArgument,
				operation,
				"error_code",
				"is required for a rejected result",
			)
		}
	default:
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"kind",
			"is unspecified",
		)
	}
	if result.GetEvent() != nil {
		if err := ValidateSocialRelationshipEvent(result.GetEvent()); err != nil {
			return err
		}
		if result.GetEvent().GetCommandId() != result.GetCommandId() {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"event.command_id",
				"does not match the result",
			)
		}
		if result.GetProjection().GetTargetActor().GetPtid() !=
			result.GetEvent().GetTargetActor().GetPtid() ||
			result.GetProjection().GetRevision() !=
				result.GetEvent().GetRevision() ||
			result.GetProjection().GetBlockedByViewer() !=
				result.GetEvent().GetBlocked() {
			return NewFederationError(
				FederationErrorStateConflict,
				operation,
				"projection",
				"does not match the committed event",
			)
		}
	}
	return nil
}

func canonicalSocialRelationshipEventHashInput(
	event *model.SocialRelationshipEvent,
) ([]byte, error) {
	const operation = "social.canonical_relationship_event_hash_input"
	if event == nil {
		return nil, NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"event",
			"is required",
		)
	}
	input := proto.Clone(event).(*model.SocialRelationshipEvent)
	input.EventHash = nil
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, WrapFederationError(
			FederationErrorInvalidArgument,
			operation,
			err,
		)
	}
	return encoded, nil
}

func validateSocialRelationshipCommandTimes(
	operation string,
	body *model.SocialRelationshipCommandBody,
	now time.Time,
) error {
	if body.GetCreatedAt() == nil || body.GetExpiresAt() == nil ||
		body.GetCreatedAt().CheckValid() != nil ||
		body.GetExpiresAt().CheckValid() != nil ||
		hasUnknownFields(body.GetCreatedAt()) ||
		hasUnknownFields(body.GetExpiresAt()) {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"created_at",
			"and expires_at must be valid timestamps",
		)
	}
	createdAt := body.GetCreatedAt().AsTime().UTC()
	expiresAt := body.GetExpiresAt().AsTime().UTC()
	if createdAt.After(now.Add(socialRelationshipClockSkew)) ||
		!expiresAt.After(now) ||
		!expiresAt.After(createdAt) ||
		expiresAt.Sub(createdAt) > maxSocialRelationshipCommandLifetime {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			"expires_at",
			"is outside the accepted command lifetime",
		)
	}
	return nil
}

func validateSocialRelationshipIdentifier(
	operation string,
	field string,
	value string,
) error {
	if value == "" ||
		value != strings.TrimSpace(value) ||
		len(value) > maxSocialRelationshipIdentifierBytes {
		return NewFederationError(
			FederationErrorInvalidArgument,
			operation,
			field,
			"is required, canonical, and bounded",
		)
	}
	return nil
}

func relationshipInvalidations(
	blocked bool,
) []model.SocialRelationshipInvalidationClass {
	if !blocked {
		return nil
	}
	return []model.SocialRelationshipInvalidationClass{
		model.SocialRelationshipInvalidationClass_SOCIAL_RELATIONSHIP_INVALIDATION_CLASS_FOLLOW,
		model.SocialRelationshipInvalidationClass_SOCIAL_RELATIONSHIP_INVALIDATION_CLASS_FRIEND_REQUEST_ELIGIBILITY,
		model.SocialRelationshipInvalidationClass_SOCIAL_RELATIONSHIP_INVALIDATION_CLASS_PRIVATE_CONTENT_GRANT,
		model.SocialRelationshipInvalidationClass_SOCIAL_RELATIONSHIP_INVALIDATION_CLASS_CONVERSATION_ENTRY,
	}
}

func SocialRelationshipProjectionFromState(
	target *model.ActorRef,
	targetHomeStationPeerID string,
	following bool,
	followedBy bool,
	blockedByViewer bool,
	interactionAllowed bool,
	revision int64,
) *model.SocialRelationshipProjection {
	projection := &model.SocialRelationshipProjection{
		TargetActor:             cloneActorRef(target),
		TargetHomeStationPeerId: targetHomeStationPeerID,
		Following:               following,
		FollowedBy:              followedBy,
		BlockedByViewer:         blockedByViewer,
		InteractionAllowed:      interactionAllowed,
		DeniedReason:            model.SocialRelationshipDeniedReason_SOCIAL_RELATIONSHIP_DENIED_REASON_NONE,
		Revision:                revision,
	}
	if !interactionAllowed {
		projection.Following = false
		projection.FollowedBy = false
		projection.DeniedReason =
			model.SocialRelationshipDeniedReason_SOCIAL_RELATIONSHIP_DENIED_REASON_INTERACTION_DENIED
		return projection
	}
	projection.AllowedActions = []model.SocialRelationshipAllowedAction{
		model.SocialRelationshipAllowedAction_SOCIAL_RELATIONSHIP_ALLOWED_ACTION_FOLLOW,
		model.SocialRelationshipAllowedAction_SOCIAL_RELATIONSHIP_ALLOWED_ACTION_FRIEND_REQUEST,
		model.SocialRelationshipAllowedAction_SOCIAL_RELATIONSHIP_ALLOWED_ACTION_DIRECT_CONVERSATION,
		model.SocialRelationshipAllowedAction_SOCIAL_RELATIONSHIP_ALLOWED_ACTION_PRIVATE_CONTENT,
	}
	return projection
}

func socialRelationshipEventID(commandID string, revision int64) string {
	return fmt.Sprintf("social-relationship-event:%s:%d", commandID, revision)
}

func cloneDirectionalRelationshipState(
	state DirectionalRelationshipState,
) DirectionalRelationshipState {
	cloned := state
	cloned.LastEventHash = append([]byte(nil), state.LastEventHash...)
	cloned.LastEventBytes = append([]byte(nil), state.LastEventBytes...)
	if state.BlockedAt != nil {
		blockedAt := state.BlockedAt.UTC()
		cloned.BlockedAt = &blockedAt
	}
	return cloned
}
