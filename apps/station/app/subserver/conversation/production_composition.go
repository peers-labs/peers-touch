package conversation

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	attachmentapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/attachment"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	deliveryapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	attachmentinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/attachment"
	deliveryinfra "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	keyexchangedomain "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	sharedfederation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

const (
	defaultProductionQueueMaxItems           = 10_000
	defaultProductionQueueMaxBytes           = 64 << 20
	defaultProductionQueueLease              = 30 * time.Second
	defaultProductionQueueBatch              = 100
	defaultProductionQueueAttempts           = 8
	defaultProductionQueueRetryInitial       = time.Second
	defaultProductionQueueRetryMaximum       = time.Minute
	defaultProductionAttachmentUploadTTL     = 24 * time.Hour
	defaultProductionAttachmentObjectTTL     = 24 * time.Hour
	defaultProductionAttachmentVerifyLease   = time.Hour
	defaultProductionAttachmentCleanupLease  = 5 * time.Minute
	defaultProductionAttachmentActive        = 4
	defaultProductionAttachmentParts         = 4
	defaultProductionAttachmentCleanupBatch  = 100
	defaultProductionTypingPulseInterval     = 3 * time.Second
	defaultProductionTypingTTL               = 10 * time.Second
	defaultProductionTypingClockSkew         = time.Minute
	defaultProductionTypingPulseCapacity     = 10_000
	defaultProductionFederationFrameLifetime = 24 * time.Hour
)

// ProductionRealtime owns the process-local notifications emitted only after
// canonical durable state commits.
type ProductionRealtime interface {
	ports.PostCommitPublisher
	interactionapp.TypingPublisher
	interactionapp.DeliveryPublisher
}

// ProductionFederationRuntime is the narrow shared-runtime surface needed by
// Conversation. Its resolver is intentionally lazy because Conversation is
// initialized before Federation.
type ProductionFederationRuntime interface {
	RegisterReceivers(sharedfederation.ReceiverRegistrar) error
	CallPeer(context.Context, sharedfederation.PeerCall) error
	OpenPeerStream(
		context.Context,
		sharedfederation.PeerStreamCall,
	) (*sharedfederation.PeerStreamResponse, error)
	VerifyPeerSignature(context.Context, string, string, []byte, []byte) error
	Signer() federationdelivery.Signer
	LocalStationPeerID() string
}

// ProductionActorCapabilities groups Actor-owned peer capabilities without
// giving Conversation ownership of Actor identity state.
type ProductionActorCapabilities interface {
	conversationfederation.EndpointManifestPort
	conversationfederation.VerifiedActorDeviceKeyResolver
	ResolveActorHomeStationPeerID(context.Context, string) (string, error)
	ValidateEndpointManifest(
		*actormodel.ActorEndpointManifest,
		string,
		string,
		time.Time,
	) error
	AcceptVerifiedEndpointManifest(
		context.Context,
		*actormodel.ActorEndpointManifest,
	) error
}

// ProductionKeyExchangeCapabilities is the Key Exchange-owned peer claim edge.
type ProductionKeyExchangeCapabilities interface {
	conversationfederation.MLSKeyPackageClaimPort
	ReserveMLSKeyPackageForVerifiedRoute(
		context.Context,
		string,
		string,
		keyexchangedomain.Endpoint,
		string,
		time.Time,
	) (keyexchangedomain.MLSKeyPackageReservation, error)
}

type ProductionFederationResolver func() (ProductionFederationRuntime, error)
type ProductionActorResolver func() (ProductionActorCapabilities, error)
type ProductionKeyExchangeResolver func() (ProductionKeyExchangeCapabilities, error)

// ProductionCompositionConfig contains process policy and shared owner
// resolvers. Resolvers are retained without invocation during construction.
type ProductionCompositionConfig struct {
	Database       *gorm.DB
	LocalStationID valueobject.StationID
	BlobBackend    storage.Backend
	Realtime       ProductionRealtime
	Clock          productionClock
	IDs            productionIDGenerator

	DeviceInboxLimits   deliveryapp.QueueLimits
	DeviceInboxPolicy   deliveryapp.Policy
	AttachmentPolicy    attachmentapp.Policy
	InteractionPolicy   interactionapp.Policy
	TypingPulseCapacity int

	FederationFrameLifetime time.Duration
	ResolveFederation       ProductionFederationResolver
	ResolveActor            ProductionActorResolver
	ResolveKeyExchange      ProductionKeyExchangeResolver
}

