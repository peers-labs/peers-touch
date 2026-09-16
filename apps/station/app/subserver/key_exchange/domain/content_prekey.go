package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

const (
	ContentPreKeyPublicBytes          = 32
	MaxContentPreKeyIDBytes           = 128
	MaxContentPreKeysPerReplenishment = 100
	MaxContentPreKeysPerPool          = 100
	ContentPreKeyReplenishThreshold   = 20
	MaxContentPreKeyClaimTargets      = 1000
	MaxContentPreKeyEpoch             = uint64(1<<63 - 1)
)

// ContentPreKeyPrincipal is the canonical persistence identity for one
// endpoint or actor-recovery pool.
type ContentPreKeyPrincipal struct {
	Kind      securecontentpb.ContentPreKeyKind
	ActorPTID string
	DeviceID  string
}

func (p ContentPreKeyPrincipal) Validate(operation string) error {
	if err := validateBoundedString(
		operation,
		"principal.actor.ptid",
		p.ActorPTID,
		MaxActorPTIDBytes,
	); err != nil {
		return err
	}

	switch p.Kind {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		return validateBoundedString(
			operation,
			"principal.device_id",
			p.DeviceID,
			MaxDeviceIDBytes,
		)
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		if p.DeviceID != "" {
			return NewError(
				ErrorCodeInvalidArgument,
				operation,
				"principal.device_id",
				"must be empty for an actor-recovery pool",
			)
		}
		return nil
	default:
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"kind",
			"is unsupported",
		)
	}
}

func (p ContentPreKeyPrincipal) Key() string {
	return strings.Join(
		[]string{
			strconv.FormatInt(int64(p.Kind), 10),
			p.ActorPTID,
			p.DeviceID,
		},
		"\x00",
	)
}

func (p ContentPreKeyPrincipal) Endpoint() (Endpoint, bool) {
	if p.Kind !=
		securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT {
		return Endpoint{}, false
	}
	return Endpoint{
		ActorPTID: p.ActorPTID,
		DeviceID:  p.DeviceID,
	}, true
}

func (p ContentPreKeyPrincipal) ClaimTarget() *securecontentpb.ContentPreKeyClaimTarget {
	target := &securecontentpb.ContentPreKeyClaimTarget{Kind: p.Kind}
	switch p.Kind {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		target.Principal = &securecontentpb.ContentPreKeyClaimTarget_Endpoint{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor:    &actormodel.ActorRef{Ptid: p.ActorPTID},
				DeviceId: p.DeviceID,
			},
		}
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		target.Principal = &securecontentpb.ContentPreKeyClaimTarget_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{Ptid: p.ActorPTID},
		}
	}
	return target
}

type ContentPreKeyInventory struct {
	Principal          ContentPreKeyPrincipal
	CurrentEpoch       uint64
	Available          int64
	Capacity           int64
	ReplenishAtOrBelow int64
	NeedsReplenishment bool
}

func NewContentPreKeyInventory(
	principal ContentPreKeyPrincipal,
	currentEpoch uint64,
	available int64,
) ContentPreKeyInventory {
	return ContentPreKeyInventory{
		Principal:          principal,
		CurrentEpoch:       currentEpoch,
		Available:          available,
		Capacity:           MaxContentPreKeysPerPool,
		ReplenishAtOrBelow: ContentPreKeyReplenishThreshold,
		NeedsReplenishment: available <= ContentPreKeyReplenishThreshold,
	}
}

// ContentPreKeyPublication is the normalized SC-D15 publication command.
type ContentPreKeyPublication struct {
	Publisher               Endpoint
	PublisherSigningKeyID   string
	PublisherProfileVersion uint64
	ExpectedPoolEpoch       uint64
	Principal               ContentPreKeyPrincipal
	PoolEpoch               uint64
	PreKeys                 []*securecontentpb.ContentOneTimePreKey
}

