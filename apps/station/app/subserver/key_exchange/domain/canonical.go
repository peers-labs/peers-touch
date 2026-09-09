package domain

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	MaxActorPTIDBytes              = 255
	MaxDeviceIDBytes               = 128
	MaxStationIDBytes              = 255
	MaxSessionIDBytes              = 128
	MaxConversationIDBytes         = 128
	MaxDirectOneTimePreKeys        = 100
	MaxMLSKeyPackageBytes          = 64 * 1024
	MaxDirectKeyExchangePayload    = 64 * 1024
	MaxAuthorityPlanTTL            = 5 * time.Minute
	FederationClockSkewBudget      = time.Minute
	DirectIdentityPublicKeyBytes   = 32
	DirectSignedPreKeyPublicBytes  = 32
	DirectSignedPreKeySignatureLen = 64
	DirectOneTimePreKeyPublicBytes = 32
)

type ErrorCode string

const (
	ErrorCodeInvalidArgument ErrorCode = "KEY_EXCHANGE_INVALID_ARGUMENT"
	ErrorCodeUnauthorized    ErrorCode = "KEY_EXCHANGE_UNAUTHORIZED"
	ErrorCodeNotFound        ErrorCode = "KEY_EXCHANGE_NOT_FOUND"
	ErrorCodeConflict        ErrorCode = "KEY_EXCHANGE_CONFLICT"
	ErrorCodeStaleMaterial   ErrorCode = "KEY_EXCHANGE_STALE_MATERIAL"
	ErrorCodePlanExpired     ErrorCode = "KEY_EXCHANGE_PLAN_EXPIRED"
	ErrorCodePayloadTooLarge ErrorCode = "KEY_EXCHANGE_PAYLOAD_TOO_LARGE"
	ErrorCodeDependency      ErrorCode = "KEY_EXCHANGE_DEPENDENCY_FAILURE"
	ErrorCodeInternal        ErrorCode = "KEY_EXCHANGE_INTERNAL"
)

type Error struct {
	Code      ErrorCode
	Operation string
	Field     string
	Message   string
	Cause     error
}

func (e *Error) Error() string {
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

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func NewError(code ErrorCode, operation string, field string, message string) error {
	return &Error{
		Code:      code,
		Operation: operation,
		Field:     field,
		Message:   message,
	}
}

func WrapError(code ErrorCode, operation string, cause error) error {
	if cause == nil {
		return nil
	}
	return &Error{
		Code:      code,
		Operation: operation,
		Message:   cause.Error(),
		Cause:     cause,
	}
}

func CodeOf(err error) ErrorCode {
	var domainError *Error
	if errors.As(err, &domainError) {
		return domainError.Code
	}
	return ""
}

func IsCode(err error, code ErrorCode) bool {
	return CodeOf(err) == code
}

type Endpoint struct {
	ActorPTID string
	DeviceID  string
}

func (e Endpoint) Validate(operation string) error {
	if err := validateBoundedString(
		operation,
		"actor_ptid",
		e.ActorPTID,
		MaxActorPTIDBytes,
	); err != nil {
		return err
	}
	return validateBoundedString(
		operation,
		"device_id",
		e.DeviceID,
		MaxDeviceIDBytes,
	)
}

func (e Endpoint) Key() string {
	return e.ActorPTID + "\x00" + e.DeviceID
}

type DeviceRoute struct {
	Endpoint      Endpoint
	HomeStationID string
}

func (r DeviceRoute) Validate(operation string) error {
	if err := r.Endpoint.Validate(operation); err != nil {
		return err
	}
	return validateBoundedString(
		operation,
		"home_station_peer_id",
		r.HomeStationID,
		MaxStationIDBytes,
	)
}

type DirectOneTimePreKey struct {
	KeyID     int32
	PublicKey []byte
}

func (k DirectOneTimePreKey) Clone() DirectOneTimePreKey {
	k.PublicKey = cloneBytes(k.PublicKey)
	return k
}

type DirectKeyBundle struct {
	Device                Endpoint
	IdentityKeyPublic     []byte
	SignedPreKeyID        int32
	SignedPreKeyPublic    []byte
	SignedPreKeySignature []byte
	OneTimePreKeys        []DirectOneTimePreKey
	PublishedAt           time.Time
	SupportedWireVersions []uint32
}

func (b DirectKeyBundle) Clone() DirectKeyBundle {
	b.IdentityKeyPublic = cloneBytes(b.IdentityKeyPublic)
	b.SignedPreKeyPublic = cloneBytes(b.SignedPreKeyPublic)
	b.SignedPreKeySignature = cloneBytes(b.SignedPreKeySignature)
	b.SupportedWireVersions = append([]uint32(nil), b.SupportedWireVersions...)
	b.OneTimePreKeys = cloneDirectOneTimePreKeys(b.OneTimePreKeys)
	return b
}

func (b DirectKeyBundle) Validate(operation string) error {
	if err := b.Device.Validate(operation); err != nil {
		return err
	}
	if len(b.IdentityKeyPublic) != DirectIdentityPublicKeyBytes {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"identity_key_public",
			"must contain exactly 32 bytes",
		)
	}
	if b.SignedPreKeyID <= 0 {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"signed_pre_key_id",
			"must be positive",
		)
	}
	if len(b.SignedPreKeyPublic) != DirectSignedPreKeyPublicBytes {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"signed_pre_key_public",
			"must contain exactly 32 bytes",
		)
	}
	if len(b.SignedPreKeySignature) != DirectSignedPreKeySignatureLen {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"signed_pre_key_signature",
			"must contain exactly 64 bytes",
		)
	}
	if len(b.OneTimePreKeys) > MaxDirectOneTimePreKeys {
		return NewError(
			ErrorCodePayloadTooLarge,
			operation,
			"one_time_pre_keys",
			"exceeds the per-request key limit",
		)
	}
	seen := make(map[int32]struct{}, len(b.OneTimePreKeys))
	for _, key := range b.OneTimePreKeys {
		if key.KeyID <= 0 || len(key.PublicKey) != DirectOneTimePreKeyPublicBytes {
			return NewError(
				ErrorCodeInvalidArgument,
				operation,
				"one_time_pre_keys",
				"each key requires a positive ID and exactly 32 public-key bytes",
			)
		}
		if _, exists := seen[key.KeyID]; exists {
			return NewError(
				ErrorCodeConflict,
				operation,
				"one_time_pre_keys",
				"contains a duplicate key ID",
			)
		}
		seen[key.KeyID] = struct{}{}
	}
	if _, err := NormalizeSupportedWireVersions(
		operation,
		b.SupportedWireVersions,
	); err != nil {
		return err
	}
	return nil
}

func NormalizeSupportedWireVersions(
	operation string,
	versions []uint32,
) ([]uint32, error) {
	if len(versions) == 0 {
		return []uint32{0}, nil
	}
	seen := make(map[uint32]struct{}, len(versions))
	normalized := make([]uint32, 0, len(versions))
	for _, version := range versions {
		if version > 1 {
			return nil, NewError(
				ErrorCodeInvalidArgument,
				operation,
				"supported_wire_versions",
				"contains an unsupported version",
			)
		}
		if _, exists := seen[version]; exists {
			continue
		}
		seen[version] = struct{}{}
		normalized = append(normalized, version)
	}
	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i] < normalized[j]
	})
	return normalized, nil
}

type MLSKeyPackage struct {
	PackageID    string
	Device       Endpoint
	HomeStation  string
	KeyPackage   []byte
	PackageHash  [sha256.Size]byte
	CreatedAt    time.Time
	ConsumedAt   *time.Time
	ReservedPlan string
	ReservedTill *time.Time
}

func (p MLSKeyPackage) Clone() MLSKeyPackage {
	p.KeyPackage = cloneBytes(p.KeyPackage)
	if p.ConsumedAt != nil {
		consumedAt := *p.ConsumedAt
		p.ConsumedAt = &consumedAt
	}
	if p.ReservedTill != nil {
		reservedTill := *p.ReservedTill
		p.ReservedTill = &reservedTill
	}
	return p
}

func (p MLSKeyPackage) Validate(operation string) error {
	if strings.TrimSpace(p.PackageID) == "" {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"package_id",
			"is required",
		)
	}
	if err := p.Device.Validate(operation); err != nil {
		return err
	}
	if err := validateBoundedString(
		operation,
		"home_station_peer_id",
		p.HomeStation,
		MaxStationIDBytes,
	); err != nil {
		return err
	}
	if len(p.KeyPackage) == 0 {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"key_package",
			"is required",
		)
	}
	if len(p.KeyPackage) > MaxMLSKeyPackageBytes {
		return NewError(
			ErrorCodePayloadTooLarge,
			operation,
			"key_package",
			"exceeds the payload limit",
		)
	}
	if sha256.Sum256(p.KeyPackage) != p.PackageHash {
		return NewError(
			ErrorCodeConflict,
			operation,
			"key_package_sha256",
			"does not match the key package",
		)
	}
	return nil
}

type MLSKeyPackageReservation struct {
	PlanID               string
	Target               Endpoint
	PackageID            string
	KeyPackage           []byte
	PackageHash          [sha256.Size]byte
	HomeStation          string
	PlanExpiresAt        time.Time
	IrreversiblyConsumed bool
}

func (r MLSKeyPackageReservation) Clone() MLSKeyPackageReservation {
	r.KeyPackage = cloneBytes(r.KeyPackage)
	return r
}

func (r MLSKeyPackageReservation) Validate(operation string) error {
	if err := r.Target.Validate(operation); err != nil {
		return err
	}
	if strings.TrimSpace(r.PackageID) == "" {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"package_id",
			"is required",
		)
	}
	if len(r.KeyPackage) == 0 || len(r.KeyPackage) > MaxMLSKeyPackageBytes {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"key_package",
			"must be present and bounded",
		)
	}
	if sha256.Sum256(r.KeyPackage) != r.PackageHash {
		return NewError(
			ErrorCodeConflict,
			operation,
			"key_package_sha256",
			"does not match the key package",
		)
	}
	if err := validateBoundedString(
		operation,
		"home_station_peer_id",
		r.HomeStation,
		MaxStationIDBytes,
	); err != nil {
		return err
	}
	return nil
}

type MLSKeyPackageClaim struct {
	AuthenticatedAuthorityStation string
	AuthorityPlanID               string
	AuthorityStationID            string
	Target                        Endpoint
	PlanExpiresAt                 time.Time
}

type DirectKeyExchangeKind uint8

const (
	DirectKeyExchangeKindUnspecified DirectKeyExchangeKind = iota
	DirectKeyExchangeKindPreKeyBundle
	DirectKeyExchangeKindInitialMessage
	DirectKeyExchangeKindRatchetKeyUpdate
)

func (k DirectKeyExchangeKind) Validate(operation string) error {
	switch k {
	case DirectKeyExchangeKindPreKeyBundle,
		DirectKeyExchangeKindInitialMessage,
		DirectKeyExchangeKindRatchetKeyUpdate:
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

type DirectKeyExchangeCommand struct {
	Recipient                     Endpoint
	RequestedRecipientHomeStation string
	SessionID                     string
	Kind                          DirectKeyExchangeKind
	OpaqueKeyMaterial             []byte
	ConversationID                string
}

type DirectKeyExchangeEnvelope struct {
	EnvelopeID           string
	IdempotencyKey       string
	Sender               Endpoint
	Recipient            Endpoint
	RecipientHomeStation string
	SessionID            string
	Kind                 DirectKeyExchangeKind
	OpaqueKeyMaterial    []byte
	ConversationID       string
}

func (e DirectKeyExchangeEnvelope) Clone() DirectKeyExchangeEnvelope {
	e.OpaqueKeyMaterial = cloneBytes(e.OpaqueKeyMaterial)
	return e
}

func (e DirectKeyExchangeEnvelope) Validate(operation string) error {
	if strings.TrimSpace(e.EnvelopeID) == "" {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"envelope_id",
			"is required",
		)
	}
	if strings.TrimSpace(e.IdempotencyKey) == "" {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"idempotency_key",
			"is required",
		)
	}
	if err := e.Sender.Validate(operation); err != nil {
		return err
	}
	if err := e.Recipient.Validate(operation); err != nil {
		return err
	}
	if e.Sender == e.Recipient {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"recipient",
			"must differ from the sender endpoint",
		)
	}
	if err := validateBoundedString(
		operation,
		"recipient_home_station_peer_id",
		e.RecipientHomeStation,
		MaxStationIDBytes,
	); err != nil {
		return err
	}
	if err := validateBoundedString(
		operation,
		"session_id",
		e.SessionID,
		MaxSessionIDBytes,
	); err != nil {
		return err
	}
	if err := validateBoundedString(
		operation,
		"conversation_id",
		e.ConversationID,
		MaxConversationIDBytes,
	); err != nil {
		return err
	}
	if err := e.Kind.Validate(operation); err != nil {
		return err
	}
	if len(e.OpaqueKeyMaterial) == 0 {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"opaque_key_material",
			"is required",
		)
	}
	if len(e.OpaqueKeyMaterial) > MaxDirectKeyExchangePayload {
		return NewError(
			ErrorCodePayloadTooLarge,
			operation,
			"opaque_key_material",
			"exceeds the payload limit",
		)
	}
	return nil
}

func HashMLSKeyPackage(value []byte) [sha256.Size]byte {
	return sha256.Sum256(value)
}

func validateBoundedString(
	operation string,
	field string,
	value string,
	maxBytes int,
) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"is required",
		)
	}
	if len(value) > maxBytes {
		return NewError(
			ErrorCodePayloadTooLarge,
			operation,
			field,
			"exceeds the length limit",
		)
	}
	return nil
}

func cloneDirectOneTimePreKeys(
	values []DirectOneTimePreKey,
) []DirectOneTimePreKey {
	result := make([]DirectOneTimePreKey, 0, len(values))
	for _, value := range values {
		result = append(result, value.Clone())
	}
	return result
}

func cloneBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}