// ProductionSharedDependencies exposes the resolved owner services to the
// later Conversation subserver cutover without introducing a second owner.
type ProductionSharedDependencies struct {
	Federation  ProductionFederationRuntime
	Actor       ProductionActorCapabilities
	KeyExchange ProductionKeyExchangeCapabilities
}

// ProductionComposition owns one canonical Conversation object graph over the
// shared Station RDS. It owns neither the RDS lifecycle nor sibling services.
type ProductionComposition struct {
	UnitOfWork *persistence.UnitOfWork

	CommandService     *command.Service
	QueryService       *query.Service
	DeliveryService    *deliveryapp.Service
	AttachmentService  *attachmentapp.Service
	InteractionService *interactionapp.Service

	DeviceInboxHandler *conversationhttp.DeviceInboxHandler
	AttachmentHandler  *conversationhttp.AttachmentHandler
	InteractionHandler *conversationhttp.InteractionHandler

	DeliveryRepository   *deliveryinfra.Repository
	AttachmentRepository *attachmentinfra.Repository
	AttachmentBlobStore  *attachmentinfra.BlobStore

	FederationRuntime ProductionFederationResolver
	ActorCapabilities ProductionActorCapabilities
	KeyExchange       ProductionKeyExchangeCapabilities

	database               *gorm.DB
	localStation           valueobject.StationID
	clock                  productionClock
	deviceInboxLimits      deliveryapp.QueueLimits
	transactionalAdapters  *ProductionTransactionalAdapterFactory
	federationSender       *conversationfederation.Sender
	shared                 *productionSharedDependencies
	federationMu           sync.Mutex
	federationRegistered   bool
	federationCapabilities *conversationfederation.CapabilityAdapter
}

type productionClock interface {
	Now() time.Time
}

type productionIDGenerator interface {
	ports.IDGenerator
	attachmentapp.IDGenerator
}

type productionSystemClock struct{}

func (productionSystemClock) Now() time.Time {
	return time.Now().UTC()
}

type productionUUIDGenerator struct{}

func (productionUUIDGenerator) NewPlanID() valueobject.PlanID {
	return valueobject.PlanID(uuid.NewString())
}

func (productionUUIDGenerator) NewID() string {
	return uuid.NewString()
}

// DefaultProductionCompositionConfig supplies bounded v1 production policy.
// Callers still provide the shared RDS, blob backend, and realtime owner.
func DefaultProductionCompositionConfig(
	database *gorm.DB,
	localStationID valueobject.StationID,
	blobBackend storage.Backend,
	realtime ProductionRealtime,
) ProductionCompositionConfig {
	return ProductionCompositionConfig{
		Database:       database,
		LocalStationID: localStationID,
		BlobBackend:    blobBackend,
		Realtime:       realtime,
		Clock:          productionSystemClock{},
		IDs:            productionUUIDGenerator{},
		DeviceInboxLimits: deliveryapp.QueueLimits{
			MaxUnackedItems: defaultProductionQueueMaxItems,
			MaxUnackedBytes: defaultProductionQueueMaxBytes,
		},
		DeviceInboxPolicy: deliveryapp.Policy{
			LeaseDuration:  defaultProductionQueueLease,
			MaxBatchSize:   defaultProductionQueueBatch,
			MaxAttempts:    defaultProductionQueueAttempts,
			BaseRetryDelay: defaultProductionQueueRetryInitial,
			MaxRetryDelay:  defaultProductionQueueRetryMaximum,
		},
		AttachmentPolicy: attachmentapp.Policy{
			UploadTTL:               defaultProductionAttachmentUploadTTL,
			UnattachedObjectTTL:     defaultProductionAttachmentObjectTTL,
			VerificationLeaseTTL:    defaultProductionAttachmentVerifyLease,
			CleanupLeaseTTL:         defaultProductionAttachmentCleanupLease,
			MaximumActiveUploads:    defaultProductionAttachmentActive,
			MaximumConcurrentParts:  defaultProductionAttachmentParts,
			MaximumCleanupBatchSize: defaultProductionAttachmentCleanupBatch,
		},
		InteractionPolicy: interactionapp.Policy{
			MinimumPulseInterval:   defaultProductionTypingPulseInterval,
			MaximumTypingTTL:       defaultProductionTypingTTL,
			MaximumFutureClockSkew: defaultProductionTypingClockSkew,
		},
		TypingPulseCapacity:     defaultProductionTypingPulseCapacity,
		FederationFrameLifetime: defaultProductionFederationFrameLifetime,
		ResolveFederation:       resolveProductionFederationRuntime,
		ResolveActor:            resolveProductionActorCapabilities,
		ResolveKeyExchange:      resolveProductionKeyExchangeCapabilities,
	}
}

