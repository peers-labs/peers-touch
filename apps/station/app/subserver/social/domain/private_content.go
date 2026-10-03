package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const (
	PrivateContentFormatVersion   uint32 = 1
	MaximumPrivateRecipientActors        = 256
	MaximumPrivateRecipientSlots         = 1000
	MaximumPrivateObjects                = 10
	MaximumPrivateMentionFacts           = 256
	MaximumPrivatePollOptions            = 20
	PrivateContentPlanLifetime           = 5 * time.Minute
)

type PrivateContentResourceKind string

const (
	PrivateContentResourcePost    PrivateContentResourceKind = "POST"
	PrivateContentResourceComment PrivateContentResourceKind = "COMMENT"
)

type PrivateContentErrorCode string

const (
	PrivateContentInvalidArgument         PrivateContentErrorCode = "SOCIAL_PRIVATE_INVALID_ARGUMENT"
	PrivateContentUnsupported             PrivateContentErrorCode = "SOCIAL_PRIVATE_UNSUPPORTED"
	PrivateContentUnauthorized            PrivateContentErrorCode = "SOCIAL_PRIVATE_UNAUTHORIZED"
	PrivateContentNotFound                PrivateContentErrorCode = "SOCIAL_PRIVATE_NOT_FOUND"
	PrivateContentConflict                PrivateContentErrorCode = "SOCIAL_PRIVATE_CONFLICT"
	PrivateContentStalePlan               PrivateContentErrorCode = "SOCIAL_PRIVATE_STALE_PLAN"
	PrivateContentExpiredPlan             PrivateContentErrorCode = "SOCIAL_PRIVATE_EXPIRED_PLAN"
	PrivateContentRateLimited             PrivateContentErrorCode = "SOCIAL_PRIVATE_RATE_LIMITED"
	PrivateContentRecipientKeyUnavailable PrivateContentErrorCode = "SOCIAL_PRIVATE_RECIPIENT_KEY_UNAVAILABLE"
	PrivateContentIntegrityFailed         PrivateContentErrorCode = "SOCIAL_PRIVATE_INTEGRITY_FAILED"
	PrivateContentDependency              PrivateContentErrorCode = "SOCIAL_PRIVATE_DEPENDENCY_FAILURE"
	PrivateContentIntegrationGap          PrivateContentErrorCode = "SOCIAL_PRIVATE_INTEGRATION_GAP"
	PrivateContentInternal                PrivateContentErrorCode = "SOCIAL_PRIVATE_INTERNAL"
)

// PrivateContentError is the transport-independent error returned by the W6
// private-content domain and application service.
type PrivateContentError struct {
	Code       PrivateContentErrorCode
	Operation  string
	Field      string
	Message    string
	Cause      error
	RetryAfter time.Duration
}

func (e *PrivateContentError) Error() string {
	switch {
	case e == nil:
		return ""
	case e.Field != "":
		return fmt.Sprintf("%s: %s: %s", e.Operation, e.Field, e.Message)
	case e.Operation != "":
		return fmt.Sprintf("%s: %s", e.Operation, e.Message)
	default:
		return e.Message
	}
}

func (e *PrivateContentError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func NewPrivateContentError(
	code PrivateContentErrorCode,
	operation string,
	field string,
	message string,
) error {
	return &PrivateContentError{
		Code:      code,
		Operation: operation,
		Field:     field,
		Message:   message,
	}
}

func WrapPrivateContentError(
	code PrivateContentErrorCode,
	operation string,
	cause error,
) error {
	if cause == nil {
		return nil
	}
	return &PrivateContentError{
		Code:      code,
		Operation: operation,
		Message:   cause.Error(),
		Cause:     cause,
	}
}

func NewPrivateContentRateLimitError(
	operation string,
	retryAfter time.Duration,
) error {
	if retryAfter < time.Second {
		retryAfter = time.Second
	}
	return &PrivateContentError{
		Code:       PrivateContentRateLimited,
		Operation:  operation,
		Field:      "comment_rate",
		Message:    "private Comment rate limit exceeded",
		RetryAfter: retryAfter,
	}
}

func PrivateContentCodeOf(err error) PrivateContentErrorCode {
	var domainError *PrivateContentError
	if errors.As(err, &domainError) {
		return domainError.Code
	}
	return ""
}

func IsPrivateContentCode(err error, code PrivateContentErrorCode) bool {
	return PrivateContentCodeOf(err) == code
}

func PrivateContentRetryAfter(err error) time.Duration {
	var domainError *PrivateContentError
	if errors.As(err, &domainError) {
		return domainError.RetryAfter
	}
	return 0
}

// PrivateContentAuthor is the authenticated device and its authoritative home
// Station identity. The private service never derives either from request data.
type PrivateContentAuthor struct {
	Endpoint          *actormodel.ActorDeviceRef
	HomeStationPeerID string
}

func (a PrivateContentAuthor) Validate(operation string) error {
	if err := validateActorDeviceRef(a.Endpoint, "author", operation); err != nil {
		return err
	}
	if err := validateIdentifier(
		a.HomeStationPeerID,
		255,
		"author_home_station_peer_id",
		operation,
	); err != nil {
		return err
	}
	return nil
}

// FriendsSnapshot is the Social-owned frozen audience projection used by one
// prepare. RecipientPTIDs excludes the author and is canonicalized before use.
// The name is retained inside the W6 service surface, but Audience is the exact
// Social authority descriptor and must never be inferred from the recipients.
type FriendsSnapshot struct {
	Audience            *actormodel.Audience
	SourceRevision      uint64
	SourceHeadSHA256    []byte
	RecipientPTIDs      []string
	RecipientLocalities []RecipientLocality
}

// RecipientLocality binds one frozen recipient to its canonical Home Station.
type RecipientLocality struct {
	ActorPTID         string
	HomeStationPeerID string
	FederationID      string
}

// GroupRecipientSnapshot is Social's value-only projection of Conversation
// membership authority. It never carries a Conversation repository or UOW.
type GroupRecipientSnapshot struct {
	ConversationID      string
	AuthorPTID          string
	MembershipEpoch     uint64
	AuthorityHeadSHA256 []byte
	Members             []RecipientLocality
}

type canonicalGroupRecipientSnapshot struct {
	FormatVersion       uint32                          `json:"format_version"`
	ConversationID      string                          `json:"conversation_id"`
	AuthorPTID          string                          `json:"author_ptid"`
	MembershipEpoch     uint64                          `json:"membership_epoch"`
	AuthorityHeadSHA256 []byte                          `json:"authority_head_sha256"`
	Members             []canonicalGroupRecipientMember `json:"members"`
}

type canonicalGroupRecipientMember struct {
	ActorPTID         string `json:"actor_ptid"`
	HomeStationPeerID string `json:"home_station_peer_id"`
}

// CanonicalGroupRecipientSnapshotBytes encodes the exact Conversation-owned
// prepare snapshot persisted by Social for submit-time fencing.
func CanonicalGroupRecipientSnapshotBytes(
	snapshot GroupRecipientSnapshot,
) ([]byte, error) {
	const operation = "social.private_content.canonical_group_snapshot"
	if err := validateGroupRecipientSnapshot(operation, snapshot); err != nil {
		return nil, err
	}

	members := make(
		[]canonicalGroupRecipientMember,
		0,
		len(snapshot.Members),
	)
	for _, member := range snapshot.Members {
		members = append(members, canonicalGroupRecipientMember{
			ActorPTID:         member.ActorPTID,
			HomeStationPeerID: member.HomeStationPeerID,
		})
	}
	encoded, err := json.Marshal(canonicalGroupRecipientSnapshot{
		FormatVersion:       PrivateContentFormatVersion,
		ConversationID:      snapshot.ConversationID,
		AuthorPTID:          snapshot.AuthorPTID,
		MembershipEpoch:     snapshot.MembershipEpoch,
		AuthorityHeadSHA256: cloneBytes(snapshot.AuthorityHeadSHA256),
		Members:             members,
	})
	if err != nil {
		return nil, WrapPrivateContentError(
			PrivateContentInternal,
			operation,
			err,
		)
	}

	return encoded, nil
}

// ParseCanonicalGroupRecipientSnapshot accepts only the exact canonical bytes
// emitted by CanonicalGroupRecipientSnapshotBytes.
func ParseCanonicalGroupRecipientSnapshot(
	encoded []byte,
) (GroupRecipientSnapshot, error) {
	const operation = "social.private_content.parse_group_snapshot"
	if len(encoded) == 0 {
		return GroupRecipientSnapshot{}, NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"group_snapshot",
			"is required",
		)
	}

	var persisted canonicalGroupRecipientSnapshot
	if err := json.Unmarshal(encoded, &persisted); err != nil {
		return GroupRecipientSnapshot{}, WrapPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	if persisted.FormatVersion != PrivateContentFormatVersion {
		return GroupRecipientSnapshot{}, NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"format_version",
			"is unsupported",
		)
	}
	members := make([]RecipientLocality, 0, len(persisted.Members))
	for _, member := range persisted.Members {
		members = append(members, RecipientLocality{
			ActorPTID:         member.ActorPTID,
			HomeStationPeerID: member.HomeStationPeerID,
		})
	}
	snapshot := GroupRecipientSnapshot{
		ConversationID:      persisted.ConversationID,
		AuthorPTID:          persisted.AuthorPTID,
		MembershipEpoch:     persisted.MembershipEpoch,
		AuthorityHeadSHA256: cloneBytes(persisted.AuthorityHeadSHA256),
		Members:             members,
	}
	if err := validateGroupRecipientSnapshot(operation, snapshot); err != nil {
		return GroupRecipientSnapshot{}, err
	}
	canonical, err := CanonicalGroupRecipientSnapshotBytes(snapshot)
	if err != nil {
		return GroupRecipientSnapshot{}, err
	}
	if !bytes.Equal(encoded, canonical) {
		return GroupRecipientSnapshot{}, NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"group_snapshot",
			"is not canonically encoded",
		)
	}

	return snapshot, nil
}

