package domain

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"testing"
	"time"
)

// TestVerifyEnrollmentEnforcesActorSignedEndpointBinding verifies every proof field.
func TestVerifyEnrollmentEnforcesActorSignedEndpointBinding(t *testing.T) {
	valid := signedDomainEnrollment()

	tests := []struct {
		name       string
		mutate     func(*Enrollment)
		authPTID   string
		authDevice string
		wantCode   ErrorCode
	}{
		{
			name:       "valid",
			mutate:     func(*Enrollment) {},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
		},
		{
			name: "unsupported format",
			mutate: func(input *Enrollment) {
				input.FormatVersion++
			},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeInvalidArgument,
		},
		{
			name:       "actor mismatch",
			mutate:     func(*Enrollment) {},
			authPTID:   "ptid:p:mallory",
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeUnauthorized,
		},
		{
			name:       "device mismatch",
			mutate:     func(*Enrollment) {},
			authPTID:   valid.PTID,
			authDevice: "mallory-device",
			wantCode:   ErrorCodeUnauthorized,
		},
		{
			name: "identity fingerprint mismatch",
			mutate: func(input *Enrollment) {
				input.ActorIdentityFingerprint[0] ^= 0xff
			},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeInvalidProof,
		},
		{
			name: "device key id mismatch",
			mutate: func(input *Enrollment) {
				input.SigningKeyID = "wrong"
			},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeInvalidProof,
		},
		{
			name: "signature mismatch",
			mutate: func(input *Enrollment) {
				input.ActorCrossSignature[0] ^= 0xff
			},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeInvalidProof,
		},
		{
			name: "zero profile version",
			mutate: func(input *Enrollment) {
				input.ProfileVersion = 0
			},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeInvalidArgument,
		},
		{
			name: "overflowing profile version",
			mutate: func(input *Enrollment) {
				input.ProfileVersion = uint64(math.MaxInt64) + 1
			},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeInvalidArgument,
		},
		{
			name: "unspecified actor kind",
			mutate: func(input *Enrollment) {
				input.ActorKind = 0
			},
			authPTID:   valid.PTID,
			authDevice: valid.DeviceID,
			wantCode:   ErrorCodeInvalidArgument,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := cloneEnrollment(valid)
			test.mutate(&input)

			err := VerifyEnrollment(test.authPTID, test.authDevice, input)
			if test.wantCode == "" {
				if err != nil {
					t.Fatalf("VerifyEnrollment() error = %v", err)
				}

				return
			}
			if !IsCode(err, test.wantCode) {
				t.Fatalf("VerifyEnrollment() error = %v, want code %s", err, test.wantCode)
			}
		})
	}
}

// TestDeviceEnrollmentAndRevocationInvariants verifies terminal lifecycle rules.
func TestDeviceEnrollmentAndRevocationInvariants(t *testing.T) {
	enrollment := signedDomainEnrollment()
	identity := ActorIdentity{
		PTID:           enrollment.PTID,
		PublicKey:      append([]byte(nil), enrollment.ActorIdentityPublicKey...),
		Fingerprint:    append([]byte(nil), enrollment.ActorIdentityFingerprint...),
		ProfileVersion: 2,
	}

	stale := cloneEnrollment(enrollment)
	stale.ProfileVersion = 1
	if err := identity.ValidateEnrollment(stale); !IsCode(err, ErrorCodeStaleProfileVersion) {
		t.Fatalf("stale identity error = %v", err)
	}

	otherIdentity := cloneEnrollment(enrollment)
	otherIdentity.ActorIdentityPublicKey[0] ^= 0xff
	if err := identity.ValidateEnrollment(otherIdentity); !IsCode(err, ErrorCodeIdentityConflict) {
		t.Fatalf("identity continuity error = %v", err)
	}

	device := Device{
		PTID:                   enrollment.PTID,
		DeviceID:               enrollment.DeviceID,
		HomeStationPeerID:      enrollment.HomeStationPeerID,
		DeviceSigningPublicKey: append([]byte(nil), enrollment.DeviceSigningPublicKey...),
		SigningKeyID:           enrollment.SigningKeyID,
		ProfileVersion:         2,
		Verified:               true,
		Status:                 DeviceStatusActive,
	}
	rotated := cloneEnrollment(enrollment)
	rotated.ProfileVersion = 2
	rotated.DeviceSigningPublicKey[0] ^= 0xff
	if err := device.ValidateEnrollment(rotated); !IsCode(err, ErrorCodeDeviceConflict) {
		t.Fatalf("device rotation error = %v", err)
	}

	now := time.Date(2026, time.September, 6, 15, 0, 0, 0, time.UTC)
	if _, err := device.Revoke(1, 2, now); !IsCode(err, ErrorCodeStaleProfileVersion) {
		t.Fatalf("stale revoke error = %v", err)
	}
	if _, err := device.Revoke(3, 2, now); !IsCode(err, ErrorCodeFutureProfileVersion) {
		t.Fatalf("future revoke error = %v", err)
	}
	revoked, err := device.Revoke(2, 2, now)
	if err != nil {
		t.Fatal(err)
	}
	if revoked.Status != DeviceStatusRevoked ||
		revoked.RevokedAt == nil ||
		!revoked.RevokedAt.Equal(now) {
		t.Fatalf("unexpected revoked device: %+v", revoked)
	}
	if replayed, err := revoked.Revoke(2, 2, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	} else if replayed.RevokedAt == nil || !replayed.RevokedAt.Equal(now) {
		t.Fatalf("revoke replay changed terminal timestamp: %+v", replayed)
	}
}