// NewProductionComposition migrates only canonical Conversation-owned tables
// and constructs every production service once over the supplied shared RDS.
func NewProductionComposition(
	ctx context.Context,
	config ProductionCompositionConfig,
) (*ProductionComposition, error) {
	if err := validateProductionCompositionConfig(ctx, config); err != nil {
		return nil, err
	}
	if err := migrateProductionConversationSchema(ctx, config.Database); err != nil {
		return nil, err
	}

	shared := newProductionSharedDependencies(config)
	adapterFactory, err := NewProductionTransactionalAdapterFactory(
		ProductionTransactionalAdapterFactoryConfig{
			LocalStationID:          config.LocalStationID,
			DeviceInboxLimits:       config.DeviceInboxLimits,
			FederationSigner:        &productionLazyFederationSigner{shared: shared},
			Clock:                   config.Clock,
			FederationFrameLifetime: config.FederationFrameLifetime,
			KeyExchange:             productionLazyKeyExchangeCapabilities{shared: shared},
		},
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation transactional adapters: %w", err)
	}

	eventSealer := conversationhttp.ProtobufEventSealer{}
	unitOfWork, err := persistence.NewUnitOfWork(
		config.Database,
		adapterFactory,
		eventSealer,
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation unit of work: %w", err)
	}
	commandService, err := command.NewService(
		unitOfWork,
		config.LocalStationID,
		config.Clock,
		config.IDs,
		conversationhttp.ProtobufConversationStateEncoder{},
		conversationhttp.ProtobufDeviceEventEncoder{},
		conversationhttp.ProtobufReadCursorEncoder{},
		conversationhttp.ProtobufLeaveIntentSigningEncoder{},
		conversationhttp.ProtobufCommandProposalSigningEncoder{},
		config.Realtime,
		eventSealer,
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation command service: %w", err)
	}
	queryService, err := query.NewService(unitOfWork)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation query service: %w", err)
	}

	identityDirectory := &productionIdentityDirectory{db: config.Database}
	deliveryRepository, err := deliveryinfra.NewRepository(
		config.Database,
		config.DeviceInboxLimits,
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation Delivery repository: %w", err)
	}
	deliveryService, err := deliveryapp.NewService(
		deliveryRepository,
		identityDirectory,
		config.DeviceInboxPolicy,
		config.Clock,
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation Delivery service: %w", err)
	}
	deviceInboxHandler, err := conversationhttp.NewDeviceInboxHandler(deliveryService)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation Device Inbox handler: %w", err)
	}

	attachmentRepository, err := attachmentinfra.NewRepository(config.Database)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation attachment repository: %w", err)
	}
	attachmentBlobStore, err := attachmentinfra.NewBlobStore(config.BlobBackend)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation attachment blob store: %w", err)
	}
	attachmentService, err := attachmentapp.NewService(
		attachmentRepository,
		attachmentBlobStore,
		queryService,
		identityDirectory,
		config.LocalStationID,
		config.AttachmentPolicy,
		config.Clock,
		config.IDs,
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation attachment service: %w", err)
	}
	attachmentHandler, err := conversationhttp.NewAttachmentHandler(attachmentService)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation attachment handler: %w", err)
	}

	receiptRecorder, err := deliveryinfra.NewReceiptRecorder(config.Database)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation delivery receipt recorder: %w", err)
	}
	pulseLedger, err := interactionapp.NewMemoryTypingPulseLedger(
		config.TypingPulseCapacity,
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation typing pulse ledger: %w", err)
	}
	interactionService, err := interactionapp.NewService(
		queryService,
		productionInteractionDeviceDirectory{identity: identityDirectory},
		commandService,
		receiptRecorder,
		config.Realtime,
		config.Realtime,
		pulseLedger,
		config.Clock,
		config.InteractionPolicy,
	)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation interaction service: %w", err)
	}
	interactionHandler, err := conversationhttp.NewInteractionHandler(interactionService)
	if err != nil {
		return nil, fmt.Errorf("compose Conversation interaction handler: %w", err)
	}

	return &ProductionComposition{
		UnitOfWork:            unitOfWork,
		CommandService:        commandService,
		QueryService:          queryService,
		DeliveryService:       deliveryService,
		AttachmentService:     attachmentService,
		InteractionService:    interactionService,
		DeviceInboxHandler:    deviceInboxHandler,
		AttachmentHandler:     attachmentHandler,
		InteractionHandler:    interactionHandler,
		DeliveryRepository:    deliveryRepository,
		AttachmentRepository:  attachmentRepository,
		AttachmentBlobStore:   attachmentBlobStore,
		FederationRuntime:     shared.federation.get,
		ActorCapabilities:     productionLazyActorCapabilities{shared: shared},
		KeyExchange:           productionLazyKeyExchangeCapabilities{shared: shared},
		database:              config.Database,
		localStation:          config.LocalStationID,
		clock:                 config.Clock,
		deviceInboxLimits:     config.DeviceInboxLimits,
		transactionalAdapters: adapterFactory,
		federationSender:      adapterFactory.federationSender,
		shared:                shared,
	}, nil
}