func validateGroupRecipientSnapshot(
	operation string,
	snapshot GroupRecipientSnapshot,
) error {
	if err := validateIdentifier(
		snapshot.ConversationID,
		255,
		"conversation_id",
		operation,
	); err != nil {
		return err
	}
	if err := validateIdentifier(
		snapshot.AuthorPTID,
		255,
		"author_ptid",
		operation,
	); err != nil {
		return err
	}
	if snapshot.MembershipEpoch == 0 {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"membership_epoch",
			"must be positive",
		)
	}
	if len(snapshot.AuthorityHeadSHA256) != sha256.Size {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"authority_head_sha256",
			"must contain one SHA-256 digest",
		)
	}
	if len(snapshot.Members) == 0 ||
		len(snapshot.Members) > MaximumPrivateRecipientActors+1 {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"members",
			"must contain a bounded active Group membership",
		)
	}

	previous := ""
	authorFound := false
	for _, member := range snapshot.Members {
		if err := validateIdentifier(
			member.ActorPTID,
			255,
			"members.actor_ptid",
			operation,
		); err != nil {
			return err
		}
		if err := validateIdentifier(
			member.HomeStationPeerID,
			255,
			"members.home_station_peer_id",
			operation,
		); err != nil {
			return err
		}
		if member.ActorPTID <= previous {
			return NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"members",
				"must be unique and ordered by actor PTID",
			)
		}
		if member.ActorPTID == snapshot.AuthorPTID {
			authorFound = true
		}
		previous = member.ActorPTID
	}
	if !authorFound {
		return NewPrivateContentError(
			PrivateContentUnauthorized,
			operation,
			"author_ptid",
			"is not an active Group member",
		)
	}

	return nil
}

func NormalizeFriendsSnapshot(
	operation string,
	authorPTID string,
	snapshot FriendsSnapshot,
) (FriendsSnapshot, [sha256.Size]byte, error) {
	if err := validateIdentifier(
		authorPTID,
		255,
		"author_ptid",
		operation,
	); err != nil {
		return FriendsSnapshot{}, [sha256.Size]byte{}, err
	}
	if err := ValidateAudience(snapshot.Audience); err != nil {
		return FriendsSnapshot{}, [sha256.Size]byte{}, WrapPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			err,
		)
	}
	if snapshot.Audience.GetKind() == actormodel.Audience_PUBLIC {
		return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"audience",
			"private content cannot use PUBLIC audience",
		)
	}
	if snapshot.SourceRevision == 0 {
		return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"source_revision",
			"must be positive",
		)
	}
	if len(snapshot.SourceHeadSHA256) != sha256.Size {
		return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"source_head_sha256",
			"must contain one SHA-256 digest",
		)
	}
	if len(snapshot.RecipientPTIDs) > MaximumPrivateRecipientActors ||
		(len(snapshot.RecipientPTIDs) == 0 &&
			snapshot.Audience.GetKind() != actormodel.Audience_SELF) {
		return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"recipient_ptids",
			"must contain between 1 and 256 recipients unless audience is SELF",
		)
	}

	normalized := FriendsSnapshot{
		Audience:            proto.Clone(snapshot.Audience).(*actormodel.Audience),
		SourceRevision:      snapshot.SourceRevision,
		SourceHeadSHA256:    cloneBytes(snapshot.SourceHeadSHA256),
		RecipientPTIDs:      append([]string(nil), snapshot.RecipientPTIDs...),
		RecipientLocalities: append([]RecipientLocality(nil), snapshot.RecipientLocalities...),
	}
	sort.Strings(normalized.Audience.ActorPtids)
	previousActor := ""
	for _, actorPTID := range normalized.Audience.ActorPtids {
		if err := validateIdentifier(
			actorPTID,
			255,
			"audience.actor_ptids",
			operation,
		); err != nil {
			return FriendsSnapshot{}, [sha256.Size]byte{}, err
		}
		if actorPTID == previousActor {
			return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"audience.actor_ptids",
				"must be unique",
			)
		}
		previousActor = actorPTID
	}
	sort.Strings(normalized.RecipientPTIDs)
	previous := ""
	for _, recipientPTID := range normalized.RecipientPTIDs {
		if err := validateIdentifier(
			recipientPTID,
			255,
			"recipient_ptids",
			operation,
		); err != nil {
			return FriendsSnapshot{}, [sha256.Size]byte{}, err
		}
		if recipientPTID == authorPTID || recipientPTID == previous {
			return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"recipient_ptids",
				"must be unique and must not contain the author",
			)
		}
		previous = recipientPTID
	}
	sort.Slice(normalized.RecipientLocalities, func(left int, right int) bool {
		return normalized.RecipientLocalities[left].ActorPTID <
			normalized.RecipientLocalities[right].ActorPTID
	})
	if normalized.Audience.GetKind() == actormodel.Audience_SELF {
		if len(normalized.RecipientLocalities) != 0 {
			return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"recipient_localities",
				"SELF audience must not contain recipient localities",
			)
		}
	} else if len(normalized.RecipientLocalities) != len(normalized.RecipientPTIDs) {
		return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"recipient_localities",
			"must cover every recipient exactly once",
		)
	}
	for index, locality := range normalized.RecipientLocalities {
		if err := validateIdentifier(
			locality.ActorPTID,
			255,
			"recipient_localities.actor_ptid",
			operation,
		); err != nil {
			return FriendsSnapshot{}, [sha256.Size]byte{}, err
		}
		if err := validateIdentifier(
			locality.HomeStationPeerID,
			255,
			"recipient_localities.home_station_peer_id",
			operation,
		); err != nil {
			return FriendsSnapshot{}, [sha256.Size]byte{}, err
		}
		if locality.FederationID != "" {
			if err := validateIdentifier(
				locality.FederationID,
				255,
				"recipient_localities.federation_id",
				operation,
			); err != nil {
				return FriendsSnapshot{}, [sha256.Size]byte{}, err
			}
		}
		if locality.ActorPTID != normalized.RecipientPTIDs[index] {
			return FriendsSnapshot{}, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"recipient_localities",
				"must match the canonical recipient order",
			)
		}
	}

	audienceBytes, err := CanonicalProtoBytes(normalized.Audience)
	if err != nil {
		return FriendsSnapshot{}, [sha256.Size]byte{}, err
	}
	canonical := appendVarintField(
		nil,
		1,
		uint64(PrivateContentFormatVersion),
	)
	canonical = appendStringField(canonical, 2, authorPTID)
	canonical = appendBytesField(canonical, 3, audienceBytes)
	canonical = appendVarintField(
		canonical,
		4,
		normalized.SourceRevision,
	)
	canonical = appendBytesField(
		canonical,
		5,
		normalized.SourceHeadSHA256,
	)
	for _, recipientPTID := range normalized.RecipientPTIDs {
		canonical = appendStringField(canonical, 6, recipientPTID)
	}
	for _, locality := range normalized.RecipientLocalities {
		localityBytes := appendStringField(nil, 1, locality.ActorPTID)
		localityBytes = appendStringField(
			localityBytes,
			2,
			locality.HomeStationPeerID,
		)
		if locality.FederationID != "" {
			localityBytes = appendStringField(
				localityBytes,
				3,
				locality.FederationID,
			)
		}
		canonical = appendBytesField(canonical, 7, localityBytes)
	}
	return normalized, sha256.Sum256(canonical), nil
}

type PrivatePrepareMaterial struct {
	ResourceKind                  PrivateContentResourceKind
	ContentID                     string
	ParentPostID                  string
	ReplyToCommentID              string
	CommandID                     string
	MomentKind                    privatecontentpb.PrivateMomentKind
	AudienceKind                  actormodel.Audience_Kind
	Audience                      *actormodel.Audience
	ObjectCount                   uint32
	SubtypePrepareAuthorityBytes  []byte
	SubtypePrepareAuthoritySHA256 [sha256.Size]byte
	CanonicalBytes                []byte
	CanonicalSHA256               [sha256.Size]byte
	DomainBinding                 []byte
	DomainBindingHash             [sha256.Size]byte
}

func CanonicalizePrivateMomentPrepare(
	request *privatecontentpb.PreparePrivateMomentRequest,
) (PrivatePrepareMaterial, error) {
	const operation = "social.private_content.prepare_moment"

	if err := validateKnownMessage(request, "request", operation); err != nil {
		return PrivatePrepareMaterial{}, err
	}
	if err := validateIdentifier(
		request.GetCommandId(),
		128,
		"command_id",
		operation,
	); err != nil {
		return PrivatePrepareMaterial{}, err
	}
	if err := ValidatePrivateContentID(
		request.GetContentId(),
		"content_id",
		operation,
	); err != nil {
		return PrivatePrepareMaterial{}, err
	}
	if request.GetAudience().GetKind() == actormodel.Audience_CUSTOM_DENY &&
		request.GetAudience().GetBaseKind() == actormodel.Audience_PUBLIC {
		return PrivatePrepareMaterial{}, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"audience.base_kind",
			"CUSTOM_DENY(PUBLIC) is unsupported in v1",
		)
	}
	if err := ValidateAudience(request.GetAudience()); err != nil {
		return PrivatePrepareMaterial{}, WrapPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			err,
		)
	}
	audience := proto.Clone(request.GetAudience()).(*actormodel.Audience)
	sort.Strings(audience.ActorPtids)
	for index, actorPTID := range audience.ActorPtids {
		if err := validateIdentifier(
			actorPTID,
			255,
			"audience.actor_ptids",
			operation,
		); err != nil {
			return PrivatePrepareMaterial{}, err
		}
		if index > 0 && actorPTID == audience.ActorPtids[index-1] {
			return PrivatePrepareMaterial{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"audience.actor_ptids",
				"must be unique",
			)
		}
	}
	switch request.GetKind() {
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LINK,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_POLL,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_REPOST,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LOCATION:
		if request.GetObjectCount() != 0 {
			return PrivatePrepareMaterial{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"object_count",
				"TEXT-like kind requires zero objects",
			)
		}
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_VIDEO:
		if request.GetObjectCount() == 0 ||
			request.GetObjectCount() > MaximumPrivateObjects {
			return PrivatePrepareMaterial{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"object_count",
				"IMAGE/VIDEO requires between 1 and 10 objects",
			)
		}
	default:
		return PrivatePrepareMaterial{}, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"kind",
			"unsupported PrivateMomentKind",
		)
	}

	audienceBytes, err := CanonicalProtoBytes(audience)
	if err != nil {
		return PrivatePrepareMaterial{}, WrapPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			err,
		)
	}
	audienceHash := sha256.Sum256(audienceBytes)
	subtypeAuthorityBytes, subtypeAuthorityHash, err :=
		canonicalizePrivatePrepareSubtypeAuthority(request)
	if err != nil {
		return PrivatePrepareMaterial{}, err
	}
	var subtypeAuthorityHashField []byte
	if len(subtypeAuthorityBytes) > 0 {
		subtypeAuthorityHashField = subtypeAuthorityHash[:]
	}
	hashInput := &privatecontentpb.PreparePrivateMomentHashInput{
		FormatVersion:                 PrivateContentFormatVersion,
		CommandId:                     request.GetCommandId(),
		ContentId:                     request.GetContentId(),
		Kind:                          request.GetKind(),
		AudienceSha256:                audienceHash[:],
		ObjectCount:                   request.GetObjectCount(),
		SubtypePrepareAuthoritySha256: subtypeAuthorityHashField,
	}
	canonical, err := CanonicalProtoBytes(hashInput)
	if err != nil {
		return PrivatePrepareMaterial{}, err
	}
	domainBinding := &privatecontentpb.PrivateMomentDomainBinding{
		FormatVersion:                 PrivateContentFormatVersion,
		Kind:                          request.GetKind(),
		SubtypePrepareAuthoritySha256: subtypeAuthorityHashField,
	}
	domainBindingBytes, err := CanonicalProtoBytes(domainBinding)
	if err != nil {
		return PrivatePrepareMaterial{}, err
	}

	return PrivatePrepareMaterial{
		ResourceKind:                  PrivateContentResourcePost,
		ContentID:                     request.GetContentId(),
		CommandID:                     request.GetCommandId(),
		MomentKind:                    request.GetKind(),
		AudienceKind:                  request.GetAudience().GetKind(),
		Audience:                      audience,
		ObjectCount:                   request.GetObjectCount(),
		SubtypePrepareAuthorityBytes:  subtypeAuthorityBytes,
		SubtypePrepareAuthoritySHA256: subtypeAuthorityHash,
		CanonicalBytes:                canonical,
		CanonicalSHA256:               sha256.Sum256(canonical),
		DomainBinding:                 domainBindingBytes,
		DomainBindingHash:             sha256.Sum256(domainBindingBytes),
	}, nil
}

