package key_exchange

import (
	"context"
	"fmt"
	"strings"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

type subServer struct {
	status      server.Status
	addrs       []string
	jwtWrapper  server.Wrapper
	composition *canonicalComposition
	api         canonicalAPI
}

// NewKeyExchangeSubServer constructs the canonical Key Exchange HTTP subserver.
func NewKeyExchangeSubServer(_ ...option.Option) server.Subserver {
	return &subServer{
		status: server.StatusStopped,
		addrs:  []string{},
	}
}

func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = withCanonicalKeyExchangeSubject(
		server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider)),
		resolveKeyExchangeSubjectPTID,
	)

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	localStationID, err := keyExchangeLocalStationID()
	if err != nil {
		return err
	}
	if err := registerKeyExchangeFederationScopes(); err != nil {
		return err
	}
	clock := systemClock{}
	deviceInbox, err := newCanonicalDeviceInbox(rds, clock)
	if err != nil {
		return err
	}
	federationPort, err := newCanonicalFederationPort(
		ctx,
		rds,
		authfed.Singleton(),
		clock,
		localStationID,
	)
	if err != nil {
		return err
	}
	composition, err := newCanonicalComposition(ctx, canonicalCompositionConfig{
		database:                rds,
		devices:                 newActorDeviceDirectory(rds),
		actorHomes:              actorHomeStationDirectory{},
		deviceInbox:             deviceInbox,
		federation:              federationPort,
		clock:                   clock,
		ids:                     uuidGenerator{},
		localStationID:          localStationID,
		contentPreKeyPublishers: actorSigningKeyResolver{},
	})
	if err != nil {
		return err
	}
	s.composition = composition
	s.api = composition.api

	return nil
}

func (s *subServer) Start(context.Context, ...option.Option) error {
	if s.composition == nil || s.api == nil {
		s.status = server.StatusError

		return fmt.Errorf("key exchange canonical composition is not initialized")
	}
	s.status = server.StatusRunning

	return nil
}

func (s *subServer) Stop(context.Context) error {
	s.status = server.StatusStopped

	return nil
}

func (s *subServer) Name() string               { return "key_exchange" }
func (s *subServer) Type() server.SubserverType { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress {
	return server.SubserverAddress{Address: s.addrs}
}
func (s *subServer) Status() server.Status { return s.status }

func keyExchangeLocalStationID() (string, error) {
	identity := nativefed.LocalIdentitySnapshot()
	if peerID := strings.TrimSpace(identity.StationPeerID.String()); peerID != "" {
		return peerID, nil
	}

	return "", fmt.Errorf(
		"key exchange requires the initialized local Station peer identity",
	)
}
