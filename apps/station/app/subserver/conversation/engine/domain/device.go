package domain

import "context"

type VerifiedDeviceEnrollment struct {
	PTID                      string
	DeviceID                  string
	Label                     string
	HomeStationID             string
	ActorIdentityPublicKey    []byte
	ActorIdentityFingerprint  []byte
	DeviceSigningPublicKey    []byte
	SigningKeyID              string
	ProfileVersion            uint64
	CanonicalCertificateBytes []byte
	ActorCrossSignature       []byte
}

type DeviceEnrollmentRepository interface {
	EnrollVerifiedDevice(
		ctx context.Context,
		enrollment VerifiedDeviceEnrollment,
	) error
}
