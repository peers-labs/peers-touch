package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"sort"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type FederationPolicy struct {
	MaxBatchWrites int
}

type AuthorityCommandService interface {
	Submit(
		ctx context.Context,
		command *chat.ChatCommand,
	) (*chat.ConversationEvent, error)
}

type FederationService struct {
	unitOfWork       messaging.FederationInboxUnitOfWork
	devices          DeviceAccess
	authority        AuthorityCommandService
	manifestResolver messaging.EndpointManifestResolver
	manifestVerifier messaging.LocalEndpointManifestVerifier
	follower         *FollowerProjectionService
	policy           FederationPolicy
}

func NewFederationService(
	unitOfWork messaging.FederationInboxUnitOfWork,
	devices DeviceAccess,
	authority AuthorityCommandService,
	manifestResolver messaging.EndpointManifestResolver,
	manifestVerifier messaging.LocalEndpointManifestVerifier,
	follower *FollowerProjectionService,
	policy FederationPolicy,
) (*FederationService, error) {
	if unitOfWork == nil ||
		devices == nil ||
		authority == nil ||
		manifestResolver == nil ||
		manifestVerifier == nil ||
		follower == nil ||
		policy.MaxBatchWrites <= 0 {
		return nil, fmt.Errorf("messaging: federation service dependencies are invalid")
	}
	return &FederationService{
		unitOfWork:       unitOfWork,
		devices:          devices,
		authority:        authority,
		manifestResolver: manifestResolver,
		manifestVerifier: manifestVerifier,
		follower:         follower,
		policy:           policy,
	}, nil
}

func (s *FederationService) Deliver(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	expectedTargetStationID string,
	sourceStationPublicKey ed25519.PublicKey,
	now time.Time,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	if err := VerifyFederationFrameAuthenticity(
		frame,
		expectedTargetStationID,
		sourceStationPublicKey,
	); err != nil {
		return nil, err
	}
	duplicate, err := s.unitOfWork.MatchFederationFrame(ctx, frame)
	if err != nil {
		return nil, err
	}
	if duplicate {
		return &chat.DeliverMessagingFederationFrameResponse{
			Accepted:  true,
			Duplicate: true,
		}, nil
	}
	if frame.ExpiresAt.AsTime().Before(now) || frame.IssuedAt.AsTime().After(now.Add(time.Minute)) {
		return nil, messaging.ErrFederationFrameExpired
	}
	if frame.ConversationId == "" {
		return nil, messaging.ErrFederationFrameInvalid
	}
	switch frame.PayloadType {
	case chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_DEVICE_QUEUE_BATCH:
		if frame.EventId == "" {
			return nil, messaging.ErrFederationFrameInvalid
		}
		return s.deliverDeviceQueueBatch(ctx, frame, now)
	case chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_FOLLOWER_PROJECTION:
		if frame.EventId == "" {
			return nil, messaging.ErrFederationFrameInvalid
		}
		return s.follower.DeliverProjection(ctx, frame, sourceStationPublicKey, now)
	case chat.MessagingFederationPayloadType_MESSAGING_FEDERATION_PAYLOAD_TYPE_AUTHORITY_COMMAND:
		return s.deliverAuthorityCommand(ctx, frame, now)
	default:
		return nil, messaging.ErrFederationFrameInvalid
	}
}

func (s *FederationService) deliverDeviceQueueBatch(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	now time.Time,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	batch := &chat.FederatedDeviceQueueBatch{}
	if err := proto.Unmarshal(frame.OpaquePayload, batch); err != nil {
		return nil, messaging.ErrFederationFrameInvalid
	}
	if len(batch.Writes) == 0 || len(batch.Writes) > s.policy.MaxBatchWrites {
		return nil, messaging.ErrFederationFrameInvalid
	}
	manifestByActor, err := s.validateEndpointManifests(
		ctx,
		batch.EndpointManifests,
		frame.TargetStationId,
		now,
	)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(batch.Writes))
	var publicEvent *chat.ConversationEvent
	for _, write := range batch.Writes {
		if write == nil ||
			write.Recipient == nil ||
			write.Recipient.Ptid == "" ||
			write.Recipient.DeviceId == "" ||
			write.EventId != frame.EventId ||
			write.ConversationId != frame.ConversationId ||
			write.IdempotencyKey == "" ||
			write.PayloadType == chat.DeviceQueuePayloadType_DEVICE_QUEUE_PAYLOAD_TYPE_UNSPECIFIED ||
			len(write.OpaquePayload) == 0 ||
			len(write.PayloadSha256) != sha256.Size {
			return nil, messaging.ErrFederationFrameInvalid
		}
		manifest := manifestByActor[write.Recipient.Ptid]
		if manifest == nil || !manifestContainsEndpoint(manifest, write.Recipient) {
			return nil, messaging.ErrEndpointManifestConflict
		}
		hash := sha256.Sum256(write.OpaquePayload)
		if !bytes.Equal(hash[:], write.PayloadSha256) {
			return nil, messaging.ErrFederationFrameInvalid
		}
		delivery, err := validateFederatedDeviceEventDelivery(write, frame)
		if err != nil {
			return nil, err
		}
		if publicEvent == nil {
			publicEvent = delivery.Event
		} else if !proto.Equal(publicEvent, delivery.Event) {
			return nil, messaging.ErrFederationFrameInvalid
		}
		key := write.Recipient.Ptid + "\x00" + write.Recipient.DeviceId
		if _, duplicate := seen[key]; duplicate {
			return nil, messaging.ErrFederationFrameInvalid
		}
		seen[key] = struct{}{}
	}

	return s.follower.IngestDeviceEventFrame(
		ctx,
		frame,
		publicEvent,
		func(repositories messaging.FederationInboxRepositories) error {
			for _, write := range batch.Writes {
				active, err := s.devices.IsActiveDevice(
					ctx,
					write.Recipient.Ptid,
					write.Recipient.DeviceId,
				)
				if err != nil {
					return err
				}
				if !active {
					continue
				}
				if _, err := repositories.Queue.Enqueue(ctx, &chat.DeviceQueueItem{
					Recipient:      write.Recipient,
					EventId:        write.EventId,
					ConversationId: write.ConversationId,
					IdempotencyKey: write.IdempotencyKey,
					PayloadType:    write.PayloadType,
					OpaquePayload:  write.OpaquePayload,
					PayloadSha256:  write.PayloadSha256,
				}); err != nil {
					return err
				}
			}
			return nil
		},
		now,
	)
}

func (s *FederationService) deliverAuthorityCommand(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	now time.Time,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	payload := &chat.FederatedAuthorityCommand{}
	if err := proto.Unmarshal(frame.OpaquePayload, payload); err != nil ||
		payload.Command == nil ||
		payload.Command.Sender == nil ||
		payload.SourceHomeStationId != frame.SourceStationId ||
		payload.Command.AuthorityStationId != frame.TargetStationId ||
		payload.Command.ConversationId != frame.ConversationId ||
		frame.EventId != "" ||
		frame.AuthoritySequence != 0 {
		return nil, messaging.ErrFederationFrameInvalid
	}
	manifests, err := resolveEndpointManifestSnapshots(
		ctx,
		s.manifestResolver,
		[]string{payload.Command.Sender.Ptid},
	)
	if err != nil {
		return nil, err
	}
	senderManifest, _, err := manifestEntryForEndpoint(
		manifests,
		payload.Command.Sender,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"messaging: authority command sender endpoint is absent from the verified manifest: %w",
			messaging.ErrSenderUnauthorized,
		)
	}
	if senderManifest.HomeStationId != frame.SourceStationId {
		return nil, messaging.ErrSenderUnauthorized
	}
	if _, err := s.authority.Submit(ctx, payload.Command); err != nil {
		return nil, err
	}
	duplicate, acknowledged, err := s.unitOfWork.IngestFederationFrame(
		ctx,
		frame,
		now.UTC(),
		func(messaging.FederationInboxRepositories) (messaging.FederationInboxMutation, error) {
			return messaging.FederationInboxMutation{Acknowledge: true}, nil
		},
	)
	if err != nil {
		return nil, err
	}
	if !acknowledged {
		return nil, messaging.ErrFederationFrameInvalid
	}
	return &chat.DeliverMessagingFederationFrameResponse{
		Accepted:  true,
		Duplicate: duplicate,
	}, nil
}

func validateFederatedDeviceEventDelivery(
	write *chat.FederatedDeviceQueueWrite,
	frame *chat.MessagingFederationFrame,
) (*chat.DeviceEventDelivery, error) {
	delivery := &chat.DeviceEventDelivery{}
	if err := unmarshalDeterministic(write.OpaquePayload, delivery); err != nil {
		return nil, messaging.ErrFederationFrameInvalid
	}
	event := delivery.Event
	if event == nil ||
		delivery.Recipient == nil ||
		delivery.Recipient.Ptid != write.Recipient.Ptid ||
		delivery.Recipient.DeviceId != write.Recipient.DeviceId ||
		event.EventId != write.EventId ||
		event.EventId != frame.EventId ||
		event.ConversationId != write.ConversationId ||
		event.ConversationId != frame.ConversationId ||
		event.Sequence != frame.AuthoritySequence ||
		event.AuthorityStationId != frame.SourceStationId ||
		delivery.PayloadKind == chat.PreparedEndpointPayloadKind_PREPARED_ENDPOINT_PAYLOAD_KIND_UNSPECIFIED ||
		len(delivery.EndpointPayloadSha256) != sha256.Size ||
		len(delivery.DeliveryCommitment) != sha256.Size {
		return nil, messaging.ErrFederationFrameInvalid
	}
	if err := validateFollowerEvent(event); err != nil {
		return nil, err
	}
	payloadHash := sha256.Sum256(delivery.EndpointPayload)
	if !bytes.Equal(payloadHash[:], delivery.EndpointPayloadSha256) {
		return nil, messaging.ErrFederationFrameInvalid
	}
	commitment := deliveryCommitment(
		event.EventId,
		event.ConversationId,
		&chat.PreparedEndpointPayload{
			Recipient:     delivery.Recipient,
			Kind:          delivery.PayloadKind,
			PayloadSha256: delivery.EndpointPayloadSha256,
		},
	)
	if !bytes.Equal(commitment, delivery.DeliveryCommitment) {
		return nil, messaging.ErrFederationFrameInvalid
	}
	index := sort.Search(
		len(event.DeliveryCommitments),
		func(index int) bool {
			return bytes.Compare(event.DeliveryCommitments[index], commitment) >= 0
		},
	)
	if index >= len(event.DeliveryCommitments) ||
		!bytes.Equal(event.DeliveryCommitments[index], commitment) {
		return nil, messaging.ErrFederationFrameInvalid
	}
	return delivery, nil
}

func (s *FederationService) validateEndpointManifests(
	ctx context.Context,
	manifests []*chat.FederatedEndpointManifest,
	expectedHomeStationID string,
	now time.Time,
) (map[string]*chat.FederatedEndpointManifest, error) {
	if len(manifests) == 0 {
		return nil, messaging.ErrEndpointManifestInvalid
	}
	byActor := make(map[string]*chat.FederatedEndpointManifest, len(manifests))
	for _, manifest := range manifests {
		if manifest == nil || byActor[manifest.ActorPtid] != nil {
			return nil, messaging.ErrEndpointManifestConflict
		}
		if err := s.manifestVerifier.VerifyLocalEndpointManifest(
			ctx,
			manifest,
			expectedHomeStationID,
			now,
		); err != nil {
			return nil, err
		}
		current, err := s.manifestResolver.ResolveEndpointManifest(
			ctx,
			manifest.ActorPtid,
		)
		if err != nil {
			return nil, err
		}
		if manifest.DirectoryVersion > current.DirectoryVersion {
			return nil, messaging.ErrEndpointManifestConflict
		}
		if manifest.DirectoryVersion == current.DirectoryVersion {
			if !SameEndpointManifestState(manifest, current) {
				return nil, messaging.ErrEndpointManifestConflict
			}
		} else if !SameEndpointManifestRoutingState(manifest, current) {
			return nil, messaging.ErrEndpointManifestRollback
		}
		byActor[manifest.ActorPtid] = manifest
	}
	return byActor, nil
}

func manifestContainsEndpoint(
	manifest *chat.FederatedEndpointManifest,
	endpoint *chat.CryptoEndpoint,
) bool {
	for _, entry := range manifest.ActiveEndpoints {
		if entry != nil &&
			entry.Endpoint != nil &&
			entry.Endpoint.Ptid == endpoint.Ptid &&
			entry.Endpoint.DeviceId == endpoint.DeviceId {
			return true
		}
	}
	return false
}
