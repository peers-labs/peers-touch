package federation

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"net/http"
	"sync"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"gorm.io/gorm"
)

// ReceiverRegistrar binds one domain's typed payload receivers.
type ReceiverRegistrar func(registry *delivery.Registry) error

// RuntimeProvider exposes the shared Federation delivery runtime to app subservers.
type RuntimeProvider interface {
	FederationDeliveryRuntime() *Runtime
}

// RuntimeConfig contains the process-scoped Federation delivery dependencies.
type RuntimeConfig struct {
	Database             *gorm.DB
	LocalStationPeerID   string
	KeyCache             *authfed.KeyCache
	PeerKeys             authfed.PeerKeyStore
	Clock                delivery.Clock
	HTTPClient           *http.Client
	StationURLResolver   StationURLResolver
	Relay                RelayAccess
	Dispatcher           delivery.DispatcherConfig
	PeerEndpointResolver PeerEndpointResolver
}

// Runtime owns the shared durable receiver registry, inbox/outbox, and dispatcher.
type Runtime struct {
	mu sync.RWMutex

	localStationPeerID string
	repository         *delivery.GORMRepository
	registry           *delivery.Registry
	dispatcher         *delivery.Dispatcher
	ephemeralTransport delivery.Transport
	signer             delivery.Signer
	routes             *PeerRouteFactory
	peerClient         *peerClient
	peerKeys           authfed.PeerKeyStore
	peerEndpoints      map[PeerRoute]server.EndpointHandler
	fallbackEndpoint   PeerEndpointResolver
	sealed             bool
}

// NewRuntime creates and migrates the production Federation delivery composition.
func NewRuntime(
	ctx context.Context,
	config RuntimeConfig,
) (*Runtime, error) {
	if config.Database == nil ||
		config.LocalStationPeerID == "" ||
		config.KeyCache == nil ||
		config.PeerKeys == nil ||
		config.Clock == nil ||
		config.HTTPClient == nil ||
		config.PeerEndpointResolver == nil {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"create Federation runtime",
			errors.New("runtime dependencies are incomplete"),
		)
	}
	if err := RegisterPeerScopes(); err != nil {
		return nil, err
	}

	repository, err := delivery.NewGORMRepository(config.Database, config.Clock)
	if err != nil {
		return nil, err
	}
	if err := repository.Migrate(ctx); err != nil {
		return nil, err
	}
	signer, err := newStationSigner(ctx, config.KeyCache)
	if err != nil {
		return nil, err
	}
	verifier, err := newStationVerifier(
		ctx,
		config.LocalStationPeerID,
		config.KeyCache,
		config.PeerKeys,
	)
	if err != nil {
		return nil, err
	}
	registry := delivery.NewRegistry()
	receiver, err := delivery.NewReceiver(delivery.ReceiverConfig{
		Policy:     delivery.DefaultFramePolicy(config.LocalStationPeerID),
		Verifier:   verifier,
		Registry:   registry,
		UnitOfWork: repository,
		Clock:      config.Clock,
	})
	if err != nil {
		return nil, err
	}
	localTransport, err := delivery.NewLocalTransport(receiver)
	if err != nil {
		return nil, err
	}
	remoteTransport, err := NewHTTPTransport(
		config.HTTPClient,
		config.KeyCache,
		config.LocalStationPeerID,
		config.StationURLResolver,
		config.Relay,
	)
	if err != nil {
		return nil, err
	}
	transport := &routedTransport{
		localStationPeerID: config.LocalStationPeerID,
		local:              localTransport,
		remote:             remoteTransport,
	}
	dispatcher, err := delivery.NewDispatcher(
		repository,
		transport,
		config.Dispatcher,
		config.Clock,
	)
	if err != nil {
		return nil, err
	}
	runtime := &Runtime{
		localStationPeerID: config.LocalStationPeerID,
		repository:         repository,
		registry:           registry,
		dispatcher:         dispatcher,
		ephemeralTransport: transport,
		signer:             signer,
		peerKeys:           config.PeerKeys,
		peerEndpoints:      make(map[PeerRoute]server.EndpointHandler),
		fallbackEndpoint:   config.PeerEndpointResolver,
	}
	routes, err := NewPeerRouteFactory(PeerRouteFactoryConfig{
		LocalStationPeerID: config.LocalStationPeerID,
		PeerKeys:           config.PeerKeys,
		DeliveryReceiver:   receiver,
		EndpointResolver:   runtime.resolvePeerEndpoint,
	})
	if err != nil {
		return nil, err
	}
	peerClient, err := newPeerClient(
		config.HTTPClient,
		config.KeyCache,
		config.LocalStationPeerID,
		config.StationURLResolver,
		config.Relay,
	)
	if err != nil {
		return nil, err
	}
	runtime.routes = routes
	runtime.peerClient = peerClient

	return runtime, nil
}