// SigningInput reconstructs the dedicated signature projection from normalized
// semantic fields instead of trusting transport bytes.
func (p ContentPreKeyPublication) SigningInput(
	prekey *securecontentpb.ContentOneTimePreKey,
) *securecontentpb.ContentPreKeySigningInput {
	input := &securecontentpb.ContentPreKeySigningInput{
		FormatVersion:     1,
		Kind:              p.Principal.Kind,
		KeyId:             prekey.GetKeyId(),
		X25519PublicKey:   append([]byte(nil), prekey.GetX25519PublicKey()...),
		PoolEpoch:         p.PoolEpoch,
		ExpectedPoolEpoch: p.ExpectedPoolEpoch,
		Publisher: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: p.Publisher.ActorPTID,
			},
			DeviceId: p.Publisher.DeviceID,
		},
		PublisherSigningKeyId:   p.PublisherSigningKeyID,
		PublisherProfileVersion: p.PublisherProfileVersion,
	}
	switch p.Principal.Kind {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		input.Principal = &securecontentpb.ContentPreKeySigningInput_Endpoint{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: p.Principal.ActorPTID,
				},
				DeviceId: p.Principal.DeviceID,
			},
		}
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		input.Principal = &securecontentpb.ContentPreKeySigningInput_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{
				Ptid: p.Principal.ActorPTID,
			},
		}
	}
	return input
}

// NormalizePublishContentPreKeysRequest rejects recursive unknowns and returns
// one canonical publication command bound to the authenticated endpoint.
func NormalizePublishContentPreKeysRequest(
	operation string,
	authenticatedPublisher Endpoint,
	request *securecontentpb.PublishContentPreKeysRequest,
) (ContentPreKeyPublication, error) {
	if err := authenticatedPublisher.Validate(operation); err != nil {
		return ContentPreKeyPublication{}, err
	}
	if request == nil {
		return ContentPreKeyPublication{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"request",
			"is required",
		)
	}
	if len(request.ProtoReflect().GetUnknown()) != 0 {
		return ContentPreKeyPublication{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"request",
			"contains unknown protobuf fields",
		)
	}
	publisher, err := contentPreKeyEndpointFromRef(
		operation,
		"publisher",
		request.GetPublisher(),
	)
	if err != nil {
		return ContentPreKeyPublication{}, err
	}
	if publisher != authenticatedPublisher {
		return ContentPreKeyPublication{}, NewError(
			ErrorCodeUnauthorized,
			operation,
			"publisher",
			"does not match the authenticated endpoint",
		)
	}
	signingKeyID := strings.TrimSpace(request.GetPublisherSigningKeyId())
	if err := validateBoundedString(
		operation,
		"publisher_signing_key_id",
		signingKeyID,
		MaxContentPreKeyIDBytes,
	); err != nil {
		return ContentPreKeyPublication{}, err
	}
	if signingKeyID != request.GetPublisherSigningKeyId() {
		return ContentPreKeyPublication{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"publisher_signing_key_id",
			"must be canonical without surrounding whitespace",
		)
	}
	if request.GetPublisherProfileVersion() == 0 ||
		request.GetPublisherProfileVersion() > MaxContentPreKeyEpoch {
		return ContentPreKeyPublication{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"publisher_profile_version",
			"must be a supported positive profile version",
		)
	}
	if request.GetExpectedPoolEpoch() > MaxContentPreKeyEpoch {
		return ContentPreKeyPublication{}, NewError(
			ErrorCodePayloadTooLarge,
			operation,
			"expected_pool_epoch",
			"exceeds the signed persistence range",
		)
	}

	principal, epoch, normalized, err := normalizeContentPreKeyBatch(
		operation,
		publisher,
		request.GetPrekeys(),
	)
	if err != nil {
		return ContentPreKeyPublication{}, err
	}
	if request.GetExpectedPoolEpoch() > epoch {
		return ContentPreKeyPublication{}, NewError(
			ErrorCodeStaleMaterial,
			operation,
			"expected_pool_epoch",
			"cannot exceed the published pool epoch",
		)
	}
	return ContentPreKeyPublication{
		Publisher:               publisher,
		PublisherSigningKeyID:   signingKeyID,
		PublisherProfileVersion: request.GetPublisherProfileVersion(),
		ExpectedPoolEpoch:       request.GetExpectedPoolEpoch(),
		Principal:               principal,
		PoolEpoch:               epoch,
		PreKeys:                 normalized,
	}, nil
}