func canonicalizePrivatePrepareSubtypeAuthority(
	request *privatecontentpb.PreparePrivateMomentRequest,
) ([]byte, [sha256.Size]byte, error) {
	const operation = "social.private_content.prepare_moment"
	emptyHash := sha256.Sum256(nil)
	switch request.GetKind() {
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_POLL:
		if request.GetPollAuthority() == nil ||
			request.GetRepostAuthority() != nil {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"poll_authority",
				"POLL requires exactly one poll authority",
			)
		}
		if err := ValidatePrivatePollAuthority(
			request.GetPollAuthority(),
			request.GetContentId(),
			operation,
		); err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		canonical, err := CanonicalProtoBytes(request.GetPollAuthority())
		if err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		return canonical, sha256.Sum256(canonical), nil
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_REPOST:
		if request.GetRepostAuthority() == nil ||
			request.GetPollAuthority() != nil {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"repost_authority",
				"REPOST requires exactly one repost authority",
			)
		}
		if err := ValidatePrivateRepostAuthority(
			request.GetRepostAuthority(),
			operation,
		); err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		canonical, err := CanonicalProtoBytes(request.GetRepostAuthority())
		if err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		return canonical, sha256.Sum256(canonical), nil
	default:
		if request.GetPollAuthority() != nil ||
			request.GetRepostAuthority() != nil {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"subtype_authority",
				"is allowed only for POLL or REPOST",
			)
		}
		return nil, emptyHash, nil
	}
}

func ValidatePrivatePollAuthority(
	authority *privatecontentpb.PrivatePollAuthority,
	contentID string,
	operation string,
) error {
	if authority == nil ||
		authority.GetResource().GetOwnerDomain() !=
			securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		authority.GetResource().GetContentId() != contentID ||
		authority.GetResource().GetGeneration() != 1 ||
		len(authority.GetOpaqueOptionIds()) < 2 ||
		len(authority.GetOpaqueOptionIds()) > MaximumPrivatePollOptions ||
		authority.GetMinChoices() < 1 ||
		authority.GetMinChoices() > authority.GetMaxChoices() ||
		authority.GetMaxChoices() >
			uint32(len(authority.GetOpaqueOptionIds())) ||
		authority.GetExpiresAt() == nil ||
		!authority.GetExpiresAt().IsValid() {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"poll_authority",
			"is incomplete or outside the supported bounds",
		)
	}
	optionSetBytes := make([]byte, 0)
	previous := []byte(nil)
	for index, optionID := range authority.GetOpaqueOptionIds() {
		if len(optionID) != sha256.Size ||
			(index > 0 && bytes.Compare(previous, optionID) >= 0) {
			return NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"poll_authority.opaque_option_ids",
				"must contain ordered unique 32-byte values",
			)
		}
		optionSetBytes = appendBytesField(optionSetBytes, 1, optionID)
		previous = optionID
	}
	optionSetHash := sha256.Sum256(optionSetBytes)
	if !bytes.Equal(
		authority.GetOptionSetSha256(),
		optionSetHash[:],
	) {
		return NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"poll_authority.option_set_sha256",
			"does not match the canonical option set",
		)
	}
	return nil
}

func ValidatePrivateRepostAuthority(
	authority *privatecontentpb.PrivateRepostAuthority,
	operation string,
) error {
	source := authority.GetSource()
	author := authority.GetSourceAuthor()
	if source == nil ||
		source.GetPostId() == "" ||
		len(authority.GetRenderedSourceCommitment()) != sha256.Size ||
		author == nil ||
		author.GetPtid() == "" ||
		author.GetPtid() != strings.TrimSpace(author.GetPtid()) {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"repost_authority",
			"is incomplete",
		)
	}
	switch proof := authority.GetSourceProof().(type) {
	case *privatecontentpb.PrivateRepostAuthority_PublicSource:
		if source.GetPrivateContentId() != "" ||
			source.GetPrivateGeneration() != 0 ||
			proof.PublicSource == nil ||
			len(proof.PublicSource.GetCanonicalPublicPostSha256()) !=
				sha256.Size {
			return NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"repost_authority.public_source",
				"is invalid",
			)
		}
	case *privatecontentpb.PrivateRepostAuthority_PrivateSource:
		privateProof := proof.PrivateSource
		if privateProof == nil ||
			source.GetPrivateContentId() == "" ||
			source.GetPrivateGeneration() == 0 ||
			privateProof.GetSourceResource().GetOwnerDomain() !=
				securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
			privateProof.GetSourceResource().GetContentId() !=
				source.GetPrivateContentId() ||
			privateProof.GetSourceResource().GetGeneration() !=
				source.GetPrivateGeneration() ||
			len(privateProof.GetSourceAuthorizationSnapshotSha256()) !=
				sha256.Size ||
			len(privateProof.GetSourceEncryptedPayloadSha256()) !=
				sha256.Size ||
			len(privateProof.GetSourceCommitProofSha256()) != sha256.Size {
			return NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"repost_authority.private_source",
				"is invalid",
			)
		}
	default:
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"repost_authority.source_proof",
			"is required",
		)
	}
	return nil
}

func CanonicalizePrivateCommentPrepare(
	request *privatecontentpb.PreparePrivateCommentRequest,
) (PrivatePrepareMaterial, error) {
	const operation = "social.private_content.prepare_comment"

	if err := validateKnownMessage(request, "request", operation); err != nil {
		return PrivatePrepareMaterial{}, err
	}
	if err := validateIdentifier(
		request.GetCommandId(),
		128,
		"command_id",
		operation,
	); err != nil {
		return PrivatePrepareMaterial{}, err
	}
	for field, value := range map[string]string{
		"post_id":            request.GetPostId(),
		"comment_content_id": request.GetCommentContentId(),
	} {
		if err := ValidatePrivateContentID(value, field, operation); err != nil {
			return PrivatePrepareMaterial{}, err
		}
	}
	if request.GetReplyToCommentId() != "" {
		if err := ValidatePrivateContentID(
			request.GetReplyToCommentId(),
			"reply_to_comment_id",
			operation,
		); err != nil {
			return PrivatePrepareMaterial{}, err
		}
	}
	if request.GetObjectCount() > MaximumPrivateObjects {
		return PrivatePrepareMaterial{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"object_count",
			"exceeds the W6 object limit",
		)
	}

	hashInput := &privatecontentpb.PreparePrivateCommentHashInput{
		FormatVersion:    PrivateContentFormatVersion,
		CommandId:        request.GetCommandId(),
		PostId:           request.GetPostId(),
		CommentContentId: request.GetCommentContentId(),
		ReplyToCommentId: request.GetReplyToCommentId(),
		ObjectCount:      request.GetObjectCount(),
	}
	canonical, err := CanonicalProtoBytes(hashInput)
	if err != nil {
		return PrivatePrepareMaterial{}, err
	}
	domainBinding := &privatecontentpb.PrivateCommentDomainBinding{
		FormatVersion:    PrivateContentFormatVersion,
		PostId:           request.GetPostId(),
		ReplyToCommentId: request.GetReplyToCommentId(),
	}
	domainBindingBytes, err := CanonicalProtoBytes(domainBinding)
	if err != nil {
		return PrivatePrepareMaterial{}, err
	}

	return PrivatePrepareMaterial{
		ResourceKind:                  PrivateContentResourceComment,
		ContentID:                     request.GetCommentContentId(),
		ParentPostID:                  request.GetPostId(),
		ReplyToCommentID:              request.GetReplyToCommentId(),
		CommandID:                     request.GetCommandId(),
		ObjectCount:                   request.GetObjectCount(),
		SubtypePrepareAuthoritySHA256: sha256.Sum256(nil),
		CanonicalBytes:                canonical,
		CanonicalSHA256:               sha256.Sum256(canonical),
		DomainBinding:                 domainBindingBytes,
		DomainBindingHash:             sha256.Sum256(domainBindingBytes),
	}, nil
}

type PrivateEnvelopeMaterial struct {
	Envelope         *securecontentpb.PreparedContentKeyEnvelope
	CanonicalBytes   []byte
	EnvelopeSHA256   [sha256.Size]byte
	SigningBytes     []byte
	SenderSigningKey string
}