// RegisterReceivers adds one domain's typed receivers before dispatch starts.
func (r *Runtime) RegisterReceivers(registrar ReceiverRegistrar) error {
	if r == nil || registrar == nil {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"register Federation receivers",
			errors.New("runtime and registrar are required"),
		)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"register Federation receivers",
			errors.New("receiver registry is sealed"),
		)
	}

	return registrar(r.registry)
}

// RegisterPeerEndpoint binds one app-owned capability implementation to a
// Federation-owned authenticated route before the runtime is sealed.
func (r *Runtime) RegisterPeerEndpoint(
	route PeerRoute,
	endpoint server.EndpointHandler,
) error {
	if r == nil || route == "" || endpoint == nil {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"register Federation peer endpoint",
			errors.New("runtime, route, and endpoint are required"),
		)
	}
	if _, ok := peerRouteSpecFor(route); !ok {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"register Federation peer endpoint",
			fmt.Errorf("peer route %q is not registered", route),
		)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sealed {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"register Federation peer endpoint",
			errors.New("peer endpoint registry is sealed"),
		)
	}
	if _, exists := r.peerEndpoints[route]; exists {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"register Federation peer endpoint",
			fmt.Errorf("peer route %q already has an endpoint", route),
		)
	}
	r.peerEndpoints[route] = endpoint

	return nil
}

func (r *Runtime) resolvePeerEndpoint(
	route PeerRoute,
) (server.EndpointHandler, error) {
	r.mu.RLock()
	endpoint := r.peerEndpoints[route]
	fallback := r.fallbackEndpoint
	r.mu.RUnlock()
	if endpoint != nil {
		return endpoint, nil
	}
	if fallback == nil {
		return nil, fmt.Errorf("Federation peer route %q is unavailable", route)
	}

	return fallback(route)
}

// Seal prevents late receiver registration before concurrent dispatch begins.
func (r *Runtime) Seal() error {
	if r == nil {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"seal Federation runtime",
			errors.New("runtime is nil"),
		)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.registry.Seal(); err != nil {
		return err
	}
	r.sealed = true

	return nil
}

// Run drains the shared durable outbox until cancellation or a storage failure.
func (r *Runtime) Run(ctx context.Context) error {
	if err := r.Seal(); err != nil {
		return err
	}

	return r.dispatcher.Run(ctx)
}

// Handlers returns Federation-owned canonical peer routes.
func (r *Runtime) Handlers() []server.Handler {
	if r == nil || r.routes == nil {
		return nil
	}

	return r.routes.Handlers()
}

// CallPeer executes one authenticated protobuf request through the shared
// Federation route and transport owner.
func (r *Runtime) CallPeer(ctx context.Context, call PeerCall) error {
	if r == nil || r.peerClient == nil {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"call Federation peer",
			errors.New("runtime is unavailable"),
		)
	}

	return r.peerClient.Call(ctx, call)
}

