package key_exchange

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	deliveryapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	keyExchangeQueueMaxItems = 10_000
	keyExchangeQueueMaxBytes = 64 << 20
	keyExchangeFrameLifetime = 24 * time.Hour
)

type systemClock struct{}

func (systemClock) Now() time.Time {
	return time.Now().UTC()
}

type uuidGenerator struct{}

func (uuidGenerator) NewID() string {
	return uuid.NewString()
}

type actorDeviceDirectory struct {
	store *touchactor.DeviceStore
}

type actorHomeStationCapability interface {
	ResolveActorHomeStationPeerID(
		context.Context,
		string,
	) (string, error)
}

type actorSigningKeyCapability interface {
	ResolveVerifiedActorDeviceSigningKey(
		context.Context,
		federationdelivery.Transaction,
		string,
		string,
		string,
		string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
	ResolveRetainedActorDeviceSigningKey(
		context.Context,
		federationdelivery.Transaction,
		string,
		string,
		string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
}

type actorSigningKeyResolver struct {
	localStationID string
}

func (r actorSigningKeyResolver) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	instance := server.GetOptions().SubserverInstances["actor_identity"]
	provider, ok := instance.(actorSigningKeyCapability)
	if !ok || provider == nil {
		return nil, domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.actor_signing_key.resolve",
			"actor_identity",
			"canonical Actor Identity capability is unavailable",
		)
	}
	return provider.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		transaction,
		strings.TrimSpace(actorPTID),
		r.localStationID,
		strings.TrimSpace(deviceID),
		strings.TrimSpace(signingKeyID),
	)
}

func (actorSigningKeyResolver) ResolveRetainedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	instance := server.GetOptions().SubserverInstances["actor_identity"]
	provider, ok := instance.(actorSigningKeyCapability)
	if !ok || provider == nil {
		return nil, domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.actor_signing_key.resolve_retained",
			"actor_identity",
			"canonical Actor Identity capability is unavailable",
		)
	}
	return provider.ResolveRetainedActorDeviceSigningKey(
		ctx,
		transaction,
		strings.TrimSpace(actorPTID),
		strings.TrimSpace(deviceID),
		strings.TrimSpace(signingKeyID),
	)
}

type actorHomeStationDirectory struct{}

func (actorHomeStationDirectory) ResolveActorHomeStationPeerID(
	ctx context.Context,
	actorPTID string,
) (string, error) {
	instance := server.GetOptions().SubserverInstances["actor_identity"]
	provider, ok := instance.(actorHomeStationCapability)
	if !ok || provider == nil {
		return "", domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.actor_home_station.resolve",
			"actor_identity",
			"canonical Actor Identity capability is unavailable",
		)
	}
	homeStationID, err := provider.ResolveActorHomeStationPeerID(
		ctx,
		strings.TrimSpace(actorPTID),
	)
	if err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeDependency,
			"key_exchange.actor_home_station.resolve",
			fmt.Errorf("resolve Actor Home Station: %w", err),
		)
	}
	return strings.TrimSpace(homeStationID), nil
}

func newActorDeviceDirectory(db *gorm.DB) *actorDeviceDirectory {
	return &actorDeviceDirectory{store: touchactor.NewDeviceStore(db)}
}

func (d *actorDeviceDirectory) ResolveActiveDevice(
	ctx context.Context,
	endpoint domain.Endpoint,
) (domain.DeviceRoute, error) {
	if err := endpoint.Validate("key_exchange.device_directory.resolve"); err != nil {
		return domain.DeviceRoute{}, err
	}
	routes, err := d.ListActiveDevices(ctx, endpoint.ActorPTID)
	if err != nil {
		return domain.DeviceRoute{}, err
	}
	for _, route := range routes {
		if route.Endpoint == endpoint {
			return route, nil
		}
	}

	return domain.DeviceRoute{}, domain.NewError(
		domain.ErrorCodeNotFound,
		"key_exchange.device_directory.resolve",
		"device",
		"is not an active verified actor device",
	)
}

func (d *actorDeviceDirectory) ListActiveDevices(
	ctx context.Context,
	actorPTID string,
) ([]domain.DeviceRoute, error) {
	records, err := d.store.ListActive(ctx, strings.TrimSpace(actorPTID))
	if err != nil {
		return nil, domain.WrapError(
			domain.ErrorCodeDependency,
			"key_exchange.device_directory.list",
			err,
		)
	}
	routes := make([]domain.DeviceRoute, 0, len(records))
	for _, record := range records {
		active, err := d.store.IsVerifiedActive(
			ctx,
			record.Ptid,
			record.DeviceID,
		)
		if err != nil {
			return nil, domain.WrapError(
				domain.ErrorCodeDependency,
				"key_exchange.device_directory.verify",
				err,
			)
		}
		if !active {
			continue
		}
		route := domain.DeviceRoute{
			Endpoint: domain.Endpoint{
				ActorPTID: record.Ptid,
				DeviceID:  record.DeviceID,
			},
			HomeStationID: strings.TrimSpace(record.HomeStationPeerID),
		}
		if err := route.Validate("key_exchange.device_directory.list"); err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}

	return routes, nil
}

