package groupcall

import (
	"context"
	"fmt"
	"os"
	"strings"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
)

type subServer struct {
	status     server.Status
	addrs      []string
	jwtWrapper server.Wrapper
	provider   RoomProvider
	members    GroupMemberLister
	authority  ConversationAuthorityResolver
	federation FederationPeerCaller
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
	memberLister := NewGormMemberLister(rds)
	s.members = memberLister

	conversationInstance := server.GetOptions().SubserverInstances["conversation"]
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

	// Wire up the LiveKit adapter as the RoomProvider.
	s.provider = NewLiveKitAdapter(cfg, memberLister)

	return nil
}

func (s *subServer) Start(_ context.Context, _ ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) Stop(_ context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string               { return "groupcall" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }
