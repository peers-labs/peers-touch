package application

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type AuthorityCommandForwarder struct {
	devices        messaging.DeviceDirectory
	outbox         messaging.FederationOutboxRepository
	signer         messaging.FederationFrameSigner
	localStationID string
	clock          func() time.Time
}

func NewAuthorityCommandForwarder(
	devices messaging.DeviceDirectory,
	outbox messaging.FederationOutboxRepository,
	signer messaging.FederationFrameSigner,
	localStationID string,
	clock func() time.Time,
) (*AuthorityCommandForwarder, error) {
	if devices == nil ||
		outbox == nil ||
		signer == nil ||
		localStationID == "" ||
		clock == nil {
		return nil, fmt.Errorf("messaging: authority command forwarder dependencies are invalid")
	}
	return &AuthorityCommandForwarder{
		devices:        devices,
		outbox:         outbox,
		signer:         signer,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

func (f *AuthorityCommandForwarder) Forward(
	ctx context.Context,
	command *chat.ChatCommand,
) error {
	if command == nil ||
		command.CommandId == "" ||
		command.ConversationId == "" ||
		command.Sender == nil ||
		command.AuthorityStationId == "" ||
		command.AuthorityStationId == f.localStationID {
		return messaging.ErrFederationFrameInvalid
	}
	active, err := f.devices.IsActive(ctx, command.Sender)
	if err != nil {
		return err
	}
	if !active {
		return messaging.ErrSenderUnauthorized
	}
	homeStationID, err := f.devices.HomeStationID(ctx, command.Sender)
	if err != nil {
		return err
	}
	if homeStationID != f.localStationID {
		return messaging.ErrSenderUnauthorized
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&chat.FederatedAuthorityCommand{
			Command:             command,
			SourceHomeStationId: f.localStationID,
		},
	)
	if err != nil {
		return err
	}
	payloadHash := sha256.Sum256(payloadBytes)
	now := f.clock().UTC()
	idempotencyKey := "authority-command:" + command.CommandId
	frame := &chat.MessagingFederationFrame{
		FrameId: uuid.NewSHA1(
			uuid.NameSpaceOID,
			[]byte(f.localStationID+"\x00"+command.AuthorityStationId+"\x00"+idempotencyKey),
		).String(),
		SourceStationId: f.localStationID,
		TargetStationId: command.AuthorityStationId,
		IdempotencyKey:  idempotencyKey,
		PayloadType:     chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_AUTHORITY_COMMAND,
		ConversationId:  command.ConversationId,
		OpaquePayload:   payloadBytes,
		PayloadSha256:   payloadHash[:],
		IssuedAt:        timestamppb.New(now),
		ExpiresAt:       timestamppb.New(now.Add(5 * time.Minute)),
	}
	if err := f.signer.SignFederationFrame(ctx, frame); err != nil {
		return err
	}
	return f.outbox.EnqueueFederationFrame(ctx, frame, now)
}