type PrivateObjectMaterial struct {
	Descriptor       *securecontentpb.EncryptedObjectDescriptor
	CanonicalBytes   []byte
	DescriptorSHA256 [sha256.Size]byte
}

type PrivateSubmitMaterial struct {
	CommandID                 string
	CanonicalBytes            []byte
	CanonicalSHA256           [sha256.Size]byte
	EncryptedPayloadBytes     []byte
	EncryptedPayloadSHA256    [sha256.Size]byte
	ObjectDescriptorSetSHA256 [sha256.Size]byte
	MentionRouting            *privatecontentpb.SignedMentionRouting
	MentionRoutingBytes       []byte
	MentionRoutingSHA256      [sha256.Size]byte
	SubtypeAuthoritySHA256    [sha256.Size]byte
	Envelopes                 []PrivateEnvelopeMaterial
	Objects                   []PrivateObjectMaterial
}

func CanonicalizePrivateMomentSubmit(
	request *privatecontentpb.SubmitPrivateMomentRequest,
	author *actormodel.ActorDeviceRef,
	kind privatecontentpb.PrivateMomentKind,
	_ time.Time,
	policy securecontentkernel.Policy,
) (PrivateSubmitMaterial, error) {
	const operation = "social.private_content.submit_moment"

	if request == nil {
		return PrivateSubmitMaterial{}, requiredMessageError(operation, "request")
	}
	var subtypeAuthority proto.Message
	switch kind {
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LINK,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_POLL,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_REPOST,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_LOCATION:
		if len(request.GetObjects()) != 0 {
			return PrivateSubmitMaterial{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"objects",
				"TEXT-like kind requires zero objects",
			)
		}
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE,
		privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_VIDEO:
		if len(request.GetObjects()) == 0 {
			return PrivateSubmitMaterial{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"objects",
				"IMAGE/VIDEO requires at least one object",
			)
		}
	default:
		return PrivateSubmitMaterial{}, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"kind",
			"unsupported PrivateMomentKind",
		)
	}
	switch kind {
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_POLL:
		if request.GetPollAuthority() == nil ||
			request.GetRepostAuthority() != nil {
			return PrivateSubmitMaterial{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"poll_authority",
				"POLL requires exactly one poll authority",
			)
		}
		if err := ValidatePrivatePollAuthority(
			request.GetPollAuthority(),
			request.GetPlan().GetResource().GetContentId(),
			operation,
		); err != nil {
			return PrivateSubmitMaterial{}, err
		}
		subtypeAuthority = request.GetPollAuthority()
	case privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_REPOST:
		if request.GetRepostAuthority() == nil ||
			request.GetPollAuthority() != nil {
			return PrivateSubmitMaterial{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"repost_authority",
				"REPOST requires exactly one repost authority",
			)
		}
		if err := ValidatePrivateRepostAuthority(
			request.GetRepostAuthority(),
			operation,
		); err != nil {
			return PrivateSubmitMaterial{}, err
		}
		subtypeAuthority = request.GetRepostAuthority()
	default:
		if request.GetPollAuthority() != nil ||
			request.GetRepostAuthority() != nil {
			return PrivateSubmitMaterial{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				"subtype_authority",
				"is allowed only for POLL or REPOST",
			)
		}
	}
	return canonicalizePrivateSubmit(
		operation,
		request,
		request.GetCommandId(),
		request.GetPlan(),
		request.GetPayload(),
		request.GetEnvelopes(),
		request.GetObjects(),
		request.GetMentionRouting(),
		subtypeAuthority,
		author,
		policy,
	)
}

func CanonicalizePrivateCommentSubmit(
	request *privatecontentpb.SubmitPrivateCommentRequest,
	author *actormodel.ActorDeviceRef,
	_ time.Time,
	policy securecontentkernel.Policy,
) (PrivateSubmitMaterial, error) {
	const operation = "social.private_content.submit_comment"

	if request == nil {
		return PrivateSubmitMaterial{}, requiredMessageError(operation, "request")
	}
	return canonicalizePrivateSubmit(
		operation,
		request,
		request.GetCommandId(),
		request.GetPlan(),
		request.GetPayload(),
		request.GetEnvelopes(),
		request.GetObjects(),
		request.GetMentionRouting(),
		nil,
		author,
		policy,
	)
}

func canonicalizePrivateSubmit(
	operation string,
	request proto.Message,
	commandID string,
	plan *securecontentpb.ContentEncryptionPlan,
	payload *securecontentpb.EncryptedPayload,
	envelopes []*securecontentpb.PreparedContentKeyEnvelope,
	objects []*securecontentpb.EncryptedObjectDescriptor,
	mentionRouting *privatecontentpb.SignedMentionRouting,
	subtypeAuthority proto.Message,
	author *actormodel.ActorDeviceRef,
	policy securecontentkernel.Policy,
) (PrivateSubmitMaterial, error) {
	if err := validateKnownMessage(request, "request", operation); err != nil {
		return PrivateSubmitMaterial{}, err
	}
	if err := validateIdentifier(commandID, 128, "command_id", operation); err != nil {
		return PrivateSubmitMaterial{}, err
	}
	if err := validateActorDeviceRef(author, "author", operation); err != nil {
		return PrivateSubmitMaterial{}, err
	}
	if err := securecontentkernel.ValidateContentEncryptionPlan(plan, policy); err != nil {
		return PrivateSubmitMaterial{}, mapKernelError(operation, err)
	}
	if !proto.Equal(plan.GetAuthor(), author) {
		return PrivateSubmitMaterial{}, NewPrivateContentError(
			PrivateContentUnauthorized,
			operation,
			"plan.author",
			"does not match the authenticated endpoint",
		)
	}
	if err := ValidateCanonicalEncryptionPlan(plan); err != nil {
		return PrivateSubmitMaterial{}, err
	}
	if err := securecontentkernel.ValidateEncryptedPayload(payload, policy); err != nil {
		return PrivateSubmitMaterial{}, mapKernelError(operation, err)
	}
	if !securecontentkernel.EqualResourceRef(plan.GetResource(), payload.GetResource()) {
		return PrivateSubmitMaterial{}, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"payload.resource",
			"does not match the prepared resource",
		)
	}
	if !bytes.Equal(payload.GetAadSha256(), plan.GetDomainBindingSha256()) {
		return PrivateSubmitMaterial{}, NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"payload.aad_sha256",
			"does not bind the prepared Social domain",
		)
	}

	payloadBytes, err := CanonicalProtoBytes(payload)
	if err != nil {
		return PrivateSubmitMaterial{}, err
	}
	payloadHash := sha256.Sum256(payloadBytes)
	emptyHash := sha256.Sum256(nil)
	mentionRoutingHash := emptyHash
	var mentionRoutingBytes []byte
	if mentionRouting != nil {
		mentionRoutingBytes, mentionRoutingHash, err =
			CanonicalizeSignedMentionRouting(
				mentionRouting,
				plan,
				author,
				payloadHash,
				operation,
			)
		if err != nil {
			return PrivateSubmitMaterial{}, err
		}
	}
	objectMaterials, objectSetHash, err := CanonicalizePrivateObjects(
		operation,
		plan,
		objects,
		policy,
	)
	if err != nil {
		return PrivateSubmitMaterial{}, err
	}
	envelopeMaterials, err := canonicalizeEnvelopes(
		operation,
		plan,
		payload,
		objectSetHash,
		envelopes,
		policy,
	)
	if err != nil {
		return PrivateSubmitMaterial{}, err
	}

	subtypeAuthorityHash := emptyHash
	if subtypeAuthority != nil {
		subtypeAuthorityBytes, err := CanonicalProtoBytes(subtypeAuthority)
		if err != nil {
			return PrivateSubmitMaterial{}, err
		}
		subtypeAuthorityHash = sha256.Sum256(subtypeAuthorityBytes)
	}
	hashInput := &privatecontentpb.SubmitPrivateContentHashInput{
		FormatVersion:          PrivateContentFormatVersion,
		CommandId:              commandID,
		CanonicalPlanSha256:    cloneBytes(plan.GetCanonicalPlanSha256()),
		EncryptedPayloadSha256: payloadHash[:],
		MentionRoutingSha256:   mentionRoutingHash[:],
		SubtypeAuthoritySha256: subtypeAuthorityHash[:],
	}
	for _, envelope := range envelopeMaterials {
		hashInput.Envelopes = append(
			hashInput.Envelopes,
			&privatecontentpb.EnvelopeSubmitCommitment{
				RecipientSlotId: envelope.Envelope.GetBinding().GetRecipientSlotId(),
				BindingSha256: cloneBytes(
					envelope.Envelope.GetBindingSha256(),
				),
				EnvelopeSha256: envelope.EnvelopeSHA256[:],
			},
		)
	}
	for _, object := range objectMaterials {
		hashInput.Objects = append(
			hashInput.Objects,
			&privatecontentpb.ObjectSubmitCommitment{
				ObjectId:         object.Descriptor.GetObjectId(),
				DescriptorSha256: object.DescriptorSHA256[:],
			},
		)
	}
	canonical, err := CanonicalProtoBytes(hashInput)
	if err != nil {
		return PrivateSubmitMaterial{}, err
	}

	return PrivateSubmitMaterial{
		CommandID:                 commandID,
		CanonicalBytes:            canonical,
		CanonicalSHA256:           sha256.Sum256(canonical),
		EncryptedPayloadBytes:     payloadBytes,
		EncryptedPayloadSHA256:    payloadHash,
		ObjectDescriptorSetSHA256: objectSetHash,
		MentionRouting:            cloneMentionRouting(mentionRouting),
		MentionRoutingBytes:       mentionRoutingBytes,
		MentionRoutingSHA256:      mentionRoutingHash,
		SubtypeAuthoritySHA256:    subtypeAuthorityHash,
		Envelopes:                 envelopeMaterials,
		Objects:                   objectMaterials,
	}, nil
}