// ResolveSharedDependencies resolves and caches sibling owners only when the
// running subserver needs their peer-facing capabilities.
func (c *ProductionComposition) ResolveSharedDependencies() (
	ProductionSharedDependencies,
	error,
) {
	if c == nil || c.shared == nil {
		return ProductionSharedDependencies{}, fmt.Errorf(
			"resolve Conversation production dependencies: composition is nil",
		)
	}
	return c.shared.resolve()
}

func validateProductionCompositionConfig(
	ctx context.Context,
	config ProductionCompositionConfig,
) error {
	if ctx == nil {
		return fmt.Errorf("compose Conversation production root: context is required")
	}
	localStationID := string(config.LocalStationID)
	if config.Database == nil ||
		strings.TrimSpace(localStationID) == "" ||
		localStationID != strings.TrimSpace(localStationID) ||
		isNilProductionDependency(config.BlobBackend) ||
		isNilProductionDependency(config.Realtime) ||
		isNilProductionDependency(config.Clock) ||
		isNilProductionDependency(config.IDs) ||
		config.ResolveFederation == nil ||
		config.ResolveActor == nil ||
		config.ResolveKeyExchange == nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_composition.validate",
			"dependencies",
			"shared RDS, local Station, blob storage, realtime, clock, IDs, and lazy owner resolvers are required",
		)
	}

	return nil
}

func migrateProductionConversationSchema(
	ctx context.Context,
	database *gorm.DB,
) error {
	err := database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return tx.AutoMigrate(
			&persistence.ConversationModel{},
			&persistence.ConversationMemberModel{},
			&persistence.ConversationMemberDeviceModel{},
			&persistence.ConversationEventModel{},
			&persistence.ConversationCommandReceiptModel{},
			&persistence.ConversationAuthorityPlanModel{},
			&persistence.ConversationMemberSettingsModel{},
			&persistence.ConversationReadCursorModel{},
			&persistence.ConversationLeaveIntentModel{},
			&persistence.ConversationFollowerHeadModel{},
			&persistence.ConversationFollowerStateModel{},
			&persistence.ConversationFollowerPendingEventModel{},
			&persistence.ConversationFollowerMemberModel{},
			&deliveryinfra.DeviceQueueLaneModel{},
			&deliveryinfra.DeviceQueueItemModel{},
			&deliveryinfra.AuthorityDeliveryCommitmentModel{},
			&deliveryinfra.AuthorityDeliveryReceiptModel{},
			&attachmentinfra.UploadModel{},
			&attachmentinfra.UploadPartModel{},
			&attachmentinfra.ObjectModel{},
			&attachmentinfra.GrantModel{},
			&attachmentinfra.AuditModel{},
		)
	})
	if err != nil {
		return fmt.Errorf("migrate canonical Conversation production schema: %w", err)
	}

	return nil
}

type productionInteractionDeviceDirectory struct {
	identity ports.IdentityDirectory
}

func (d productionInteractionDeviceDirectory) IsActive(
	ctx context.Context,
	endpoint valueobject.Endpoint,
) (bool, error) {
	return d.identity.IsActive(ctx, endpoint)
}

