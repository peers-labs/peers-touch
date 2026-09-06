package conversationengine

import (
	"fmt"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/infrastructure"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/interface/http"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/worker"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"gorm.io/gorm"
)

type CompositionConfig struct {
	Database                     *gorm.DB
	Clock                        func() time.Time
	LocalStationID               string
	PeerKeys                     authfed.PeerKeyStore
	QueueLimits                  domain.QueueLimits
	QueuePolicy                  application.QueuePolicy
	FederationPolicy             application.FederationPolicy
	FollowerProjectionPolicy     application.FollowerProjectionPolicy
	FollowerReplayPolicy         application.FollowerReplayPolicy
	RecoveryPolicy               application.RecoveryPolicy
	AuthorityPlanPolicy          application.AuthorityPlanPolicy
	AttachmentPolicy             application.AttachmentPolicy
	AttachmentBlobStore          domain.AttachmentBlobStore
	FederationDispatcherID       string
	FederationDispatcherPolicy   worker.FederationDispatcherPolicy
	FederationTransport          worker.FederationTransport
	FederationStationURLResolver infrastructure.FederationStationURLResolver
	FederationRelay              infrastructure.FederationRelayAccess
	FederationPeerTrustResolver  domain.FederationPeerTrustResolver
}

// Composition wires the modern Conversation authority and its resource ports.
// Conversation remains the sole public Chat entry point.
type Composition struct {
	AuthorityService          *application.AuthorityService
	ConversationService       *application.ConversationService
	MembershipReader          *application.MembershipReader
	MemberSettingsService     *application.MemberSettingsService
	DeviceService             *application.DeviceService
	QueueService              *application.QueueService
	FederationService         *application.FederationService
	FollowerProjectionService *application.FollowerProjectionService
	FollowerReplayService     *application.FollowerReplayService
	EndpointManifestService   *application.EndpointManifestService
	RecoveryService           *application.RecoveryService
	AuthorityPlanService      *application.AuthorityPlanService
	AuthorityCommandForwarder *application.AuthorityCommandForwarder
	MlsKeyPackageClaimService *application.FederatedMlsKeyPackageClaimService
	AttachmentService         *application.AttachmentService
	TypingService             *application.TypingService
	ReceiptService            *application.ReceiptService

	CommandHandler             *httpinterface.CommandHandler
	DeviceHandler              *httpinterface.DeviceHandler
	QueueHandler               *httpinterface.QueueHandler
	FederationHandler          *httpinterface.FederationHandler
	FederationAuth             server.Wrapper
	FollowerReplayHandler      *httpinterface.FollowerReplayHandler
	FollowerReplayAuth         server.Wrapper
	EndpointManifestHandler    *httpinterface.EndpointManifestHandler
	EndpointManifestAuth       server.Wrapper
	AuthorityPrepareHandler    *httpinterface.AuthorityPrepareHandler
	AuthorityPrepareAuth       server.Wrapper
	AuthorityPrepareFetcher    *infrastructure.HTTPAuthorityPrepareFetcher
	MlsKeyPackageClaimHandler  *httpinterface.MlsKeyPackageClaimHandler
	MlsKeyPackageClaimAuth     server.Wrapper
	RemoteMlsKeyPackageClaimer *infrastructure.HTTPMlsKeyPackageClaimer
	AttachmentProxy            *infrastructure.HTTPAttachmentProxy
	AttachmentFederationAuth   server.Wrapper
	TypingHandler              *httpinterface.TypingHandler
	ReceiptHandler             *httpinterface.ReceiptHandler
	DeviceDirectory            domain.DeviceDirectory

	FederationDispatcher *worker.FederationDispatcher

	deviceRepository    *infrastructure.DeviceRepository
	authorityUnitOfWork *infrastructure.AuthorityUnitOfWork
	federationInbox     *infrastructure.FederationInboxUnitOfWork
	followerRepository  *infrastructure.FollowerRepository
	memberSettings      *infrastructure.MemberSettingsRepository
	federationOutbox    *infrastructure.FederationRepository
	recoveryRepository  *infrastructure.RecoveryRepository
	mlsClaimRepository  *infrastructure.FederatedMlsKeyPackageClaimStore
}