// CanonicalizeSignedMentionRouting validates the Station-visible routing
// bundle and returns the exact bytes committed by the submit command. The
// author signature covers canonical_facts_sha256, whose input is the routing
// bundle with the digest and signature fields omitted.
func CanonicalizeSignedMentionRouting(
	routing *privatecontentpb.SignedMentionRouting,
	plan *securecontentpb.ContentEncryptionPlan,
	author *actormodel.ActorDeviceRef,
	payloadSHA256 [sha256.Size]byte,
	operation string,
) ([]byte, [sha256.Size]byte, error) {
	if err := validateKnownMessage(routing, "mention_routing", operation); err != nil {
		return nil, [sha256.Size]byte{}, err
	}
	if routing.GetFormatVersion() != PrivateContentFormatVersion {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"mention_routing.format_version",
			"is unsupported",
		)
	}
	if !securecontentkernel.EqualResourceRef(
		routing.GetResource(),
		plan.GetResource(),
	) {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"mention_routing.resource",
			"does not match the prepared resource",
		)
	}
	if !bytes.Equal(
		routing.GetAuthorizationSnapshotSha256(),
		plan.GetAuthorizationSnapshotSha256(),
	) {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"mention_routing.authorization_snapshot_sha256",
			"does not match the prepared authorization snapshot",
		)
	}
	if !bytes.Equal(routing.GetEncryptedPayloadSha256(), payloadSHA256[:]) {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"mention_routing.encrypted_payload_sha256",
			"does not match the submitted encrypted payload",
		)
	}
	if !proto.Equal(routing.GetSender(), author) {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentUnauthorized,
			operation,
			"mention_routing.sender",
			"does not match the authenticated endpoint",
		)
	}
	if err := validateIdentifier(
		routing.GetSenderSigningKeyId(),
		255,
		"mention_routing.sender_signing_key_id",
		operation,
	); err != nil {
		return nil, [sha256.Size]byte{}, err
	}
	if len(routing.GetFacts()) == 0 ||
		len(routing.GetFacts()) > MaximumPrivateMentionFacts {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"mention_routing.facts",
			"must contain between one and 256 canonical facts",
		)
	}

	var previousActor []byte
	var previousCommitment []byte
	commitments := make(map[string]struct{}, len(routing.GetFacts()))
	for index, fact := range routing.GetFacts() {
		field := fmt.Sprintf("mention_routing.facts[%d]", index)
		if err := validateKnownMessage(fact, field, operation); err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		actor := fact.GetMentionedActor()
		if actor == nil ||
			actor.GetKind() == actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				field+".mentioned_actor",
				"must contain a typed ActorRef",
			)
		}
		if err := validateIdentifier(
			actor.GetPtid(),
			255,
			field+".mentioned_actor.ptid",
			operation,
		); err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		if len(fact.GetMentionCommitment()) != sha256.Size {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentInvalidArgument,
				operation,
				field+".mention_commitment",
				"must be a SHA-256 commitment",
			)
		}
		actorBytes, err := CanonicalProtoBytes(actor)
		if err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		if index > 0 {
			actorOrder := bytes.Compare(previousActor, actorBytes)
			if actorOrder > 0 ||
				(actorOrder == 0 &&
					bytes.Compare(previousCommitment, fact.GetMentionCommitment()) >= 0) {
				return nil, [sha256.Size]byte{}, NewPrivateContentError(
					PrivateContentInvalidArgument,
					operation,
					"mention_routing.facts",
					"must be strictly ordered by canonical actor and commitment bytes",
				)
			}
		}
		commitmentKey := string(fact.GetMentionCommitment())
		if _, duplicate := commitments[commitmentKey]; duplicate {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"mention_routing.facts",
				"contains a duplicate mention commitment",
			)
		}
		commitments[commitmentKey] = struct{}{}
		previousActor = actorBytes
		previousCommitment = fact.GetMentionCommitment()
	}

	signingInput := proto.Clone(routing).(*privatecontentpb.SignedMentionRouting)
	signingInput.CanonicalFactsSha256 = nil
	signingInput.SenderSignature = nil
	signingBytes, err := CanonicalProtoBytes(signingInput)
	if err != nil {
		return nil, [sha256.Size]byte{}, err
	}
	signingDigest := sha256.Sum256(signingBytes)
	if !bytes.Equal(routing.GetCanonicalFactsSha256(), signingDigest[:]) {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"mention_routing.canonical_facts_sha256",
			"does not match the canonical routing facts",
		)
	}
	if len(routing.GetSenderSignature()) != ed25519.SignatureSize {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"mention_routing.sender_signature",
			"must be an Ed25519 signature",
		)
	}

	canonical, err := CanonicalProtoBytes(routing)
	if err != nil {
		return nil, [sha256.Size]byte{}, err
	}
	return canonical, sha256.Sum256(canonical), nil
}

func cloneMentionRouting(
	routing *privatecontentpb.SignedMentionRouting,
) *privatecontentpb.SignedMentionRouting {
	if routing == nil {
		return nil
	}
	return proto.Clone(routing).(*privatecontentpb.SignedMentionRouting)
}