func (d productionInteractionDeviceDirectory) ListActiveEndpoints(
	ctx context.Context,
	actors []valueobject.PTID,
) ([]interactionapp.EndpointRoute, error) {
	routes, err := d.identity.ListActiveEndpoints(ctx, actors)
	if err != nil {
		return nil, err
	}
	mapped := make([]interactionapp.EndpointRoute, 0, len(routes))
	for _, route := range routes {
		mapped = append(mapped, interactionapp.EndpointRoute{
			Endpoint:    route.Endpoint,
			HomeStation: route.HomeStation,
		})
	}

	return mapped, nil
}

type productionSharedDependencies struct {
	federation  *productionLazyDependency[ProductionFederationRuntime]
	actor       *productionLazyDependency[ProductionActorCapabilities]
	keyExchange *productionLazyDependency[ProductionKeyExchangeCapabilities]
}

func newProductionSharedDependencies(
	config ProductionCompositionConfig,
) *productionSharedDependencies {
	localStationID := string(config.LocalStationID)

	return &productionSharedDependencies{
		federation: newProductionLazyDependency(
			"Federation",
			func() (ProductionFederationRuntime, error) {
				runtime, err := config.ResolveFederation()
				if err != nil {
					return nil, err
				}
				if runtime.LocalStationPeerID() != localStationID ||
					isNilProductionDependency(runtime.Signer()) {
					return nil, fmt.Errorf(
						"shared Federation runtime does not match local Station %q",
						localStationID,
					)
				}

				return runtime, nil
			},
		),
		actor: newProductionLazyDependency(
			"Actor",
			config.ResolveActor,
		),
		keyExchange: newProductionLazyDependency(
			"Key Exchange",
			config.ResolveKeyExchange,
		),
	}
}

func (d *productionSharedDependencies) resolve() (
	ProductionSharedDependencies,
	error,
) {
	federation, err := d.federation.get()
	if err != nil {
		return ProductionSharedDependencies{}, err
	}
	actor, err := d.actor.get()
	if err != nil {
		return ProductionSharedDependencies{}, err
	}
	keyExchange, err := d.keyExchange.get()
	if err != nil {
		return ProductionSharedDependencies{}, err
	}

	return ProductionSharedDependencies{
		Federation:  federation,
		Actor:       actor,
		KeyExchange: keyExchange,
	}, nil
}

type productionLazyDependency[T any] struct {
	mu       sync.Mutex
	name     string
	resolver func() (T, error)
	value    T
	resolved bool
}

func newProductionLazyDependency[T any](
	name string,
	resolver func() (T, error),
) *productionLazyDependency[T] {
	return &productionLazyDependency[T]{name: name, resolver: resolver}
}

func (d *productionLazyDependency[T]) get() (T, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.resolved {
		return d.value, nil
	}
	value, err := d.resolver()
	if err != nil {
		var zero T

		return zero, fmt.Errorf(
			"resolve Conversation %s dependency: %w",
			d.name,
			err,
		)
	}
	if isNilProductionDependency(value) {
		var zero T

		return zero, fmt.Errorf(
			"resolve Conversation %s dependency: provider is unavailable",
			d.name,
		)
	}
	d.value = value
	d.resolved = true

	return value, nil
}

type productionLazyFederationSigner struct {
	shared *productionSharedDependencies
}

func (s *productionLazyFederationSigner) KeyID() string {
	runtime, err := s.shared.federation.get()
	if err != nil {
		return ""
	}

	return runtime.Signer().KeyID()
}

func (s *productionLazyFederationSigner) Sign(
	ctx context.Context,
	canonical []byte,
) ([]byte, error) {
	runtime, err := s.shared.federation.get()
	if err != nil {
		return nil, err
	}

	return runtime.Signer().Sign(ctx, canonical)
}

type productionLazyActorCapabilities struct {
	shared *productionSharedDependencies
}

func (p productionLazyActorCapabilities) ResolveActorHomeStationPeerID(
	ctx context.Context,
	actorPTID string,
) (string, error) {
	actor, err := p.shared.actor.get()
	if err != nil {
		return "", err
	}

	return actor.ResolveActorHomeStationPeerID(ctx, actorPTID)
}

func (p productionLazyActorCapabilities) ValidateEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	expectedActorPTID string,
	expectedHomeStationPeerID string,
	now time.Time,
) error {
	actor, err := p.shared.actor.get()
	if err != nil {
		return err
	}

	return actor.ValidateEndpointManifest(
		manifest,
		expectedActorPTID,
		expectedHomeStationPeerID,
		now,
	)
}

