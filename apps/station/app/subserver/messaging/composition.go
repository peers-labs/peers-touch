package messaging

import (
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/messaging/interface/http"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/worker"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"gorm.io/gorm"
)

type CompositionConfig struct {
	Database                   *gorm.DB
	Clock                      func() time.Time
	LocalStationID             string
	PeerKeys                   authfed.PeerKeyStore
	QueueLimits                domain.QueueLimits
	QueuePolicy                application.QueuePolicy
	FederationPolicy           application.FederationPolicy
	RecoveryPolicy             application.RecoveryPolicy
	AuthorityPlanPolicy        application.AuthorityPlanPolicy
	FederationDispatcherID     string
	FederationDispatcherPolicy worker.FederationDispatcherPolicy
	FederationTransport        worker.FederationTransport
}

// Composition is the single dependency graph for the target Station Messaging
// Platform. W02-W04/W06 use it without route registration; W05 will register
// these handlers as the sole production messaging owner.
type Composition struct {
	AuthorityService     *application.AuthorityService
	ConversationService  *application.ConversationService
	DeviceService        *application.DeviceService
	QueueService         *application.QueueService
	FederationService    *application.FederationService
	RecoveryService      *application.RecoveryService
	AuthorityPlanService *application.AuthorityPlanService

	CommandHandler    *httpinterface.CommandHandler
	DeviceHandler     *httpinterface.DeviceHandler
	QueueHandler      *httpinterface.QueueHandler
	FederationHandler *httpinterface.FederationHandler
	FederationAuth    server.Wrapper

	FederationDispatcher *worker.FederationDispatcher

	deviceRepository    *infrastructure.DeviceRepository
	authorityUnitOfWork *infrastructure.AuthorityUnitOfWork
	federationInbox     *infrastructure.FederationInboxUnitOfWork
	federationOutbox    *infrastructure.FederationRepository
	recoveryRepository  *infrastructure.RecoveryRepository
}

func NewComposition(config CompositionConfig) (*Composition, error) {
	if config.Database == nil ||
		config.Clock == nil ||
		config.LocalStationID == "" ||
		config.PeerKeys == nil ||
		config.FederationTransport == nil {
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
	authorityService, err := application.NewAuthorityService(
		authorityUnitOfWork,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	conversationService, err := application.NewConversationService(
		authorityUnitOfWork,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	authorityPlanService, err := application.NewAuthorityPlanService(
		authorityUnitOfWork,
		config.LocalStationID,
		config.AuthorityPlanPolicy,
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
	federationInbox := infrastructure.NewFederationInboxUnitOfWork(
		config.Database,
		config.QueueLimits,
	)
	federationService, err := application.NewFederationService(
		federationInbox,
		deviceDirectory,
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
	federationOutbox := infrastructure.NewFederationRepository(config.Database)
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

	return &Composition{
		AuthorityService:     authorityService,
		ConversationService:  conversationService,
		DeviceService:        deviceService,
		QueueService:         queueService,
		FederationService:    federationService,
		RecoveryService:      recoveryService,
		AuthorityPlanService: authorityPlanService,
		CommandHandler:       commandHandler,
		DeviceHandler:        deviceHandler,
		QueueHandler:         queueHandler,
		FederationHandler:    federationHandler,
		FederationAuth: serverwrapper.RequireFederationToken(
			domain.FederationScope,
			config.PeerKeys,
			httpadapter.StaticAudience(config.LocalStationID),
		),
		FederationDispatcher: federationDispatcher,
		deviceRepository:     deviceRepository,
		authorityUnitOfWork:  authorityUnitOfWork,
		federationInbox:      federationInbox,
		federationOutbox:     federationOutbox,
		recoveryRepository:   recoveryRepository,
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
	if err := c.federationOutbox.AutoMigrate(); err != nil {
		return err
	}
	return c.recoveryRepository.AutoMigrate()
}
