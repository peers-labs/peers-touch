package application

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

const MessagingFederationFrameFormatVersion uint32 = 1

func SignFederationFrame(
	frame *chat.MessagingFederationFrame,
	signingKeyID string,
	privateKey ed25519.PrivateKey,
) error {
	if frame == nil || len(privateKey) != ed25519.PrivateKeySize || signingKeyID == "" {
		return messaging.ErrFederationFrameInvalid
	}
	frame.FormatVersion = MessagingFederationFrameFormatVersion
	frame.SigningKeyId = signingKeyID
	if err := validateFederationFrameShape(frame); err != nil {
		return err
	}
	input := federationFrameSigningInput(frame)
	bytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	frame.StationSignature = ed25519.Sign(privateKey, bytes)
	return nil
}

func VerifyFederationFrame(
	frame *chat.MessagingFederationFrame,
	expectedTargetStationID string,
	publicKey ed25519.PublicKey,
	now time.Time,
) error {
	if err := VerifyFederationFrameAuthenticity(
		frame,
		expectedTargetStationID,
		publicKey,
	); err != nil {
		return err
	}
	if frame.ExpiresAt.AsTime().Before(now) || frame.IssuedAt.AsTime().After(now.Add(time.Minute)) {
		return messaging.ErrFederationFrameExpired
	}
	return nil
}

func VerifyFederationFrameAuthenticity(
	frame *chat.MessagingFederationFrame,
	expectedTargetStationID string,
	publicKey ed25519.PublicKey,
) error {
	if frame == nil ||
		expectedTargetStationID == "" ||
		frame.TargetStationId != expectedTargetStationID ||
		len(publicKey) != ed25519.PublicKeySize ||
		len(frame.StationSignature) != ed25519.SignatureSize {
		return messaging.ErrFederationFrameInvalid
	}
	if err := validateFederationFrameShape(frame); err != nil {
		return err
	}
	input := federationFrameSigningInput(frame)
	bytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, bytes, frame.StationSignature) {
		return messaging.ErrFederationFrameSignature
	}
	return nil
}

func validateFederationFrameShape(frame *chat.MessagingFederationFrame) error {
	if frame.FormatVersion != MessagingFederationFrameFormatVersion ||
		frame.FrameId == "" ||
		frame.SourceStationId == "" ||
		frame.TargetStationId == "" ||
		frame.SourceStationId == frame.TargetStationId ||
		frame.IdempotencyKey == "" ||
		frame.PayloadType == chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_UNSPECIFIED ||
		len(frame.OpaquePayload) == 0 ||
		len(frame.PayloadSha256) != sha256.Size ||
		frame.IssuedAt == nil ||
		frame.ExpiresAt == nil ||
		!frame.ExpiresAt.AsTime().After(frame.IssuedAt.AsTime()) {
		return messaging.ErrFederationFrameInvalid
	}
	hash := sha256.Sum256(frame.OpaquePayload)
	if !bytes.Equal(hash[:], frame.PayloadSha256) {
		return messaging.ErrFederationFrameInvalid
	}
	return nil
}

func federationFrameSigningInput(
	frame *chat.MessagingFederationFrame,
) *chat.MessagingFederationFrameSigningInput {
	return &chat.MessagingFederationFrameSigningInput{
		FormatVersion:     frame.FormatVersion,
		FrameId:           frame.FrameId,
		SourceStationId:   frame.SourceStationId,
		TargetStationId:   frame.TargetStationId,
		IdempotencyKey:    frame.IdempotencyKey,
		PayloadType:       frame.PayloadType,
		ConversationId:    frame.ConversationId,
		EventId:           frame.EventId,
		AuthoritySequence: frame.AuthoritySequence,
		OpaquePayload:     frame.OpaquePayload,
		PayloadSha256:     frame.PayloadSha256,
		IssuedAt:          frame.IssuedAt,
		ExpiresAt:         frame.ExpiresAt,
		SigningKeyId:      frame.SigningKeyId,
	}
}
