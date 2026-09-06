package application

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const MessagingDeviceCertificateFormatVersion uint32 = 1

type DeviceService struct {
	repository     domain.DeviceEnrollmentRepository
	localStationID string
	clock          func() time.Time
}

func NewDeviceService(
	repository domain.DeviceEnrollmentRepository,
	localStationID string,
	clock func() time.Time,
) (*DeviceService, error) {
	if repository == nil || localStationID == "" || clock == nil {
		return nil, fmt.Errorf("messaging: device service dependencies are invalid")
	}
	return &DeviceService{
		repository:     repository,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

func (s *DeviceService) Enroll(
	ctx context.Context,
	authenticatedPTID string,
	authenticatedDeviceID string,
	request *chat.EnrollMessagingDeviceRequest,
) (*chat.EnrollMessagingDeviceResponse, error) {
	if request == nil || request.Certificate == nil {
		return nil, fmt.Errorf("messaging: device certificate is required")
	}
	certificate := request.Certificate
	if certificate.FormatVersion != MessagingDeviceCertificateFormatVersion ||
		certificate.Ptid == "" ||
		certificate.Ptid != authenticatedPTID ||
		certificate.DeviceId == "" ||
		certificate.DeviceId != authenticatedDeviceID ||
		len(certificate.ActorIdentityPublicKey) != ed25519.PublicKeySize ||
		len(certificate.ActorIdentityKeyFingerprint) != sha256.Size ||
		len(certificate.DeviceSigningPublicKey) != ed25519.PublicKeySize ||
		certificate.SigningKeyId == "" ||
		certificate.ObservedProfileVersion == 0 ||
		len(request.ActorCrossSignature) != ed25519.SignatureSize {
		return nil, fmt.Errorf("messaging: device enrollment binding is invalid")
	}
	certificateBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(certificate)
	if err != nil {
		return nil, fmt.Errorf("messaging: encode device certificate: %w", err)
	}
	if err := s.repository.EnrollVerifiedDevice(ctx, domain.VerifiedDeviceEnrollment{
		PTID:                      certificate.Ptid,
		DeviceID:                  certificate.DeviceId,
		Label:                     request.Label,
		HomeStationID:             s.localStationID,
		ActorIdentityPublicKey:    certificate.ActorIdentityPublicKey,
		ActorIdentityFingerprint:  certificate.ActorIdentityKeyFingerprint,
		DeviceSigningPublicKey:    certificate.DeviceSigningPublicKey,
		SigningKeyID:              certificate.SigningKeyId,
		ProfileVersion:            certificate.ObservedProfileVersion,
		CanonicalCertificateBytes: certificateBytes,
		ActorCrossSignature:       request.ActorCrossSignature,
	}); err != nil {
		return nil, err
	}
	now := s.clock().UTC()
	return &chat.EnrollMessagingDeviceResponse{
		Device: &chat.MessagingDevice{
			Endpoint: &chat.CryptoEndpoint{
				Ptid:     certificate.Ptid,
				DeviceId: certificate.DeviceId,
			},
			Status:                      chat.MessagingDeviceStatus_MESSAGING_DEVICE_STATUS_ACTIVE,
			Label:                       request.Label,
			ActorIdentityKeyFingerprint: append([]byte(nil), certificate.ActorIdentityKeyFingerprint...),
			SigningKeyId:                certificate.SigningKeyId,
			ProfileVersion:              certificate.ObservedProfileVersion,
			EnrolledAt:                  timestamppb.New(now),
		},
	}, nil
}
