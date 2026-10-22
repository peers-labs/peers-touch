// Package channel is the Channel subsystem subserver.
//
// It owns Station-truth for dynamic messaging-channel plugins: an encrypted
// credential vault (fp-00) and the plugin package catalog / process
// supervision (fp-01). A missing KEK or a crashed plugin must never block
// Station startup — optional-module failures are recorded per plugin.
package channel

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"

	channelhandler "github.com/peers-labs/peers-touch/station/app/subserver/channel/handler"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginpkg"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/provisioning"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	channelservice "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

var _ server.Subserver = (*channelSubServer)(nil)

type channelSubServer struct {
	opts            *Options
	status          server.Status
	db              *gorm.DB
	secretService   *secret.Service
	catalog         *channelservice.Catalog
	bindingSvc      *channelservice.BindingService
	managementSvc   *channelservice.ManagementService
	runtimeHost     *channelservice.RuntimeHost
	bridge          *channelservice.DurableBridge
	requesterAuth   *channelservice.RequesterAuthorizationService
	provisioning    *provisioning.Manager
	provisioningSvc *channelservice.ProvisioningCoordinator
	workerMu        sync.Mutex
	workerCtx       context.Context
	workerCancel    context.CancelFunc
}

// NewChannelSubServer constructs the Channel subserver.
func NewChannelSubServer(opts ...option.Option) server.Subserver {
	return &channelSubServer{
		opts:   option.GetOptions(opts...).Ctx().Value(serverOptionsKey{}).(*Options),
		status: server.StatusStopped,
	}
}

func (s *channelSubServer) Init(ctx context.Context, opts ...option.Option) error {
	logger.Info(ctx, "begin to initiate channel subserver")
	for _, opt := range opts {
		s.opts.Apply(opt)
	}

	rds, err := store.GetRDS(ctx, store.WithRDSDBName(s.opts.DBName))
	if err != nil {
		return err
	}
	if err := rds.AutoMigrate(persistence.AllModels()...); err != nil {
		return err
	}
	s.db = rds
	// KEK absence is an operational condition for credential callers, not a
	// Station startup failure.
	s.secretService = secret.NewService(rds, secret.NewEnvKEKProvider())

	installer, err := pluginpkg.NewInstaller(pluginRoot())
	if err != nil {
		return err
	}
	s.catalog = channelservice.NewCatalog(rds, installer)
	if packageDir := discoverLarkPluginPackage(); packageDir != "" {
		if _, err := s.catalog.ImportFromDirectory(ctx, packageDir); err != nil {
			logger.Warnf(ctx, "official Lark plugin registration failed: %v", err)
		}
	}
	s.bindingSvc = channelservice.NewBindingService(rds, s.secretService)
	s.managementSvc = channelservice.NewManagementService(rds, s.bindingSvc)
	s.runtimeHost = channelservice.NewRuntimeHost(rds, s.catalog, s.bindingSvc, s.secretService)
	larkRunner, runnerErr := channelservice.NewManagedLarkCLIRunner("")
	if runnerErr != nil {
		logger.Warnf(ctx, "managed Lark requester tools are unavailable: %v", runnerErr)
	}
	s.requesterAuth = channelservice.NewRequesterAuthorizationService(
		rds, s.bindingSvc, s.secretService, larkRunner,
		strings.TrimSpace(os.Getenv("PT_CHANNEL_LARK_AUTH_ROOT")),
	)
	s.provisioning = provisioning.NewManager(provisioning.Config{})
	s.provisioningSvc = channelservice.NewProvisioningCoordinator(
		rds, s.provisioning, s.secretService, s.bindingSvc, s.runtimeHost,
	)

	s.status = server.StatusStarting
	logger.Info(ctx, "end to initiate channel subserver")
	return nil
}

func (s *channelSubServer) Start(ctx context.Context, _ ...option.Option) error {
	s.workerMu.Lock()
	if s.workerCancel == nil {
		s.workerCtx, s.workerCancel = context.WithCancel(ctx)
	}
	bridge := s.bridge
	workerCtx := s.workerCtx
	s.workerMu.Unlock()
	if bridge != nil {
		_ = bridge.RecoverLeases(workerCtx)
		bridge.Start(workerCtx)
	}
	if s.requesterAuth != nil {
		s.requesterAuth.Start(workerCtx)
	}
	// Best-effort recovery of previously-enabled plugins; failures are logged
	// and recorded on each plugin, they do not block Station.
	if s.runtimeHost != nil {
		for _, recErr := range s.runtimeHost.ReconcileAll(ctx) {
			logger.Warnf(ctx, "channel plugin recovery incomplete: %v", recErr)
		}
	}
	s.status = server.StatusRunning
	return nil
}