func NormalizeContentPreKeyBatch(
	operation string,
	publisher Endpoint,
	values []*securecontentpb.ContentOneTimePreKey,
) (
	ContentPreKeyPrincipal,
	uint64,
	[]*securecontentpb.ContentOneTimePreKey,
	error,
) {
	if err := publisher.Validate(operation); err != nil {
		return ContentPreKeyPrincipal{}, 0, nil, err
	}
	return normalizeContentPreKeyBatch(operation, publisher, values)
}

func normalizeContentPreKeyBatch(
	operation string,
	publisher Endpoint,
	values []*securecontentpb.ContentOneTimePreKey,
) (
	ContentPreKeyPrincipal,
	uint64,
	[]*securecontentpb.ContentOneTimePreKey,
	error,
) {
	if len(values) == 0 {
		return ContentPreKeyPrincipal{}, 0, nil, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekeys",
			"must contain at least one Content PreKey",
		)
	}
	if len(values) > MaxContentPreKeysPerReplenishment {
		return ContentPreKeyPrincipal{}, 0, nil, NewError(
			ErrorCodePayloadTooLarge,
			operation,
			"prekeys",
			"exceeds the replenishment batch limit",
		)
	}

	normalized := make(
		[]*securecontentpb.ContentOneTimePreKey,
		0,
		len(values),
	)
	var principal ContentPreKeyPrincipal
	var epoch uint64
	keyIDs := make(map[string]struct{}, len(values))
	publicKeys := make(map[[sha256.Size]byte]struct{}, len(values))
	for index, value := range values {
		key, keyPrincipal, err := normalizeContentPreKey(operation, value)
		if err != nil {
			return ContentPreKeyPrincipal{}, 0, nil, err
		}
		if index == 0 {
			principal = keyPrincipal
			epoch = key.GetProfileOrRecoveryEpoch()
			if principal.ActorPTID != publisher.ActorPTID ||
				(principal.Kind ==
					securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT &&
					principal.DeviceID != publisher.DeviceID) {
				return ContentPreKeyPrincipal{}, 0, nil, NewError(
					ErrorCodeUnauthorized,
					operation,
					"principal",
					"does not belong to the authenticated endpoint",
				)
			}
		} else if keyPrincipal != principal ||
			key.GetProfileOrRecoveryEpoch() != epoch {
			return ContentPreKeyPrincipal{}, 0, nil, NewError(
				ErrorCodeInvalidArgument,
				operation,
				"prekeys",
				"must address one principal and one epoch per batch",
			)
		}
		if _, duplicate := keyIDs[key.GetKeyId()]; duplicate {
			return ContentPreKeyPrincipal{}, 0, nil, NewError(
				ErrorCodeConflict,
				operation,
				"prekeys.key_id",
				"contains a duplicate key ID",
			)
		}
		keyIDs[key.GetKeyId()] = struct{}{}
		publicKeyHash := sha256.Sum256(key.GetX25519PublicKey())
		if _, duplicate := publicKeys[publicKeyHash]; duplicate {
			return ContentPreKeyPrincipal{}, 0, nil, NewError(
				ErrorCodeConflict,
				operation,
				"prekeys.x25519_public_key",
				"contains duplicate public material",
			)
		}
		publicKeys[publicKeyHash] = struct{}{}
		normalized = append(normalized, key)
	}

	sort.Slice(normalized, func(left int, right int) bool {
		return normalized[left].GetKeyId() < normalized[right].GetKeyId()
	})
	return principal, epoch, normalized, nil
}