func TestUnverifiedDeviceUpgradeRetainsConflictFences(t *testing.T) {
	enrollment := signedDomainEnrollment()
	unverified := Device{
		PTID:                   enrollment.PTID,
		DeviceID:               enrollment.DeviceID,
		HomeStationPeerID:      enrollment.HomeStationPeerID,
		ProfileVersion:         enrollment.ProfileVersion,
		ActivationSequence:     41,
		Status:                 DeviceStatusActive,
		DeviceSigningPublicKey: nil,
	}
	if err := unverified.ValidateEnrollment(enrollment); err != nil {
		t.Fatalf("compatible unverified upgrade error = %v", err)
	}

	conflictingKey := unverified
	conflictingKey.DeviceSigningPublicKey = bytesOf(
		0xff,
		ed25519.PublicKeySize,
	)
	if err := conflictingKey.ValidateEnrollment(
		enrollment,
	); !IsCode(err, ErrorCodeDeviceConflict) {
		t.Fatalf("unverified key conflict error = %v", err)
	}

	stale := cloneEnrollment(enrollment)
	stale.ProfileVersion--
	if err := unverified.ValidateEnrollment(
		stale,
	); !IsCode(err, ErrorCodeStaleProfileVersion) {
		t.Fatalf("unverified profile conflict error = %v", err)
	}

	revoked := unverified
	revoked.Status = DeviceStatusRevoked
	if err := revoked.ValidateEnrollment(
		enrollment,
	); !IsCode(err, ErrorCodeDeviceRevoked) {
		t.Fatalf("unverified revocation conflict error = %v", err)
	}
}

func signedDomainEnrollment() Enrollment {
	actorPrivate := ed25519.NewKeyFromSeed(bytesOf(0x11, ed25519.SeedSize))
	actorPublic := actorPrivate.Public().(ed25519.PublicKey)
	devicePrivate := ed25519.NewKeyFromSeed(bytesOf(0x22, ed25519.SeedSize))
	devicePublic := devicePrivate.Public().(ed25519.PublicKey)
	identityFingerprint := sha256.Sum256(actorPublic)
	deviceFingerprint := sha256.Sum256(devicePublic)
	certificate := []byte("canonical-actor-device-certificate")

	return Enrollment{
		FormatVersion:             DeviceCertificateFormatVersion,
		PTID:                      "ptid:p:alice",
		ActorAccount:              "alice@example.test",
		ActorKind:                 1,
		DeviceID:                  "alice-device",
		Label:                     "Alice Desktop",
		HomeStationPeerID:         "station-a",
		ActorIdentityPublicKey:    append([]byte(nil), actorPublic...),
		ActorIdentityFingerprint:  append([]byte(nil), identityFingerprint[:]...),
		DeviceSigningPublicKey:    append([]byte(nil), devicePublic...),
		SigningKeyID:              hex.EncodeToString(deviceFingerprint[:]),
		ProfileVersion:            2,
		CanonicalCertificateBytes: append([]byte(nil), certificate...),
		ActorCrossSignature:       ed25519.Sign(actorPrivate, certificate),
	}
}

func cloneEnrollment(input Enrollment) Enrollment {
	cloned := input
	cloned.ActorIdentityPublicKey = append([]byte(nil), input.ActorIdentityPublicKey...)
	cloned.ActorIdentityFingerprint = append([]byte(nil), input.ActorIdentityFingerprint...)
	cloned.DeviceSigningPublicKey = append([]byte(nil), input.DeviceSigningPublicKey...)
	cloned.CanonicalCertificateBytes = append([]byte(nil), input.CanonicalCertificateBytes...)
	cloned.ActorCrossSignature = append([]byte(nil), input.ActorCrossSignature...)

	return cloned
}

func bytesOf(value byte, size int) []byte {
	result := make([]byte, size)
	for index := range result {
		result[index] = value
	}

	return result
}