func CanonicalizePrivateObjects(
	operation string,
	plan *securecontentpb.ContentEncryptionPlan,
	objects []*securecontentpb.EncryptedObjectDescriptor,
	policy securecontentkernel.Policy,
) ([]PrivateObjectMaterial, [sha256.Size]byte, error) {
	if len(objects) != len(plan.GetObjectIds()) {
		return nil, [sha256.Size]byte{}, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"objects",
			"must exactly cover the prepared object set",
		)
	}

	materials := make([]PrivateObjectMaterial, 0, len(objects))
	descriptorSetBytes := make([]byte, 0)
	for index, descriptor := range objects {
		if descriptor == nil ||
			descriptor.GetObjectId() != plan.GetObjectIds()[index] {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"objects",
				"must be ordered by and match the prepared object IDs",
			)
		}
		if err := securecontentkernel.ValidateEncryptedObjectDescriptor(
			descriptor,
			policy,
		); err != nil {
			return nil, [sha256.Size]byte{}, mapKernelError(operation, err)
		}
		if !securecontentkernel.EqualResourceRef(
			plan.GetResource(),
			descriptor.GetResource(),
		) {
			return nil, [sha256.Size]byte{}, NewPrivateContentError(
				PrivateContentConflict,
				operation,
				"objects.resource",
				"does not match the prepared resource",
			)
		}
		canonical, err := securecontentkernel.CanonicalDescriptorBytes(
			descriptor,
			policy,
		)
		if err != nil {
			return nil, [sha256.Size]byte{}, mapKernelError(operation, err)
		}
		digest := sha256.Sum256(canonical)
		descriptorSetBytes = appendMessageField(
			descriptorSetBytes,
			1,
			canonical,
		)
		materials = append(materials, PrivateObjectMaterial{
			Descriptor:       proto.Clone(descriptor).(*securecontentpb.EncryptedObjectDescriptor),
			CanonicalBytes:   canonical,
			DescriptorSHA256: digest,
		})
	}
	return materials, sha256.Sum256(descriptorSetBytes), nil
}

func canonicalizeEnvelopes(
	operation string,
	plan *securecontentpb.ContentEncryptionPlan,
	payload *securecontentpb.EncryptedPayload,
	objectSetHash [sha256.Size]byte,
	envelopes []*securecontentpb.PreparedContentKeyEnvelope,
	policy securecontentkernel.Policy,
) ([]PrivateEnvelopeMaterial, error) {
	if len(envelopes) != len(plan.GetRequiredSlots()) {
		return nil, NewPrivateContentError(
			PrivateContentConflict,
			operation,
			"envelopes",
			"must exactly cover the prepared recipient slots",
		)
	}

	materials := make([]PrivateEnvelopeMaterial, 0, len(envelopes))
	for index, envelope := range envelopes {
		if err := securecontentkernel.ValidatePreparedContentKeyEnvelope(
			envelope,
			policy,
		); err != nil {
			return nil, mapKernelError(operation, err)
		}
		slot := plan.GetRequiredSlots()[index]
		binding := envelope.GetBinding()
		if binding.GetRecipientSlotId() != slot.GetRecipientSlotId() ||
			binding.GetRecipientKeyKind() != slot.GetKeyKind() ||
			binding.GetRecipientKeyId() != slot.GetOneTimeKeyId() ||
			!bytes.Equal(
				binding.GetPrincipalBindingSha256(),
				slot.GetPrincipalBindingSha256(),
			) ||
			binding.GetPlanId() != plan.GetPlanId() ||
			!bytes.Equal(
				binding.GetCanonicalPlanSha256(),
				plan.GetCanonicalPlanSha256(),
			) ||
			!securecontentkernel.EqualResourceRef(
				binding.GetResource(),
				plan.GetResource(),
			) ||
			!bytes.Equal(
				binding.GetAuthorizationSnapshotSha256(),
				plan.GetAuthorizationSnapshotSha256(),
			) ||
			!bytes.Equal(
				binding.GetPayloadCiphertextSha256(),
				payload.GetCiphertextSha256(),
			) ||
			!bytes.Equal(
				binding.GetObjectDescriptorSetSha256(),
				objectSetHash[:],
			) ||
			!proto.Equal(binding.GetPlanExpiresAt(), plan.GetExpiresAt()) ||
			!proto.Equal(binding.GetSender(), plan.GetAuthor()) {
			return nil, NewPrivateContentError(
				PrivateContentIntegrityFailed,
				operation,
				"envelopes.binding",
				"does not exactly match the prepared plan and payload commitments",
			)
		}
		canonical, err := CanonicalProtoBytes(envelope)
		if err != nil {
			return nil, err
		}
		signingBytes, err := securecontentkernel.CanonicalEnvelopeBindingBytes(
			binding,
		)
		if err != nil {
			return nil, mapKernelError(operation, err)
		}
		materials = append(materials, PrivateEnvelopeMaterial{
			Envelope: proto.Clone(
				envelope,
			).(*securecontentpb.PreparedContentKeyEnvelope),
			CanonicalBytes:   canonical,
			EnvelopeSHA256:   sha256.Sum256(canonical),
			SigningBytes:     signingBytes,
			SenderSigningKey: binding.GetSenderSigningKeyId(),
		})
	}
	return materials, nil
}

// CanonicalEncryptionPlanHash returns the plan commitment over every field
// except the self-referential hash and Station signature.
func CanonicalEncryptionPlanHash(
	plan *securecontentpb.ContentEncryptionPlan,
) ([sha256.Size]byte, error) {
	const operation = "social.private_content.canonical_plan_hash"
	if plan == nil {
		return [sha256.Size]byte{}, requiredMessageError(operation, "plan")
	}
	projected := proto.Clone(plan).(*securecontentpb.ContentEncryptionPlan)
	projected.CanonicalPlanSha256 = nil
	projected.StationSignature = nil
	canonical, err := CanonicalProtoBytes(projected)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	return sha256.Sum256(canonical), nil
}

func CanonicalEncryptionPlanSigningBytes(
	plan *securecontentpb.ContentEncryptionPlan,
) ([]byte, error) {
	const operation = "social.private_content.canonical_plan_signature"
	if plan == nil {
		return nil, requiredMessageError(operation, "plan")
	}
	expected, err := CanonicalEncryptionPlanHash(plan)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(plan.GetCanonicalPlanSha256(), expected[:]) {
		return nil, NewPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			"canonical_plan_sha256",
			"does not match the canonical plan projection",
		)
	}
	projected := proto.Clone(plan).(*securecontentpb.ContentEncryptionPlan)
	projected.StationSignature = nil
	return CanonicalProtoBytes(projected)
}

func ValidateCanonicalEncryptionPlan(
	plan *securecontentpb.ContentEncryptionPlan,
) error {
	_, err := CanonicalEncryptionPlanSigningBytes(plan)
	return err
}

// CanonicalCommitProofSigningBytes encodes exactly fields 1..13. The Station
// signature in field 14 is deliberately excluded.
func CanonicalCommitProofSigningBytes(
	proof *securecontentpb.ViewerContentCommitProof,
) ([]byte, error) {
	const operation = "social.private_content.canonical_commit_proof_signature"
	if proof == nil {
		return nil, requiredMessageError(operation, "proof")
	}
	projected := proto.Clone(proof).(*securecontentpb.ViewerContentCommitProof)
	projected.StationSignature = nil
	return CanonicalProtoBytes(projected)
}

// CanonicalProtoBytes is the Secure Content canonical encoder used for Social
// hashes and signatures. It is independent of runtime deterministic marshal.
func CanonicalProtoBytes(message proto.Message) ([]byte, error) {
	const operation = "social.private_content.canonical_proto"
	if message == nil {
		return nil, requiredMessageError(operation, "message")
	}
	return appendCanonicalMessage(nil, message.ProtoReflect(), operation)
}