func contentPreKeyEndpointFromRef(
	operation string,
	field string,
	value *actormodel.ActorDeviceRef,
) (Endpoint, error) {
	if value == nil ||
		len(value.ProtoReflect().GetUnknown()) != 0 {
		return Endpoint{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"must be present and contain no unknown protobuf fields",
		)
	}
	if err := validateContentPreKeyActorRef(
		operation,
		field+".actor",
		value.GetActor(),
	); err != nil {
		return Endpoint{}, err
	}
	endpoint := Endpoint{
		ActorPTID: strings.TrimSpace(value.GetActor().GetPtid()),
		DeviceID:  strings.TrimSpace(value.GetDeviceId()),
	}
	if endpoint.ActorPTID != value.GetActor().GetPtid() ||
		endpoint.DeviceID != value.GetDeviceId() {
		return Endpoint{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"must use canonical identity fields",
		)
	}
	if err := endpoint.Validate(operation); err != nil {
		return Endpoint{}, err
	}
	return endpoint, nil
}

func NormalizeContentPreKeyClaimRequest(
	operation string,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (
	*securecontentpb.ClaimContentPreKeysRequest,
	[]ContentPreKeyPrincipal,
	error,
) {
	if request == nil {
		return nil, nil, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"request",
			"is required",
		)
	}
	if len(request.ProtoReflect().GetUnknown()) != 0 {
		return nil, nil, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"request",
			"contains unknown protobuf fields",
		)
	}
	if err := ValidateRequestID(operation, request.GetPlanId()); err != nil {
		return nil, nil, err
	}
	if len(request.GetPlanRequestSha256()) != sha256.Size ||
		allZero(request.GetPlanRequestSha256()) {
		return nil, nil, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"plan_request_sha256",
			"must contain a non-zero SHA-256 digest",
		)
	}
	if len(request.GetTargets()) == 0 {
		return nil, nil, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"targets",
			"must contain at least one claim target",
		)
	}
	if len(request.GetTargets()) > MaxContentPreKeyClaimTargets {
		return nil, nil, NewError(
			ErrorCodePayloadTooLarge,
			operation,
			"targets",
			"exceeds the plan target limit",
		)
	}

	principals := make(
		[]ContentPreKeyPrincipal,
		0,
		len(request.GetTargets()),
	)
	seen := make(map[string]struct{}, len(request.GetTargets()))
	for _, target := range request.GetTargets() {
		principal, err := ContentPreKeyPrincipalFromTarget(operation, target)
		if err != nil {
			return nil, nil, err
		}
		if _, duplicate := seen[principal.Key()]; duplicate {
			return nil, nil, NewError(
				ErrorCodeConflict,
				operation,
				"targets",
				"contains a duplicate principal",
			)
		}
		seen[principal.Key()] = struct{}{}
		principals = append(principals, principal)
	}
	sort.Slice(principals, func(left int, right int) bool {
		return principals[left].Key() < principals[right].Key()
	})

	normalized := &securecontentpb.ClaimContentPreKeysRequest{
		PlanId: strings.TrimSpace(request.GetPlanId()),
		PlanRequestSha256: append(
			[]byte(nil),
			request.GetPlanRequestSha256()...,
		),
		Targets: make(
			[]*securecontentpb.ContentPreKeyClaimTarget,
			0,
			len(principals),
		),
	}
	for _, principal := range principals {
		normalized.Targets = append(
			normalized.Targets,
			principal.ClaimTarget(),
		)
	}
	return normalized, principals, nil
}