type canonicalDeviceInbox struct {
	repository *deliveryinfra.Repository
	clock      systemClock
}

func newCanonicalDeviceInbox(
	db *gorm.DB,
	clock systemClock,
) (*canonicalDeviceInbox, error) {
	repository, err := deliveryinfra.NewRepository(
		db,
		deliveryapp.QueueLimits{
			MaxUnackedItems: keyExchangeQueueMaxItems,
			MaxUnackedBytes: keyExchangeQueueMaxBytes,
		},
	)
	if err != nil {
		return nil, err
	}
	if err := repository.AutoMigrate(); err != nil {
		return nil, err
	}

	return &canonicalDeviceInbox{
		repository: repository,
		clock:      clock,
	}, nil
}

func (p *canonicalDeviceInbox) EnqueueDirectKeyExchange(
	ctx context.Context,
	envelope domain.DirectKeyExchangeEnvelope,
) (string, error) {
	request, _, err := directKeyExchangeDelivery(envelope, p.clock.Now())
	if err != nil {
		return "", err
	}
	item, err := p.repository.Enqueue(ctx, request)
	if err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeDependency,
			"key_exchange.device_inbox.enqueue",
			err,
		)
	}

	return item.ItemID, nil
}

type canonicalFederationPort struct {
	outbox         *federationdelivery.GORMRepository
	keys           *authfed.KeyCache
	client         *http.Client
	resolver       federationruntime.StationURLResolver
	relay          federationruntime.RelayAccess
	clock          systemClock
	localStationID string
}

func newCanonicalFederationPort(
	ctx context.Context,
	db *gorm.DB,
	keys *authfed.KeyCache,
	clock systemClock,
	localStationID string,
) (*canonicalFederationPort, error) {
	outbox, err := federationdelivery.NewGORMRepository(db, clock)
	if err != nil {
		return nil, err
	}
	if err := outbox.Migrate(ctx); err != nil {
		return nil, err
	}

	return &canonicalFederationPort{
		outbox:         outbox,
		keys:           keys,
		client:         &http.Client{Timeout: keyExchangeFederationRequestTimeout},
		relay:          federationruntime.LiveRelayAccess{},
		clock:          clock,
		localStationID: localStationID,
	}, nil
}

func (p *canonicalFederationPort) EnqueueDirectKeyExchange(
	ctx context.Context,
	targetStationID string,
	envelope domain.DirectKeyExchangeEnvelope,
) (string, error) {
	_, item, err := directKeyExchangeDelivery(envelope, p.clock.Now())
	if err != nil {
		return "", err
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(item)
	if err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.federation.encode_device_delivery",
			err,
		)
	}
	key, err := p.keys.Get(ctx)
	if err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeDependency,
			"key_exchange.federation.load_signing_key",
			err,
		)
	}
	signer, err := newStationSigner(key)
	if err != nil {
		return "", err
	}
	now := p.clock.Now()
	frameID := stableHexIdentifier(
		p.localStationID,
		targetStationID,
		envelope.EnvelopeID,
	)
	frame := &federationdelivery.Frame{
		FormatVersion:       federationdelivery.CurrentFormatVersion,
		FrameId:             "key-exchange-frame:" + frameID,
		SourceStationPeerId: p.localStationID,
		TargetStationPeerId: strings.TrimSpace(targetStationID),
		IdempotencyKey:      envelope.IdempotencyKey,
		PayloadKind: federationmodel.
			FederatedDomainPayloadKind_FEDERATED_DOMAIN_PAYLOAD_KIND_CONVERSATION_DEVICE_DELIVERY,
		PayloadId:     envelope.EnvelopeID,
		OrderingKey:   "key-exchange-dkx:" + envelope.Recipient.Key(),
		OpaquePayload: payload,
		IssuedAt:      timestamppb.New(now),
		ExpiresAt:     timestamppb.New(now.Add(keyExchangeFrameLifetime)),
	}
	if err := federationdelivery.SignFrame(
		ctx,
		frame,
		federationdelivery.DefaultFramePolicy(targetStationID),
		signer,
	); err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeDependency,
			"key_exchange.federation.sign_device_delivery",
			err,
		)
	}
	if _, err := p.outbox.Enqueue(ctx, frame, now); err != nil {
		return "", domain.WrapError(
			domain.ErrorCodeDependency,
			"key_exchange.federation.enqueue_device_delivery",
			err,
		)
	}

	return envelope.EnvelopeID, nil
}

func directKeyExchangeDelivery(
	envelope domain.DirectKeyExchangeEnvelope,
	createdAt time.Time,
) (deliveryapp.EnqueueRequest, *chatmodel.DurableDeviceInboxItem, error) {
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&kemodel.DirectKeyExchangeDelivery{
			EnvelopeId: envelope.EnvelopeID,
			Sender: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: envelope.Sender.ActorPTID,
				},
				DeviceId: envelope.Sender.DeviceID,
			},
			Recipient: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: envelope.Recipient.ActorPTID,
				},
				DeviceId: envelope.Recipient.DeviceID,
			},
			RecipientHomeStationPeerId: envelope.RecipientHomeStation,
			SessionId:                  envelope.SessionID,
			Kind: kemodel.DirectKeyExchangePayloadKind(
				envelope.Kind,
			),
			OpaqueKeyMaterial: append(
				[]byte(nil),
				envelope.OpaqueKeyMaterial...,
			),
			ConversationId: envelope.ConversationID,
			IdempotencyKey: envelope.IdempotencyKey,
		},
	)
	if err != nil {
		return deliveryapp.EnqueueRequest{}, nil, domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.delivery.encode_envelope",
			err,
		)
	}
	recipient, err := valueobject.NewEndpoint(
		envelope.Recipient.ActorPTID,
		envelope.Recipient.DeviceID,
	)
	if err != nil {
		return deliveryapp.EnqueueRequest{}, nil, domain.WrapError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.delivery.recipient",
			err,
		)
	}
	conversationID, err := valueobject.NewConversationID(
		envelope.ConversationID,
	)
	if err != nil {
		return deliveryapp.EnqueueRequest{}, nil, domain.WrapError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.delivery.conversation",
			err,
		)
	}
	eventID, err := valueobject.NewEventID(envelope.EnvelopeID)
	if err != nil {
		return deliveryapp.EnqueueRequest{}, nil, domain.WrapError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.delivery.event",
			err,
		)
	}
	payloadHash := valueobject.HashBytes(payloadBytes)
	request := deliveryapp.EnqueueRequest{
		ItemID:         envelope.EnvelopeID,
		Recipient:      recipient,
		EventID:        eventID,
		EventSequence:  valueobject.Sequence(envelope.Kind),
		ConversationID: conversationID,
		IdempotencyKey: envelope.IdempotencyKey,
		PayloadType:    deliveryapp.PayloadTypeDirectSessionInit,
		OpaquePayload:  payloadBytes,
		PayloadHash:    payloadHash,
		CreatedAt:      createdAt.UTC(),
	}
	item := &chatmodel.DurableDeviceInboxItem{
		ItemId: envelope.EnvelopeID,
		Recipient: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: envelope.Recipient.ActorPTID,
			},
			DeviceId: envelope.Recipient.DeviceID,
		},
		EventId:        envelope.EnvelopeID,
		ConversationId: envelope.ConversationID,
		IdempotencyKey: envelope.IdempotencyKey,
		PayloadType: chatmodel.
			DeviceInboxPayloadType_DEVICE_INBOX_PAYLOAD_TYPE_DIRECT_SESSION_INIT,
		OpaquePayload: payloadBytes,
		PayloadSha256: payloadHash.Bytes(),
		FirstQueuedAt: timestamppb.New(createdAt.UTC()),
	}

	return request, item, nil
}

type stationSigner struct {
	keyID      string
	privateKey ed25519.PrivateKey
}

func newStationSigner(key *authfed.LocalKey) (*stationSigner, error) {
	if key == nil ||
		strings.TrimSpace(key.Kid) == "" ||
		len(key.Priv) != ed25519.PrivateKeySize {
		return nil, domain.NewError(
			domain.ErrorCodeDependency,
			"key_exchange.federation.new_signer",
			"station_key",
			"is unavailable",
		)
	}

	return &stationSigner{
		keyID:      key.Kid,
		privateKey: append(ed25519.PrivateKey(nil), key.Priv...),
	}, nil
}

func (s *stationSigner) KeyID() string {
	if s == nil {
		return ""
	}

	return s.keyID
}

func (s *stationSigner) Sign(
	_ context.Context,
	canonical []byte,
) ([]byte, error) {
	if s == nil || len(s.privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("Key Exchange Federation signing key is unavailable")
	}

	return ed25519.Sign(s.privateKey, canonical), nil
}

func stableHexIdentifier(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(part))
	}

	return hex.EncodeToString(hash.Sum(nil))
}
