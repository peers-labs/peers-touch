package domain

import (
	"bytes"
	"crypto/sha256"
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
	PrivateContentPlanLifetime           = 5 * time.Minute
)

type PrivateContentResourceKind string

const (
	PrivateContentResourcePost    PrivateContentResourceKind = "POST"
	PrivateContentResourceComment PrivateContentResourceKind = "COMMENT"
)

type PrivateContentErrorCode string

const (
	PrivateContentInvalidArgument PrivateContentErrorCode = "SOCIAL_PRIVATE_INVALID_ARGUMENT"
	PrivateContentUnsupported     PrivateContentErrorCode = "SOCIAL_PRIVATE_UNSUPPORTED"
	PrivateContentUnauthorized    PrivateContentErrorCode = "SOCIAL_PRIVATE_UNAUTHORIZED"
	PrivateContentNotFound        PrivateContentErrorCode = "SOCIAL_PRIVATE_NOT_FOUND"
	PrivateContentConflict        PrivateContentErrorCode = "SOCIAL_PRIVATE_CONFLICT"
	PrivateContentStalePlan       PrivateContentErrorCode = "SOCIAL_PRIVATE_STALE_PLAN"
	PrivateContentExpiredPlan     PrivateContentErrorCode = "SOCIAL_PRIVATE_EXPIRED_PLAN"
	PrivateContentRateLimited     PrivateContentErrorCode = "SOCIAL_PRIVATE_RATE_LIMITED"
	PrivateContentIntegrityFailed PrivateContentErrorCode = "SOCIAL_PRIVATE_INTEGRITY_FAILED"
	PrivateContentDependency      PrivateContentErrorCode = "SOCIAL_PRIVATE_DEPENDENCY_FAILURE"
	PrivateContentIntegrationGap  PrivateContentErrorCode = "SOCIAL_PRIVATE_INTEGRATION_GAP"
	PrivateContentInternal        PrivateContentErrorCode = "SOCIAL_PRIVATE_INTERNAL"
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
	Audience         *actormodel.Audience
	SourceRevision   uint64
	SourceHeadSHA256 []byte
	RecipientPTIDs   []string
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
		Audience:         proto.Clone(snapshot.Audience).(*actormodel.Audience),
		SourceRevision:   snapshot.SourceRevision,
		SourceHeadSHA256: cloneBytes(snapshot.SourceHeadSHA256),
		RecipientPTIDs:   append([]string(nil), snapshot.RecipientPTIDs...),
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
	return normalized, sha256.Sum256(canonical), nil
}

type PrivatePrepareMaterial struct {
	ResourceKind      PrivateContentResourceKind
	ContentID         string
	ParentPostID      string
	ReplyToCommentID  string
	CommandID         string
	MomentKind        privatecontentpb.PrivateMomentKind
	AudienceKind      actormodel.Audience_Kind
	Audience          *actormodel.Audience
	ObjectCount       uint32
	CanonicalBytes    []byte
	CanonicalSHA256   [sha256.Size]byte
	DomainBinding     []byte
	DomainBindingHash [sha256.Size]byte
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
	hashInput := &privatecontentpb.PreparePrivateMomentHashInput{
		FormatVersion:  PrivateContentFormatVersion,
		CommandId:      request.GetCommandId(),
		ContentId:      request.GetContentId(),
		Kind:           request.GetKind(),
		AudienceSha256: audienceHash[:],
		ObjectCount:    request.GetObjectCount(),
	}
	canonical, err := CanonicalProtoBytes(hashInput)
	if err != nil {
		return PrivatePrepareMaterial{}, err
	}
	domainBinding := &privatecontentpb.PrivateMomentDomainBinding{
		FormatVersion: PrivateContentFormatVersion,
		Kind:          request.GetKind(),
	}
	domainBindingBytes, err := CanonicalProtoBytes(domainBinding)
	if err != nil {
		return PrivatePrepareMaterial{}, err
	}

	return PrivatePrepareMaterial{
		ResourceKind:      PrivateContentResourcePost,
		ContentID:         request.GetContentId(),
		CommandID:         request.GetCommandId(),
		MomentKind:        request.GetKind(),
		AudienceKind:      request.GetAudience().GetKind(),
		Audience:          audience,
		ObjectCount:       request.GetObjectCount(),
		CanonicalBytes:    canonical,
		CanonicalSHA256:   sha256.Sum256(canonical),
		DomainBinding:     domainBindingBytes,
		DomainBindingHash: sha256.Sum256(domainBindingBytes),
	}, nil
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
		ResourceKind:      PrivateContentResourceComment,
		ContentID:         request.GetCommentContentId(),
		ParentPostID:      request.GetPostId(),
		ReplyToCommentID:  request.GetReplyToCommentId(),
		CommandID:         request.GetCommandId(),
		ObjectCount:       request.GetObjectCount(),
		CanonicalBytes:    canonical,
		CanonicalSHA256:   sha256.Sum256(canonical),
		DomainBinding:     domainBindingBytes,
		DomainBindingHash: sha256.Sum256(domainBindingBytes),
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
	if request.GetPollAuthority() != nil || request.GetRepostAuthority() != nil {
		return PrivateSubmitMaterial{}, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"subtype_authority",
			"W6 does not accept poll or repost authority",
		)
	}
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
	return canonicalizePrivateSubmit(
		operation,
		request,
		request.GetCommandId(),
		request.GetPlan(),
		request.GetPayload(),
		request.GetEnvelopes(),
		request.GetObjects(),
		request.GetMentionRouting(),
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
	if mentionRouting != nil {
		return PrivateSubmitMaterial{}, NewPrivateContentError(
			PrivateContentUnsupported,
			operation,
			"mention_routing",
			"W6 does not yet accept private mention routing",
		)
	}

	payloadBytes, err := CanonicalProtoBytes(payload)
	if err != nil {
		return PrivateSubmitMaterial{}, err
	}
	payloadHash := sha256.Sum256(payloadBytes)
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

	emptyHash := sha256.Sum256(nil)
	hashInput := &privatecontentpb.SubmitPrivateContentHashInput{
		FormatVersion:          PrivateContentFormatVersion,
		CommandId:              commandID,
		CanonicalPlanSha256:    cloneBytes(plan.GetCanonicalPlanSha256()),
		EncryptedPayloadSha256: payloadHash[:],
		MentionRoutingSha256:   emptyHash[:],
		SubtypeAuthoritySha256: emptyHash[:],
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
		MentionRoutingSHA256:      emptyHash,
		SubtypeAuthoritySHA256:    emptyHash,
		Envelopes:                 envelopeMaterials,
		Objects:                   objectMaterials,
	}, nil
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