func ContentPreKeyPrincipalFromTarget(
	operation string,
	target *securecontentpb.ContentPreKeyClaimTarget,
) (ContentPreKeyPrincipal, error) {
	if target == nil {
		return ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"target",
			"is required",
		)
	}
	if len(target.ProtoReflect().GetUnknown()) != 0 {
		return ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"target",
			"contains unknown protobuf fields",
		)
	}

	var principal ContentPreKeyPrincipal
	switch target.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		endpoint := target.GetEndpoint()
		if endpoint == nil {
			return ContentPreKeyPrincipal{}, missingContentPrincipal(operation)
		}
		if len(endpoint.ProtoReflect().GetUnknown()) != 0 {
			return ContentPreKeyPrincipal{}, NewError(
				ErrorCodeInvalidArgument,
				operation,
				"target.endpoint",
				"contains unknown protobuf fields",
			)
		}
		if err := validateContentPreKeyActorRef(
			operation,
			"target.endpoint.actor",
			endpoint.GetActor(),
		); err != nil {
			return ContentPreKeyPrincipal{}, err
		}
		principal = ContentPreKeyPrincipal{
			Kind:      target.GetKind(),
			ActorPTID: strings.TrimSpace(endpoint.GetActor().GetPtid()),
			DeviceID:  strings.TrimSpace(endpoint.GetDeviceId()),
		}
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		actor := target.GetRecoveryActor()
		if actor == nil {
			return ContentPreKeyPrincipal{}, missingContentPrincipal(operation)
		}
		if err := validateContentPreKeyActorRef(
			operation,
			"target.recovery_actor",
			actor,
		); err != nil {
			return ContentPreKeyPrincipal{}, err
		}
		principal = ContentPreKeyPrincipal{
			Kind:      target.GetKind(),
			ActorPTID: strings.TrimSpace(actor.GetPtid()),
		}
	default:
		return ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"target.kind",
			"is unsupported",
		)
	}
	if err := principal.Validate(operation); err != nil {
		return ContentPreKeyPrincipal{}, err
	}
	return principal, nil
}

func validateContentPreKeyActorRef(
	operation string,
	field string,
	actor *actormodel.ActorRef,
) error {
	if actor == nil || len(actor.ProtoReflect().GetUnknown()) != 0 {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"must be present and contain no unknown protobuf fields",
		)
	}
	if actor.GetAcct() != "" ||
		actor.GetKind() != actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"must contain only the canonical PTID",
		)
	}
	return validateBoundedString(
		operation,
		field+".ptid",
		actor.GetPtid(),
		MaxActorPTIDBytes,
	)
}

func ContentPreKeyPrincipalFromPreKey(
	operation string,
	prekey *securecontentpb.ContentOneTimePreKey,
) (ContentPreKeyPrincipal, error) {
	if prekey == nil {
		return ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey",
			"is required",
		)
	}
	target := &securecontentpb.ContentPreKeyClaimTarget{Kind: prekey.GetKind()}
	switch prekey.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		target.Principal = &securecontentpb.ContentPreKeyClaimTarget_Endpoint{
			Endpoint: prekey.GetEndpoint(),
		}
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		target.Principal = &securecontentpb.ContentPreKeyClaimTarget_RecoveryActor{
			RecoveryActor: prekey.GetRecoveryActor(),
		}
	default:
		return ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey.kind",
			"is unsupported",
		)
	}
	return ContentPreKeyPrincipalFromTarget(operation, target)
}

func NormalizeContentPreKey(
	operation string,
	value *securecontentpb.ContentOneTimePreKey,
) (
	*securecontentpb.ContentOneTimePreKey,
	ContentPreKeyPrincipal,
	error,
) {
	return normalizeContentPreKey(operation, value)
}

func ValidateClaimedContentPreKey(
	operation string,
	claim *securecontentpb.ClaimedContentPreKey,
) error {
	if claim == nil ||
		strings.TrimSpace(claim.GetClaimId()) == "" ||
		claim.GetTarget() == nil ||
		claim.GetPrekey() == nil ||
		!claim.GetIrreversiblyConsumed() {
		return NewError(
			ErrorCodeInternal,
			operation,
			"claim",
			"is not a complete irreversible claim",
		)
	}
	targetPrincipal, err := ContentPreKeyPrincipalFromTarget(
		operation,
		claim.GetTarget(),
	)
	if err != nil {
		return err
	}
	key, keyPrincipal, err := normalizeContentPreKey(
		operation,
		claim.GetPrekey(),
	)
	if err != nil {
		return err
	}
	if keyPrincipal != targetPrincipal || key.GetKind() != claim.GetTarget().GetKind() {
		return NewError(
			ErrorCodeInternal,
			operation,
			"claim",
			"target and PreKey principal do not match",
		)
	}
	return nil
}

func NewContentPreKeyClaimID(
	planID string,
	planRequestSHA256 [sha256.Size]byte,
	principal ContentPreKeyPrincipal,
	keyID string,
) string {
	hash := sha256.New()
	for _, field := range [][]byte{
		[]byte("peers-touch:content-prekey-claim:v1"),
		[]byte(planID),
		planRequestSHA256[:],
		[]byte(principal.Key()),
		[]byte(keyID),
	} {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(field)))
		_, _ = hash.Write(size[:])
		_, _ = hash.Write(field)
	}
	return "content-prekey-claim:" + hex.EncodeToString(hash.Sum(nil))
}

func normalizeContentPreKey(
	operation string,
	value *securecontentpb.ContentOneTimePreKey,
) (
	*securecontentpb.ContentOneTimePreKey,
	ContentPreKeyPrincipal,
	error,
) {
	if value == nil {
		return nil, ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey",
			"contains a nil entry",
		)
	}
	if len(value.ProtoReflect().GetUnknown()) != 0 {
		return nil, ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey",
			"contains unknown protobuf fields",
		)
	}
	principal, err := ContentPreKeyPrincipalFromPreKey(operation, value)
	if err != nil {
		return nil, ContentPreKeyPrincipal{}, err
	}
	keyID := strings.TrimSpace(value.GetKeyId())
	if err := validateBoundedString(
		operation,
		"prekey.key_id",
		keyID,
		MaxContentPreKeyIDBytes,
	); err != nil {
		return nil, ContentPreKeyPrincipal{}, err
	}
	if keyID != value.GetKeyId() {
		return nil, ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey.key_id",
			"must be canonical without surrounding whitespace",
		)
	}
	if len(value.GetX25519PublicKey()) != ContentPreKeyPublicBytes ||
		allZero(value.GetX25519PublicKey()) {
		return nil, ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey.x25519_public_key",
			"must contain non-zero 32-byte X25519 public material",
		)
	}
	if value.GetProfileOrRecoveryEpoch() == 0 {
		return nil, ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey.profile_or_recovery_epoch",
			"must be positive",
		)
	}
	if value.GetProfileOrRecoveryEpoch() > MaxContentPreKeyEpoch {
		return nil, ContentPreKeyPrincipal{}, NewError(
			ErrorCodePayloadTooLarge,
			operation,
			"prekey.profile_or_recovery_epoch",
			"exceeds the signed persistence range",
		)
	}
	if len(value.GetIssuerSignature()) != ed25519.SignatureSize ||
		allZero(value.GetIssuerSignature()) {
		return nil, ContentPreKeyPrincipal{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"prekey.issuer_signature",
			"must contain a non-zero Ed25519 signature",
		)
	}

	normalized := &securecontentpb.ContentOneTimePreKey{
		Kind:                   principal.Kind,
		KeyId:                  keyID,
		X25519PublicKey:        append([]byte(nil), value.GetX25519PublicKey()...),
		ProfileOrRecoveryEpoch: value.GetProfileOrRecoveryEpoch(),
		IssuerSignature:        append([]byte(nil), value.GetIssuerSignature()...),
	}
	switch principal.Kind {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		normalized.Principal = &securecontentpb.ContentOneTimePreKey_Endpoint{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor:    &actormodel.ActorRef{Ptid: principal.ActorPTID},
				DeviceId: principal.DeviceID,
			},
		}
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		normalized.Principal = &securecontentpb.ContentOneTimePreKey_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{Ptid: principal.ActorPTID},
		}
	}
	return normalized, principal, nil
}

func missingContentPrincipal(operation string) error {
	return NewError(
		ErrorCodeInvalidArgument,
		operation,
		"principal",
		"does not match the declared Content PreKey kind",
	)
}

func allZero(value []byte) bool {
	return len(bytes.Trim(value, "\x00")) == 0
}