// DeliverConversationTyping sends only the registered ephemeral typing payload.
// Durable payload kinds must enter the Federation outbox and dispatcher instead.
func (r *Runtime) DeliverConversationTyping(
	ctx context.Context,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if r == nil || r.ephemeralTransport == nil || frame == nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidArgument,
			"deliver Conversation typing",
			errors.New("runtime, transport, and frame are required"),
		)
	}
	if frame.GetPayloadKind() != delivery.PayloadKindConversationTyping {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidFrame,
			"deliver Conversation typing",
			errors.New("only Conversation typing may bypass the durable outbox"),
		)
	}

	return r.ephemeralTransport.Deliver(ctx, frame)
}

// DeliverRealtimeCallSignal sends only the registered ephemeral Realtime call
// payload. Call-resolution state is durable at the callee Home Station; the
// sealed SDP/ICE/control signal itself remains on the bounded realtime plane.
func (r *Runtime) DeliverRealtimeCallSignal(
	ctx context.Context,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if r == nil || r.ephemeralTransport == nil || frame == nil {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidArgument,
			"deliver Realtime call signal",
			errors.New("runtime, transport, and frame are required"),
		)
	}
	if frame.GetPayloadKind() != delivery.PayloadKindRealtimeCallSignal {
		return delivery.Result{}, delivery.NewError(
			delivery.FailureInvalidFrame,
			"deliver Realtime call signal",
			errors.New("only Realtime call signals may use this path"),
		)
	}

	return r.ephemeralTransport.Deliver(ctx, frame)
}

// OpenPeerStream executes one authenticated raw or streaming request through
// the shared Federation route and transport owner.
func (r *Runtime) OpenPeerStream(
	ctx context.Context,
	call PeerStreamCall,
) (*PeerStreamResponse, error) {
	if r == nil || r.peerClient == nil {
		return nil, delivery.NewError(
			delivery.FailureInvalidArgument,
			"open Federation peer stream",
			errors.New("runtime is unavailable"),
		)
	}

	return r.peerClient.Open(ctx, call)
}

// VerifyPeerSignature validates a detached signature with the pinned/TOFU
// Station key already accepted by the Federation authentication boundary.
func (r *Runtime) VerifyPeerSignature(
	ctx context.Context,
	stationPeerID string,
	signingKeyID string,
	payload []byte,
	signature []byte,
) error {
	if r == nil || r.peerKeys == nil ||
		stationPeerID == "" ||
		signingKeyID == "" ||
		len(payload) == 0 ||
		len(signature) != ed25519.SignatureSize {
		return delivery.NewError(
			delivery.FailureInvalidArgument,
			"verify Federation peer signature",
			errors.New("signature identity and payload are incomplete"),
		)
	}
	peerKey, err := r.peerKeys.Get(ctx, stationPeerID)
	if err != nil {
		return delivery.NewError(
			delivery.FailureUnauthenticated,
			"load Federation peer key",
			err,
		)
	}
	if peerKey == nil || peerKey.Kid != signingKeyID {
		return delivery.NewError(
			delivery.FailureUnauthenticated,
			"verify Federation peer signature",
			fmt.Errorf("peer signing key %q is not trusted", signingKeyID),
		)
	}
	publicKey, derivedKeyID, err := authfed.ParsePeerJWKPEM(peerKey.PubPEM)
	if err != nil || derivedKeyID != signingKeyID ||
		!ed25519.Verify(publicKey, payload, signature) {
		return delivery.NewError(
			delivery.FailureUnauthenticated,
			"verify Federation peer signature",
			errors.New("peer signature is invalid"),
		)
	}

	return nil
}

// Signer returns the Station identity used for canonical frame signatures.
func (r *Runtime) Signer() delivery.Signer {
	if r == nil {
		return nil
	}

	return r.signer
}

// LocalStationPeerID returns the immutable Station identity bound at initialization.
func (r *Runtime) LocalStationPeerID() string {
	if r == nil {
		return ""
	}

	return r.localStationPeerID
}
