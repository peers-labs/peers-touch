package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strings"
	"time"
)

const (
	// DeviceCertificateFormatVersion is the only accepted actor-device certificate format.
	DeviceCertificateFormatVersion uint32 = 1

	maxPTIDLength         = 255
	maxDeviceIDLength     = 255
	maxDeviceLabelLength  = 255
	maxActorAccountLength = 255
	firstActorKind        = 1
	lastActorKind         = 6
)

// DeviceStatus is the persisted lifecycle state exposed by Actor Identity.
type DeviceStatus uint8

const (
	DeviceStatusActive DeviceStatus = iota + 1
	DeviceStatusRevoked
)

// Enrollment is an actor-authorized request to activate one device signing key.
type Enrollment struct {
	FormatVersion             uint32
	PTID                      string
	ActorAccount              string
	ActorKind                 int32
	DeviceID                  string
	Label                     string
	HomeStationPeerID         string
	ActorIdentityPublicKey    []byte
	ActorIdentityFingerprint  []byte
	DeviceSigningPublicKey    []byte
	SigningKeyID              string
	ProfileVersion            uint64
	CanonicalCertificateBytes []byte
	ActorCrossSignature       []byte
}

// ActorIdentity is the continuity record for one actor identity key.
type ActorIdentity struct {
	PTID           string
	PublicKey      []byte
	Fingerprint    []byte
	ProfileVersion uint64
}

// Device is one verified actor-device lifecycle record.
type Device struct {
	PTID                     string
	ActorAccount             string
	ActorKind                int32
	DeviceID                 string
	Label                    string
	HomeStationPeerID        string
	ActorIdentityFingerprint []byte
	DeviceSigningPublicKey   []byte
	SigningKeyID             string
	ProfileVersion           uint64
	ActivationSequence       int64
	Verified                 bool
	Status                   DeviceStatus
	EnrolledAt               time.Time
	RevokedAt                *time.Time
}

// ValidatePTID verifies one canonical cross-boundary actor identifier.
func ValidatePTID(operation string, ptid string) error {
	return validateCanonicalIdentifier(operation, "ptid", ptid, maxPTIDLength)
}

// ValidateDeviceID verifies one canonical actor-device identifier.
func ValidateDeviceID(operation string, deviceID string) error {
	return validateCanonicalIdentifier(operation, "device_id", deviceID, maxDeviceIDLength)
}

// ValidateProfileVersion verifies a profile version can be persisted losslessly.
func ValidateProfileVersion(operation string, profileVersion uint64) error {
	if profileVersion == 0 || profileVersion > math.MaxInt64 {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"observed_profile_version",
			"must fit a positive signed 64-bit value",
		)
	}

	return nil
}

// VerifyEnrollment validates endpoint binding, canonical hashes, and the actor signature.
func VerifyEnrollment(
	authenticatedPTID string,
	authenticatedDeviceID string,
	enrollment Enrollment,
) error {
	const operation = "actor_identity.verify_enrollment"

	if enrollment.FormatVersion != DeviceCertificateFormatVersion {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"format_version",
			"is unsupported",
		)
	}
	if err := validateCanonicalIdentifier(
		operation,
		"authenticated_ptid",
		authenticatedPTID,
		maxPTIDLength,
	); err != nil {
		return NewError(
			ErrorCodeUnauthorized,
			operation,
			"authenticated_ptid",
			"is required",
		)
	}
	if err := validateCanonicalIdentifier(
		operation,
		"authenticated_device_id",
		authenticatedDeviceID,
		maxDeviceIDLength,
	); err != nil {
		return NewError(
			ErrorCodeUnauthorized,
			operation,
			"authenticated_device_id",
			"is required",
		)
	}
	if err := ValidatePTID(operation, enrollment.PTID); err != nil {
		return err
	}
	if enrollment.PTID != authenticatedPTID {
		return NewError(
			ErrorCodeUnauthorized,
			operation,
			"ptid",
			"does not match the authenticated actor",
		)
	}
	if err := ValidateDeviceID(operation, enrollment.DeviceID); err != nil {
		return err
	}
	if enrollment.DeviceID != authenticatedDeviceID {
		return NewError(
			ErrorCodeUnauthorized,
			operation,
			"device_id",
			"does not match the authenticated device",
		)
	}
	if enrollment.ActorAccount != strings.TrimSpace(enrollment.ActorAccount) ||
		len(enrollment.ActorAccount) > maxActorAccountLength {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"actor.acct",
			"must be canonical and at most 255 bytes",
		)
	}
	if enrollment.ActorKind < firstActorKind || enrollment.ActorKind > lastActorKind {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"actor.kind",
			"must identify a concrete actor kind",
		)
	}
	if enrollment.Label != strings.TrimSpace(enrollment.Label) ||
		len(enrollment.Label) > maxDeviceLabelLength {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"label",
			"must be canonical and at most 255 bytes",
		)
	}
	if enrollment.HomeStationPeerID == "" ||
		enrollment.HomeStationPeerID != strings.TrimSpace(enrollment.HomeStationPeerID) {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			"home_station_peer_id",
			"is required and must be canonical",
		)
	}
	if err := ValidateProfileVersion(operation, enrollment.ProfileVersion); err != nil {
		return err
	}
	if len(enrollment.ActorIdentityPublicKey) != ed25519.PublicKeySize ||
		len(enrollment.ActorIdentityFingerprint) != sha256.Size ||
		len(enrollment.DeviceSigningPublicKey) != ed25519.PublicKeySize ||
		len(enrollment.ActorCrossSignature) != ed25519.SignatureSize ||
		len(enrollment.CanonicalCertificateBytes) == 0 {
		return NewError(
			ErrorCodeInvalidProof,
			operation,
			"certificate",
			"contains invalid key, fingerprint, signature, or canonical bytes",
		)
	}

	identityFingerprint := sha256.Sum256(enrollment.ActorIdentityPublicKey)
	deviceFingerprint := sha256.Sum256(enrollment.DeviceSigningPublicKey)
	if !bytes.Equal(identityFingerprint[:], enrollment.ActorIdentityFingerprint) ||
		hex.EncodeToString(deviceFingerprint[:]) != enrollment.SigningKeyID ||
		!ed25519.Verify(
			ed25519.PublicKey(enrollment.ActorIdentityPublicKey),
			enrollment.CanonicalCertificateBytes,
			enrollment.ActorCrossSignature,
		) {
		return NewError(
			ErrorCodeInvalidProof,
			operation,
			"actor_cross_signature",
			"does not authorize the canonical device certificate",
		)
	}

	return nil
}

// ValidateEnrollment enforces identity-key continuity and monotonic profile versions.
func (i ActorIdentity) ValidateEnrollment(enrollment Enrollment) error {
	const operation = "actor_identity.validate_identity_continuity"

	if i.PTID != enrollment.PTID ||
		!bytes.Equal(i.PublicKey, enrollment.ActorIdentityPublicKey) ||
		!bytes.Equal(i.Fingerprint, enrollment.ActorIdentityFingerprint) {
		return NewError(
			ErrorCodeIdentityConflict,
			operation,
			"actor_identity_public_key",
			"does not match the established actor identity",
		)
	}
	if enrollment.ProfileVersion < i.ProfileVersion {
		return NewError(
			ErrorCodeStaleProfileVersion,
			operation,
			"observed_profile_version",
			"is older than the established actor profile version",
		)
	}

	return nil
}

// ValidateEnrollment enforces idempotent enrollment without key rotation or reactivation.
func (d Device) ValidateEnrollment(enrollment Enrollment) error {
	const operation = "actor_identity.validate_device_enrollment"

	if d.Status == DeviceStatusRevoked {
		return NewError(
			ErrorCodeDeviceRevoked,
			operation,
			"device_id",
			"cannot be reactivated by replaying an enrollment certificate",
		)
	}
	if d.PTID != enrollment.PTID || d.DeviceID != enrollment.DeviceID {
		return NewError(
			ErrorCodeDeviceConflict,
			operation,
			"device_id",
			"is already bound to different verified device material",
		)
	}
	if enrollment.ProfileVersion < d.ProfileVersion {
		return NewError(
			ErrorCodeStaleProfileVersion,
			operation,
			"observed_profile_version",
			"is older than the device profile version",
		)
	}
	if !d.Verified {
		if (d.HomeStationPeerID != "" &&
			d.HomeStationPeerID != enrollment.HomeStationPeerID) ||
			(d.SigningKeyID != "" &&
				d.SigningKeyID != enrollment.SigningKeyID) ||
			(len(d.DeviceSigningPublicKey) != 0 &&
				!bytes.Equal(
					d.DeviceSigningPublicKey,
					enrollment.DeviceSigningPublicKey,
				)) {
			return NewError(
				ErrorCodeDeviceConflict,
				operation,
				"device_id",
				"contains unverified material that conflicts with the signed enrollment",
			)
		}

		return nil
	}
	if d.HomeStationPeerID != enrollment.HomeStationPeerID ||
		d.SigningKeyID != enrollment.SigningKeyID ||
		!bytes.Equal(d.DeviceSigningPublicKey, enrollment.DeviceSigningPublicKey) {
		return NewError(
			ErrorCodeDeviceConflict,
			operation,
			"device_id",
			"is already bound to different verified device material",
		)
	}

	return nil
}

// Revoke validates the profile-version fence and returns the terminal device state.
func (d Device) Revoke(
	observedProfileVersion uint64,
	currentProfileVersion uint64,
	revokedAt time.Time,
) (Device, error) {
	const operation = "actor_identity.revoke_device"

	if d.Status == DeviceStatusRevoked &&
		observedProfileVersion == d.ProfileVersion {
		return d.Clone(), nil
	}
	switch {
	case observedProfileVersion == 0:
		return Device{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"observed_profile_version",
			"is required",
		)
	case observedProfileVersion < currentProfileVersion:
		return Device{}, NewError(
			ErrorCodeStaleProfileVersion,
			operation,
			"observed_profile_version",
			"is older than the established actor profile version",
		)
	case observedProfileVersion > currentProfileVersion:
		return Device{}, NewError(
			ErrorCodeFutureProfileVersion,
			operation,
			"observed_profile_version",
			"is newer than the established actor profile version",
		)
	}
	if d.Status == DeviceStatusRevoked {
		return Device{}, NewError(
			ErrorCodeDeviceConflict,
			operation,
			"observed_profile_version",
			"does not match the terminal revocation",
		)
	}
	if revokedAt.IsZero() {
		return Device{}, NewError(
			ErrorCodeInvalidArgument,
			operation,
			"revoked_at",
			"is required",
		)
	}

	revoked := d.Clone()
	at := revokedAt.UTC()
	revoked.ProfileVersion = observedProfileVersion
	revoked.Status = DeviceStatusRevoked
	revoked.RevokedAt = &at

	return revoked, nil
}

// Clone returns a defensive copy of device key material and timestamps.
func (d Device) Clone() Device {
	cloned := d
	cloned.ActorIdentityFingerprint = append([]byte(nil), d.ActorIdentityFingerprint...)
	cloned.DeviceSigningPublicKey = append([]byte(nil), d.DeviceSigningPublicKey...)
	if d.RevokedAt != nil {
		revokedAt := d.RevokedAt.UTC()
		cloned.RevokedAt = &revokedAt
	}

	return cloned
}

func validateCanonicalIdentifier(
	operation string,
	field string,
	value string,
	maxLength int,
) error {
	if value == "" || value != strings.TrimSpace(value) || len(value) > maxLength {
		return NewError(
			ErrorCodeInvalidArgument,
			operation,
			field,
			"must be non-empty, canonical, and within its length limit",
		)
	}

	return nil
}