func appendCanonicalMessage(
	output []byte,
	message protoreflect.Message,
	operation string,
) ([]byte, error) {
	if !message.IsValid() {
		return nil, requiredMessageError(operation, "message")
	}
	if len(message.GetUnknown()) != 0 {
		return nil, NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			"message",
			"contains unknown protobuf fields",
		)
	}
	fields := message.Descriptor().Fields()
	for index := 0; index < fields.Len(); index++ {
		field := fields.Get(index)
		if field.IsMap() {
			return nil, NewPrivateContentError(
				PrivateContentUnsupported,
				operation,
				string(field.Name()),
				"canonical maps are outside the W6 message set",
			)
		}
		if field.IsList() {
			list := message.Get(field).List()
			if list.Len() == 0 {
				continue
			}
			if field.IsPacked() {
				packed := make([]byte, 0)
				for item := 0; item < list.Len(); item++ {
					var err error
					packed, err = appendCanonicalScalar(
						packed,
						field,
						list.Get(item),
						false,
						operation,
					)
					if err != nil {
						return nil, err
					}
				}
				output = appendBytesField(output, field.Number(), packed)
				continue
			}
			for item := 0; item < list.Len(); item++ {
				var err error
				output, err = appendCanonicalScalar(
					output,
					field,
					list.Get(item),
					true,
					operation,
				)
				if err != nil {
					return nil, err
				}
			}
			continue
		}
		if !message.Has(field) {
			continue
		}
		var err error
		output, err = appendCanonicalScalar(
			output,
			field,
			message.Get(field),
			true,
			operation,
		)
		if err != nil {
			return nil, err
		}
	}
	return output, nil
}

func appendCanonicalScalar(
	output []byte,
	field protoreflect.FieldDescriptor,
	value protoreflect.Value,
	includeTag bool,
	operation string,
) ([]byte, error) {
	number := field.Number()
	appendTag := func(wireType protowire.Type) {
		if includeTag {
			output = protowire.AppendTag(output, number, wireType)
		}
	}

	switch field.Kind() {
	case protoreflect.BoolKind:
		appendTag(protowire.VarintType)
		if value.Bool() {
			return protowire.AppendVarint(output, 1), nil
		}
		return protowire.AppendVarint(output, 0), nil
	case protoreflect.EnumKind:
		appendTag(protowire.VarintType)
		return protowire.AppendVarint(output, uint64(value.Enum())), nil
	case protoreflect.Int32Kind, protoreflect.Int64Kind:
		appendTag(protowire.VarintType)
		return protowire.AppendVarint(output, uint64(value.Int())), nil
	case protoreflect.Sint32Kind:
		appendTag(protowire.VarintType)
		return protowire.AppendVarint(
			output,
			protowire.EncodeZigZag(int64(int32(value.Int()))),
		), nil
	case protoreflect.Sint64Kind:
		appendTag(protowire.VarintType)
		return protowire.AppendVarint(
			output,
			protowire.EncodeZigZag(value.Int()),
		), nil
	case protoreflect.Uint32Kind, protoreflect.Uint64Kind:
		appendTag(protowire.VarintType)
		return protowire.AppendVarint(output, value.Uint()), nil
	case protoreflect.Fixed32Kind:
		appendTag(protowire.Fixed32Type)
		return protowire.AppendFixed32(output, uint32(value.Uint())), nil
	case protoreflect.Sfixed32Kind:
		appendTag(protowire.Fixed32Type)
		return protowire.AppendFixed32(output, uint32(value.Int())), nil
	case protoreflect.FloatKind:
		appendTag(protowire.Fixed32Type)
		return protowire.AppendFixed32(
			output,
			math.Float32bits(float32(value.Float())),
		), nil
	case protoreflect.Fixed64Kind:
		appendTag(protowire.Fixed64Type)
		return protowire.AppendFixed64(output, value.Uint()), nil
	case protoreflect.Sfixed64Kind:
		appendTag(protowire.Fixed64Type)
		return protowire.AppendFixed64(output, uint64(value.Int())), nil
	case protoreflect.DoubleKind:
		appendTag(protowire.Fixed64Type)
		return protowire.AppendFixed64(
			output,
			math.Float64bits(value.Float()),
		), nil
	case protoreflect.StringKind:
		appendTag(protowire.BytesType)
		return protowire.AppendBytes(output, []byte(value.String())), nil
	case protoreflect.BytesKind:
		appendTag(protowire.BytesType)
		return protowire.AppendBytes(output, value.Bytes()), nil
	case protoreflect.MessageKind:
		canonical, err := appendCanonicalMessage(
			nil,
			value.Message(),
			operation,
		)
		if err != nil {
			return nil, err
		}
		appendTag(protowire.BytesType)
		return protowire.AppendBytes(output, canonical), nil
	default:
		return nil, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			string(field.Name()),
			"uses an unsupported protobuf field kind",
		)
	}
}

func validateKnownMessage(
	message proto.Message,
	field string,
	operation string,
) error {
	if message == nil {
		return requiredMessageError(operation, field)
	}
	_, err := appendCanonicalMessage(nil, message.ProtoReflect(), operation)
	return err
}

func validateActorDeviceRef(
	ref *actormodel.ActorDeviceRef,
	field string,
	operation string,
) error {
	if err := validateKnownMessage(ref, field, operation); err != nil {
		return err
	}
	if ref.GetActor() == nil ||
		ref.GetActor().GetKind() == actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			field,
			"must contain a typed actor",
		)
	}
	if err := validateIdentifier(
		ref.GetActor().GetPtid(),
		255,
		field+".actor.ptid",
		operation,
	); err != nil {
		return err
	}
	return validateIdentifier(
		ref.GetDeviceId(),
		128,
		field+".device_id",
		operation,
	)
}

func validateIdentifier(
	value string,
	maximum int,
	field string,
	operation string,
) error {
	if value == "" ||
		len(value) > maximum ||
		value != strings.TrimSpace(value) ||
		strings.ContainsRune(value, '\x00') {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			field,
			"must be a canonical bounded identifier",
		)
	}
	return nil
}

func ValidatePrivateContentID(
	value string,
	field string,
	operation string,
) error {
	if err := validateIdentifier(value, 26, field, operation); err != nil {
		return err
	}
	parsed, err := ulid.ParseStrict(value)
	if err != nil || parsed.String() != value {
		return NewPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			field,
			"must be a canonical uppercase ULID",
		)
	}
	return nil
}

func requiredMessageError(operation string, field string) error {
	return NewPrivateContentError(
		PrivateContentInvalidArgument,
		operation,
		field,
		"is required",
	)
}

func mapKernelError(operation string, err error) error {
	switch securecontentkernel.CodeOf(err) {
	case securecontentkernel.ErrorCodeConflict,
		securecontentkernel.ErrorCodeBindingMismatch:
		return WrapPrivateContentError(PrivateContentConflict, operation, err)
	case securecontentkernel.ErrorCodeExpired:
		return WrapPrivateContentError(PrivateContentExpiredPlan, operation, err)
	case securecontentkernel.ErrorCodeIntegrityFailed:
		return WrapPrivateContentError(
			PrivateContentIntegrityFailed,
			operation,
			err,
		)
	case securecontentkernel.ErrorCodeUnsupportedVersion:
		return WrapPrivateContentError(PrivateContentUnsupported, operation, err)
	default:
		return WrapPrivateContentError(
			PrivateContentInvalidArgument,
			operation,
			err,
		)
	}
}

func appendVarintField(
	output []byte,
	number protowire.Number,
	value uint64,
) []byte {
	if value == 0 {
		return output
	}
	output = protowire.AppendTag(output, number, protowire.VarintType)
	return protowire.AppendVarint(output, value)
}

func appendBytesField(
	output []byte,
	number protowire.Number,
	value []byte,
) []byte {
	if len(value) == 0 {
		return output
	}
	output = protowire.AppendTag(output, number, protowire.BytesType)
	return protowire.AppendBytes(output, value)
}

func appendStringField(
	output []byte,
	number protowire.Number,
	value string,
) []byte {
	return appendBytesField(output, number, []byte(value))
}

func appendMessageField(
	output []byte,
	number protowire.Number,
	value []byte,
) []byte {
	output = protowire.AppendTag(output, number, protowire.BytesType)
	return protowire.AppendBytes(output, value)
}

func cloneBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}