func (p productionLazyActorCapabilities) AcceptVerifiedEndpointManifest(
	ctx context.Context,
	manifest *actormodel.ActorEndpointManifest,
) error {
	actor, err := p.shared.actor.get()
	if err != nil {
		return err
	}

	return actor.AcceptVerifiedEndpointManifest(ctx, manifest)
}

func (p productionLazyActorCapabilities) GetEndpointManifest(
	ctx context.Context,
	sourceStationPeerID string,
	request *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	actor, err := p.shared.actor.get()
	if err != nil {
		return nil, err
	}

	return actor.GetEndpointManifest(ctx, sourceStationPeerID, request)
}

func (p productionLazyActorCapabilities) ResolveVerifiedActorDeviceSigningKey(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	actorPTID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	actor, err := p.shared.actor.get()
	if err != nil {
		return nil, err
	}

	return actor.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		transaction,
		actorPTID,
		deviceID,
		signingKeyID,
	)
}

type productionLazyKeyExchangeCapabilities struct {
	shared *productionSharedDependencies
}

func (p productionLazyKeyExchangeCapabilities) ReserveMLSKeyPackageForVerifiedRoute(
	ctx context.Context,
	requestID string,
	authorityPlanID string,
	target keyexchangedomain.Endpoint,
	homeStationID string,
	expiresAt time.Time,
) (keyexchangedomain.MLSKeyPackageReservation, error) {
	keyExchange, err := p.shared.keyExchange.get()
	if err != nil {
		return keyexchangedomain.MLSKeyPackageReservation{}, err
	}

	return keyExchange.ReserveMLSKeyPackageForVerifiedRoute(
		ctx,
		requestID,
		authorityPlanID,
		target,
		homeStationID,
		expiresAt,
	)
}

func (p productionLazyKeyExchangeCapabilities) ClaimMLSKeyPackage(
	ctx context.Context,
	sourceAuthorityStationPeerID string,
	request *keyexchangemodel.ClaimMlsKeyPackageRequest,
) (*keyexchangemodel.ClaimMlsKeyPackageResponse, error) {
	keyExchange, err := p.shared.keyExchange.get()
	if err != nil {
		return nil, err
	}

	return keyExchange.ClaimMLSKeyPackage(
		ctx,
		sourceAuthorityStationPeerID,
		request,
	)
}

func resolveProductionFederationRuntime() (
	ProductionFederationRuntime,
	error,
) {
	instance := server.GetOptions().SubserverInstances["federation"]
	provider, ok := instance.(sharedfederation.RuntimeProvider)
	if !ok || isNilProductionDependency(provider) {
		return nil, fmt.Errorf(
			"shared Federation runtime provider is unavailable",
		)
	}
	runtime := provider.FederationDeliveryRuntime()
	if isNilProductionDependency(runtime) {
		return nil, fmt.Errorf(
			"shared Federation runtime is unavailable",
		)
	}

	return runtime, nil
}

func resolveProductionActorCapabilities() (
	ProductionActorCapabilities,
	error,
) {
	instance := server.GetOptions().SubserverInstances["actor_identity"]
	actor, ok := instance.(ProductionActorCapabilities)
	if !ok || isNilProductionDependency(actor) {
		return nil, fmt.Errorf(
			"canonical Actor capability provider is unavailable",
		)
	}

	return actor, nil
}

func resolveProductionKeyExchangeCapabilities() (
	ProductionKeyExchangeCapabilities,
	error,
) {
	instance := server.GetOptions().SubserverInstances["key_exchange"]
	keyExchange, ok := instance.(ProductionKeyExchangeCapabilities)
	if !ok || isNilProductionDependency(keyExchange) {
		return nil, fmt.Errorf(
			"canonical Key Exchange capability provider is unavailable",
		)
	}

	return keyExchange, nil
}

func isNilProductionDependency(value any) bool {
	if value == nil {
		return true
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map,
		reflect.Pointer, reflect.Slice:
		return reflected.IsNil()
	default:
		return false
	}
}

var (
	_ productionClock                   = productionSystemClock{}
	_ productionIDGenerator             = productionUUIDGenerator{}
	_ federationdelivery.Signer         = (*productionLazyFederationSigner)(nil)
	_ interactionapp.DeviceDirectory    = productionInteractionDeviceDirectory{}
	_ ProductionActorCapabilities       = productionLazyActorCapabilities{}
	_ ProductionKeyExchangeCapabilities = productionLazyKeyExchangeCapabilities{}
)