func NewComposition(config CompositionConfig) (*Composition, error) {
	if config.Database == nil ||
		config.Clock == nil ||
		config.LocalStationID == "" ||
		config.PeerKeys == nil ||
		config.AttachmentBlobStore == nil ||
		config.FederationTransport == nil ||
		config.FederationPeerTrustResolver == nil ||
		(config.FederationStationURLResolver == nil && config.FederationRelay == nil) {
		return nil, fmt.Errorf("messaging: composition dependencies are invalid")
	}
	authorityUnitOfWork, err := infrastructure.NewAuthorityUnitOfWork(
		config.Database,
		config.QueueLimits,
	)
	if err != nil {
		return nil, err
	}
	queueRepository, err := infrastructure.NewQueueRepository(
		config.Database,
		config.QueueLimits,
	)
	if err != nil {
		return nil, err
	}
	deviceDirectory := infrastructure.NewDeviceDirectory(config.Database)
	mlsClaimRepository, err := infrastructure.NewFederatedMlsKeyPackageClaimStore(
		config.Database,
	)
	if err != nil {
		return nil, err
	}
	deviceRepository, err := infrastructure.NewDeviceRepository(config.Database)
	if err != nil {
		return nil, err
	}
	deviceService, err := application.NewDeviceService(
		deviceRepository,
		config.LocalStationID,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	frameSigner, err := infrastructure.NewFederationFrameSigner(authfed.Singleton())
	if err != nil {
		return nil, err
	}
	endpointManifestRepository, err := infrastructure.NewEndpointManifestRepository(
		config.Database,
	)
	if err != nil {
		return nil, err
	}
	tokenMinter, err := infrastructure.NewPeerJWTFederationTokenMinter(
		authfed.Singleton(),
		config.LocalStationID,
	)
	if err != nil {
		return nil, err
	}
	remoteMlsKeyPackageClaimer, err := infrastructure.NewHTTPMlsKeyPackageClaimer(
		&http.Client{Timeout: 15 * time.Second},
		tokenMinter,
		config.FederationStationURLResolver,
		config.FederationRelay,
	)
	if err != nil {
		return nil, err
	}
	attachmentProxy, err := infrastructure.NewHTTPAttachmentProxy(
		&http.Client{},
		tokenMinter,
		config.FederationStationURLResolver,
		config.FederationRelay,
	)
	if err != nil {
		return nil, err
	}
	manifestFetcher, err := infrastructure.NewHTTPFederatedEndpointManifestFetcher(
		&http.Client{Timeout: 15 * time.Second},
		tokenMinter,
		config.FederationStationURLResolver,
		config.FederationRelay,
		config.PeerKeys,
		config.FederationPeerTrustResolver,
		endpointManifestRepository,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	endpointManifestService, err := application.NewEndpointManifestService(
		endpointManifestRepository,
		deviceDirectory,
		frameSigner,
		manifestFetcher,
		config.LocalStationID,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	authorityPrepareFetcher, err := infrastructure.NewHTTPAuthorityPrepareFetcher(
		&http.Client{Timeout: 15 * time.Second},
		tokenMinter,
		config.FederationStationURLResolver,
		config.FederationRelay,
		config.LocalStationID,
	)
	if err != nil {
		return nil, err
	}
	authorityService, err := application.NewAuthorityService(
		authorityUnitOfWork,
		config.LocalStationID,
		frameSigner,
		endpointManifestService,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	followerRepository, err := infrastructure.NewFollowerRepository(config.Database)
	if err != nil {
		return nil, err
	}
	membershipReader, err := application.NewMembershipReader(
		authorityUnitOfWork,
		followerRepository,
		config.LocalStationID,
	)
	if err != nil {
		return nil, err
	}
	memberSettingsRepository, err := infrastructure.NewMemberSettingsRepository(
		config.Database,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	memberSettingsService, err := application.NewMemberSettingsService(
		membershipReader,
		memberSettingsRepository,
	)
	if err != nil {
		return nil, err
	}
	conversationService, err := application.NewConversationService(
		authorityUnitOfWork,
		membershipReader,
		config.LocalStationID,
		frameSigner,
		endpointManifestService,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	authorityPlanService, err := application.NewAuthorityPlanService(
		authorityUnitOfWork,
		config.LocalStationID,
		endpointManifestService,
		remoteMlsKeyPackageClaimer,
		config.AuthorityPlanPolicy,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	mlsKeyPackageClaimService, err := application.NewFederatedMlsKeyPackageClaimService(
		mlsClaimRepository,
		deviceDirectory,
		config.LocalStationID,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	queueService, err := application.NewQueueService(
		queueRepository,
		deviceDirectory,
		config.QueuePolicy,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	mlsKeyPackageClaimHandler, err := httpinterface.NewMlsKeyPackageClaimHandler(
		mlsKeyPackageClaimService,
	)
	if err != nil {
		return nil, err
	}
	federationInbox := infrastructure.NewFederationInboxUnitOfWork(
		config.Database,
		config.QueueLimits,
	)
	followerReplaySource, err := infrastructure.NewFollowerReplayRepository(config.Database)
	if err != nil {
		return nil, err
	}
	followerReplayService, err := application.NewFollowerReplayService(
		followerReplaySource,
		frameSigner,
		config.LocalStationID,
		config.FollowerReplayPolicy,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	followerReplayClient, err := infrastructure.NewHTTPFollowerReplayClient(
		&http.Client{Timeout: 15 * time.Second},
		tokenMinter,
		config.FederationStationURLResolver,
		config.FederationRelay,
		config.PeerKeys,
		config.LocalStationID,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	followerProjectionService, err := application.NewFollowerProjectionService(
		federationInbox,
		followerRepository,
		followerReplayClient,
		config.FederationPeerTrustResolver,
		config.LocalStationID,
		config.FollowerProjectionPolicy,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	federationService, err := application.NewFederationService(
		federationInbox,
		deviceDirectory,
		authorityService,
		endpointManifestService,
		frameSigner,
		followerProjectionService,
		config.FederationPolicy,
	)
	if err != nil {
		return nil, err
	}
	recoveryRepository := infrastructure.NewRecoveryRepository(config.Database)
	recoveryService, err := application.NewRecoveryService(
		recoveryRepository,
		deviceDirectory,
		config.RecoveryPolicy,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	attachmentService, err := application.NewAttachmentService(
		authorityUnitOfWork,
		config.AttachmentBlobStore,
		config.LocalStationID,
		config.AttachmentPolicy,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	deviceHandler, err := httpinterface.NewDeviceHandler(deviceService)
	if err != nil {
		return nil, err
	}
	commandHandler, err := httpinterface.NewCommandHandler(authorityService)
	if err != nil {
		return nil, err
	}
	queueHandler, err := httpinterface.NewQueueHandler(queueService)
	if err != nil {
		return nil, err
	}
	federationHandler, err := httpinterface.NewFederationHandler(
		federationService,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	followerReplayHandler, err := httpinterface.NewFollowerReplayHandler(
		followerReplayService,
	)
	if err != nil {
		return nil, err
	}
	endpointManifestHandler, err := httpinterface.NewEndpointManifestHandler(
		endpointManifestService,
	)
	if err != nil {
		return nil, err
	}
	authorityPrepareHandler, err := httpinterface.NewAuthorityPrepareHandler(
		authorityService,
	)
	if err != nil {
		return nil, err
	}
	federationOutbox := infrastructure.NewFederationRepository(config.Database)
	authorityCommandForwarder, err := application.NewAuthorityCommandForwarder(
		deviceDirectory,
		federationOutbox,
		frameSigner,
		config.LocalStationID,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	federationDispatcher, err := worker.NewFederationDispatcher(
		config.FederationDispatcherID,
		federationOutbox,
		config.FederationTransport,
		config.FederationDispatcherPolicy,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	infrastructure.RegisterMessagingFederationScope()

	typingService, err := application.NewTypingService(
		authorityUnitOfWork,
		eventBusTypingPublisher{},
	)
	if err != nil {
		return nil, err
	}
	receiptService, err := application.NewReceiptService(
		authorityUnitOfWork,
		config.LocalStationID,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	typingHandler, err := httpinterface.NewTypingHandler(typingService)
	if err != nil {
		return nil, err
	}
	receiptHandler, err := httpinterface.NewReceiptHandler(receiptService)
	if err != nil {
		return nil, err
	}

	return &Composition{
		AuthorityService:           authorityService,
		ConversationService:        conversationService,
		MembershipReader:           membershipReader,
		MemberSettingsService:      memberSettingsService,
		DeviceService:              deviceService,
		QueueService:               queueService,
		FederationService:          federationService,
		FollowerProjectionService:  followerProjectionService,
		FollowerReplayService:      followerReplayService,
		EndpointManifestService:    endpointManifestService,
		RecoveryService:            recoveryService,
		AuthorityPlanService:       authorityPlanService,
		AuthorityCommandForwarder:  authorityCommandForwarder,
		MlsKeyPackageClaimService:  mlsKeyPackageClaimService,
		AttachmentService:          attachmentService,
		TypingService:              typingService,
		ReceiptService:             receiptService,
		CommandHandler:             commandHandler,
		DeviceHandler:              deviceHandler,
		QueueHandler:               queueHandler,
		FederationHandler:          federationHandler,
		FollowerReplayHandler:      followerReplayHandler,
		EndpointManifestHandler:    endpointManifestHandler,
		AuthorityPrepareHandler:    authorityPrepareHandler,
		AuthorityPrepareFetcher:    authorityPrepareFetcher,
		MlsKeyPackageClaimHandler:  mlsKeyPackageClaimHandler,
		RemoteMlsKeyPackageClaimer: remoteMlsKeyPackageClaimer,
		AttachmentProxy:            attachmentProxy,
		TypingHandler:              typingHandler,
		ReceiptHandler:             receiptHandler,
		FederationAuth: serverwrapper.RequireFederationToken(
			domain.FederationScope,
			config.PeerKeys,
			httpadapter.StaticAudience(config.LocalStationID),
		),
		FollowerReplayAuth: serverwrapper.RequireFederationToken(
			domain.FollowerReplayScope,
			config.PeerKeys,
			httpadapter.StaticAudience(config.LocalStationID),
		),
		EndpointManifestAuth: serverwrapper.RequireFederationToken(
			domain.EndpointManifestScope,
			config.PeerKeys,
			httpadapter.StaticAudience(config.LocalStationID),
		),
		AuthorityPrepareAuth: serverwrapper.RequireFederationToken(
			domain.AuthorityPrepareScope,
			config.PeerKeys,
			httpadapter.StaticAudience(config.LocalStationID),
		),
		MlsKeyPackageClaimAuth: serverwrapper.RequireFederationToken(
			domain.MlsKeyPackageClaimScope,
			config.PeerKeys,
			httpadapter.StaticAudience(config.LocalStationID),
		),
		AttachmentFederationAuth: serverwrapper.RequireFederationToken(
			domain.AttachmentTransferScope,
			config.PeerKeys,
			httpadapter.StaticAudience(config.LocalStationID),
		),
		DeviceDirectory:      deviceDirectory,
		FederationDispatcher: federationDispatcher,
		deviceRepository:     deviceRepository,
		authorityUnitOfWork:  authorityUnitOfWork,
		federationInbox:      federationInbox,
		followerRepository:   followerRepository,
		memberSettings:       memberSettingsRepository,
		federationOutbox:     federationOutbox,
		recoveryRepository:   recoveryRepository,
		mlsClaimRepository:   mlsClaimRepository,
	}, nil
}

func (c *Composition) Migrate() error {
	if c == nil {
		return fmt.Errorf("messaging: composition is nil")
	}
	if err := c.deviceRepository.AutoMigrate(); err != nil {
		return err
	}
	if err := c.authorityUnitOfWork.AutoMigrate(); err != nil {
		return err
	}
	if err := c.federationInbox.AutoMigrate(); err != nil {
		return err
	}
	if err := c.memberSettings.AutoMigrate(); err != nil {
		return err
	}
	if err := c.federationOutbox.AutoMigrate(); err != nil {
		return err
	}
	if err := c.mlsClaimRepository.AutoMigrate(); err != nil {
		return err
	}
	if err := c.recoveryRepository.AutoMigrate(); err != nil {
		return err
	}
	return nil
}