func (s *channelSubServer) Stop(_ context.Context) error {
	s.workerMu.Lock()
	if s.workerCancel != nil {
		s.workerCancel()
		s.workerCancel = nil
		s.workerCtx = nil
	}
	s.workerMu.Unlock()
	s.status = server.StatusStopped
	return nil
}

func (s *channelSubServer) Name() string                     { return "channel" }
func (s *channelSubServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *channelSubServer) Status() server.Status            { return s.status }
func (s *channelSubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }
func (s *channelSubServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	jwtWrapper := server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	bindingHandlers := channelhandler.NewBindingHandlers(
		s.bindingSvc, s.runtimeHost, s.requesterAuth,
	)
	requesterAuthorizationHandlers :=
		channelhandler.NewRequesterAuthorizationHandlers(s.requesterAuth)
	provisioningHandlers := channelhandler.NewProvisioningHandlers(s.provisioningSvc)
	managementHandlers := channelhandler.NewManagementHandlers(
		s.bindingSvc, s.managementSvc, s.currentBridge,
	)
	return prefixHandlers(s.opts.Path, []server.Handler{
		server.NewTypedHandler("channel-binding-create", "/channel/binding/create", server.POST, bindingHandlers.HandleCreate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-binding-update", "/channel/binding/update", server.POST, bindingHandlers.HandleUpdate, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-binding-delete", "/channel/binding/delete", server.POST, bindingHandlers.HandleDelete, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-binding-list", "/channel/binding/list", server.POST, bindingHandlers.HandleList, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-binding-start", "/channel/binding/start", server.POST, bindingHandlers.HandleStart, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-binding-stop", "/channel/binding/stop", server.POST, bindingHandlers.HandleStop, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-binding-default", "/channel/binding/default", server.POST, bindingHandlers.HandleSetDefault, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-app-validate", "/channel/app/validate", server.POST, bindingHandlers.HandleValidateApp, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-route-upsert", "/channel/route/upsert", server.POST, managementHandlers.HandleUpsertRoute, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-route-delete", "/channel/route/delete", server.POST, managementHandlers.HandleDeleteRoute, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-route-list", "/channel/route/list", server.POST, managementHandlers.HandleListRoutes, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-automation-upsert", "/channel/automation/upsert", server.POST, managementHandlers.HandleUpsertAutomation, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-automation-delete", "/channel/automation/delete", server.POST, managementHandlers.HandleDeleteAutomation, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-automation-list", "/channel/automation/list", server.POST, managementHandlers.HandleListAutomations, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-automation-run", "/channel/automation/run", server.POST, managementHandlers.HandleRunAutomation, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-message-send", "/channel/message/send", server.POST, managementHandlers.HandleSend, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-chat-list", "/channel/chat/list", server.POST, managementHandlers.HandleListChats, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-event-list", "/channel/event/list", server.POST, managementHandlers.HandleListEvents, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-stats", "/channel/stats", server.POST, managementHandlers.HandleStats, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-delivery-retry", "/channel/delivery/retry", server.POST, managementHandlers.HandleRetryDelivery, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-diagnostics-export", "/channel/diagnostics/export", server.POST, managementHandlers.HandleExportDiagnostics, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-health-check", "/channel/health/check", server.POST, managementHandlers.HandleHealth, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-requester-authorization-start", "/channel/requester-authorization/start", server.POST, requesterAuthorizationHandlers.HandleStart, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-requester-authorization-get", "/channel/requester-authorization/get", server.POST, requesterAuthorizationHandlers.HandleGet, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-requester-authorization-refresh", "/channel/requester-authorization/refresh", server.POST, requesterAuthorizationHandlers.HandleRefresh, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-requester-authorization-revoke", "/channel/requester-authorization/revoke", server.POST, requesterAuthorizationHandlers.HandleRevoke, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-requester-authorization-cancel", "/channel/requester-authorization/cancel", server.POST, requesterAuthorizationHandlers.HandleCancel, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-member-list", "/channel/member/list", server.POST, managementHandlers.HandleListMemberAccess, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-member-decide", "/channel/member/decide", server.POST, managementHandlers.HandleDecideMemberAccess, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-provisioning-start", "/channel/provisioning/start", server.POST, provisioningHandlers.HandleStart, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-provisioning-poll", "/channel/provisioning/poll", server.POST, provisioningHandlers.HandlePoll, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-provisioning-confirm", "/channel/provisioning/confirm", server.POST, provisioningHandlers.HandleConfirm, logIDWrapper, jwtWrapper),
		server.NewTypedHandler("channel-provisioning-cancel", "/channel/provisioning/cancel", server.POST, provisioningHandlers.HandleCancel, logIDWrapper, jwtWrapper),
	})
}

func prefixHandlers(base string, handlers []server.Handler) []server.Handler {
	base = strings.TrimRight(base, "/")
	if base == "" {
		return handlers
	}
	out := make([]server.Handler, 0, len(handlers))
	for _, handler := range handlers {
		out = append(out, server.NewHandler(
			handler.Name(),
			base+handler.Path(),
			handler.Method(),
			handler.Type(),
			handler.Handler(),
			handler.Wrappers()...,
		))
	}
	return out
}

func (s *channelSubServer) currentBridge() *channelservice.DurableBridge {
	s.workerMu.Lock()
	defer s.workerMu.Unlock()
	return s.bridge
}

// SecretService exposes the credential vault to later HTTP handlers.
func (s *channelSubServer) SecretService() *secret.Service { return s.secretService }

// Catalog exposes the plugin package catalog to later HTTP handlers.
func (s *channelSubServer) Catalog() *channelservice.Catalog { return s.catalog }

// Bindings exposes the binding service to later HTTP handlers.
func (s *channelSubServer) Bindings() *channelservice.BindingService { return s.bindingSvc }

// Runtime exposes the plugin runtime host to later HTTP handlers.
func (s *channelSubServer) Runtime() *channelservice.RuntimeHost { return s.runtimeHost }

// RequesterTools exposes the Channel-owned requester identity executor to the
// Agent subserver without moving token or provider ownership into Agent.
func (s *channelSubServer) RequesterTools() channelservice.RequesterToolExecutor {
	return s.requesterAuth
}

// SetTurnExecutor wires the agent-domain turn executor and installs the
// channel->turn->channel admission bridge. Called by the agent subserver
// once its services are constructed (channel initializes first).
func (s *channelSubServer) SetTurnExecutor(executor channelservice.TurnExecutor) {
	if s.runtimeHost == nil || s.bindingSvc == nil || s.managementSvc == nil {
		return
	}
	bridge := channelservice.NewDurableBridge(
		s.db, s.bindingSvc, s.managementSvc, executor,
		s.runtimeHost, s.runtimeHost,
	)
	s.workerMu.Lock()
	s.bridge = bridge
	workerCtx := s.workerCtx
	s.workerMu.Unlock()
	s.runtimeHost.SetAdmitter(bridge)
	if workerCtx != nil {
		_ = bridge.RecoverLeases(workerCtx)
		bridge.Start(workerCtx)
	}
}

// pluginRoot resolves the on-disk plugin storage root. PT_CHANNEL_PLUGIN_ROOT
// overrides; otherwise a per-data-dir default is used and created on install.
func pluginRoot() string {
	if root := os.Getenv("PT_CHANNEL_PLUGIN_ROOT"); root != "" {
		return root
	}
	return filepath.Join(os.TempDir(), "peers-touch", "channel-plugins")
}

func discoverLarkPluginPackage() string {
	var candidates []string
	if configured := strings.TrimSpace(os.Getenv("PT_CHANNEL_LARK_PLUGIN_PACKAGE")); configured != "" {
		candidates = append(candidates, configured)
	}
	if root := strings.TrimSpace(os.Getenv("PT_CHANNEL_PLUGIN_BUNDLE_ROOT")); root != "" {
		candidates = append(candidates, filepath.Join(root, "lark"))
	}
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), "plugins", "lark"))
	}
	candidates = append(candidates,
		"build/plugins/lark",
		filepath.Join("..", "..", "..", "build", "plugins", "lark"),
	)
	for _, candidate := range candidates {
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if info, err := os.Stat(filepath.Join(absolute, "plugin.json")); err == nil && !info.IsDir() {
			return absolute
		}
	}
	return ""
}
