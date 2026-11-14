package groupcall

import (
	"context"
	"fmt"
	"os"
	"strings"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/mediaaccess"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"gorm.io/gorm"
)

type subServer struct {
	status            server.Status
	addrs             []string
	jwtWrapper        server.Wrapper
	provider          RoomProvider
	members           GroupMemberLister
	authority         ConversationAuthorityResolver
	federation        FederationPeerCaller
	authorityFence    GroupCallAuthorityFence
	db                *gorm.DB
	maintenanceCancel context.CancelFunc
	maintenanceDone   chan struct{}
}

type federationRuntimeProvider interface {
	FederationDeliveryRuntime() *federationruntime.Runtime
}

// NewGroupCallSubServer creates a new groupcall subserver that
// coordinates group video/voice calls via an external SFU (LiveKit).
func NewGroupCallSubServer(opts ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, opts ...option.Option) error {
	s.status = server.StatusStarting

	// Set up JWT authentication wrapper (same pattern as presence).
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = serverwrapper.CanonicalSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		serverwrapper.SubjectResolver(touchactor.ResolveSubjectPTID),
	)

	// Read LiveKit configuration from environment variables.
	cfg := LiveKitConfig{
		APIURL:    strings.TrimSpace(os.Getenv("LIVEKIT_API_URL")),
		PublicURL: strings.TrimSpace(os.Getenv("LIVEKIT_PUBLIC_URL")),
		APIKey:    strings.TrimSpace(os.Getenv("LIVEKIT_API_KEY")),
		APISecret: strings.TrimSpace(os.Getenv("LIVEKIT_API_SECRET")),
	}

	// Initialize GORM-backed group member lister.
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	conversationInstance := server.GetOptions().SubserverInstances["conversation"]
	memberLister, ok := conversationInstance.(GroupMemberLister)
	if !ok || memberLister == nil {
		return fmt.Errorf("initialize groupcall: Conversation member projection is unavailable")
	}
	s.members = memberLister
	authority, ok := conversationInstance.(ConversationAuthorityResolver)
	if !ok || authority == nil {
		return fmt.Errorf("initialize groupcall: Conversation authority resolver is unavailable")
	}
	federationInstance := server.GetOptions().SubserverInstances["federation"]
	federationProvider, ok := federationInstance.(federationRuntimeProvider)
	if !ok || federationProvider == nil ||
		federationProvider.FederationDeliveryRuntime() == nil {
		return fmt.Errorf("initialize groupcall: Federation runtime is unavailable")
	}
	s.authority = authority
	s.federation = federationProvider.FederationDeliveryRuntime()
	fence, ok := conversationInstance.(GroupCallAuthorityFence)
	if !ok || fence == nil {
		return fmt.Errorf("initialize groupcall: Conversation media fence is unavailable")
	}
	s.authorityFence = fence
	s.db = rds
	if err := rds.AutoMigrate(&endpointGrant{}, &invitationDecision{}); err != nil {
		return fmt.Errorf("initialize groupcall grant persistence: %w", err)
	}

	// Wire up the LiveKit adapter as the RoomProvider.
	adapter := NewLiveKitAdapter(cfg, memberLister)
	adapter.admit = s.admit
	s.provider = adapter
	mediaaccess.Register(s)

	return nil
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	// A Station restart cannot preserve an earlier admitted connection without
	// revalidating its permission owners. Retire all grants from that instance.
	if err := s.revokeHome(ctx, s.db.Where("side = ? AND ejected = false", grantHome)); err != nil {
		return err
	}
	var grants []endpointGrant
	if err := s.db.WithContext(ctx).Where("side = ? AND ejected = false", grantAuthority).
		Find(&grants).Error; err != nil {
		return err
	}
	for _, grant := range grants {
		if err := s.revokeAuthority(ctx, grant); err != nil {
			return err
		}
	}
	s.status = server.StatusRunning
	maintenanceCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	s.maintenanceCancel = cancel
	s.maintenanceDone = make(chan struct{})
	go s.runGrantMaintenance(maintenanceCtx)
	return nil
}

func (s *subServer) Stop(ctx context.Context) error {
	if s.maintenanceCancel != nil {
		s.maintenanceCancel()
		select {
		case <-s.maintenanceDone:
		case <-ctx.Done():
			return ctx.Err()
		}
		s.maintenanceCancel = nil
	}
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "groupcall" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }
