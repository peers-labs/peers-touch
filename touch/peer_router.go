package touch

import (
	"context"
	"errors"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/registry"
	"github.com/peers-touch/peers-touch-go/core/server"
	"github.com/peers-touch/peers-touch-go/touch/model"
	"github.com/peers-touch/peers-touch-go/touch/peer"
)

const (
	RouterURLSetPeerAddr    RouterPath = "/set-addr"
	RouterURLGetMyPeerAddr  RouterPath = "/get-my-peer-info"
	RouterURLTouchHiTo      RouterPath = "/touch-hi-to"
	RouterURLListPeers      RouterPath = "/registry/peers"
	RouterURLGetPeer        RouterPath = "/registry/peers/{id}"
	RouterURLDeregisterPeer RouterPath = "/registry/peers/{id}"
	RouterURLRegistryStatus RouterPath = "/registry/status"
)

type PeerRouters struct{}

// Ensure PeerRouters implements server.Routers interface
var _ server.Routers = (*PeerRouters)(nil)

// Routers registers all peer-related handlers
func (pr *PeerRouters) Handlers() []server.Handler {
	log.Infof(context.Background(), "Registering peer handlers")

	handlerInfos := GetPeerHandlers()
	handlers := make([]server.Handler, len(handlerInfos))

	for i, info := range handlerInfos {
		handlers[i] = server.NewHandler(
			info.RouterURL,
			info.Handler,
			server.WithMethod(info.Method),
			server.WithWrappers(info.Wrappers...),
		)
	}

	return handlers
}

func (mr *PeerRouters) Name() string {
	return RoutersNamePeer
}

// NewPeerRouter creates PeerRouters
func NewPeerRouter() *PeerRouters {
	return &PeerRouters{}
}

// SetPeerAddrHandler handles the HTTP request to set a peer address.
// It binds the incoming JSON payload to a PeerAddressParam struct,
// validates the data, and calls the SetPeerAddr function to save it.
func SetPeerAddrHandler(c context.Context, ctx *app.RequestContext) {
	var param model.PeerAddressParam
	// Bind the JSON payload to the PeerAddressParam struct
	if err := ctx.Bind(&param); err != nil {
		log.Warnf(c, "SetPeerAddr bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	// Validate the PeerAddressParam data
	if err := param.Check(); err != nil {
		log.Warnf(c, "SetPeerAddr checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Call the SetPeerAddr function to save the peer address
	if err := peer.SetPeerAddr(c, &param); err != nil {
		if errors.Is(err, model.ErrPeerAddrExists) {
			log.Warnf(c, "SetPeerAddr executed failed: %v", err)
			ctx.JSON(http.StatusConflict, err.Error())
		} else {
			log.Errorf(c, "SetPeerAddr executed failed: %v", err)
			ctx.JSON(http.StatusInternalServerError, err.Error())
		}
		return
	}

	// If everything is successful, return a success response
	SuccessResponse(ctx, "Peer address saved successfully", nil)
}

func GetMyPeerAddrInfos(c context.Context, ctx *app.RequestContext) {
	// Call the GetMyPeerInfos function to retrieve the peer address information
	peerAddrInfos, err := peer.GetMyPeerInfos(c)
	if err != nil {
		log.Warnf(c, "GetMyPeerInfos executed failed: %v", err)
		FailedResponse(ctx, err)
		return
	}
	// If everything is successful, return the peer address information as a success response
	SuccessResponse(ctx, "Peer address information retrieved successfully", peerAddrInfos)
}

// TouchHiToHandler initiates a connection to a peer address and establishes a stream
func TouchHiToHandler(c context.Context, ctx *app.RequestContext) {
	var param model.TouchHiToParam
	if err := ctx.Bind(&param); err != nil {
		log.Warnf(c, "TouchHiTo bound params failed: %v", err)
		ctx.JSON(http.StatusBadRequest, err.Error())
		return
	}

	if err := param.Check(); err != nil {
		log.Warnf(c, "TouchHiTo checked params failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	// Establish connection and get status
	status, err := peer.TouchHiTo(c, &param)
	if err != nil {
		log.Errorf(c, "TouchHiTo connection failed: %v", err)
		FailedResponse(ctx, err)
		return
	}

	SuccessResponse(ctx, "Connection established successfully", status)
}

// Registry endpoint handlers - these implement registry functionality using ctx directly

// ListPeersHandler handles GET /peer/registry/peers
func ListPeersHandler(c context.Context, ctx *app.RequestContext) {
	// Parse query parameters
	var opts []registry.GetOption

	// Check for 'me' parameter
	if string(ctx.QueryArgs().Peek("me")) == "true" {
		opts = append(opts, registry.GetMe())
	}

	// Check for 'name' parameter
	if name := string(ctx.QueryArgs().Peek("name")); name != "" {
		opts = append(opts, registry.WithName(name))
	}

	// Check for 'id' parameter
	if id := string(ctx.QueryArgs().Peek("id")); id != "" {
		opts = append(opts, registry.WithId(id))
	}

	peers, err := registry.ListPeers(c, opts...)
	if err != nil {
		log.Errorf(c, "[ListPeersHandler] Failed to list peers: %v", err)
		ctx.JSON(http.StatusInternalServerError, map[string]interface{}{
			"error":   "Failed to list peers",
			"message": err.Error(),
		})
		return
	}

	response := map[string]interface{}{
		"peers": peers,
		"total": len(peers),
	}

	ctx.JSON(http.StatusOK, response)
}

// GetPeerHandler handles GET /peer/registry/peers/{id}
func GetPeerHandler(c context.Context, ctx *app.RequestContext) {
	peerID := ctx.Param("id")

	if peerID == "" {
		ctx.JSON(http.StatusBadRequest, map[string]interface{}{
			"error": "Peer ID is required",
		})
		return
	}

	peer, err := registry.GetPeer(c, registry.WithId(peerID))
	if err != nil {
		if registry.IsNotFound(err) {
			ctx.JSON(http.StatusNotFound, map[string]interface{}{
				"error":   "Peer not found",
				"message": err.Error(),
			})
		} else {
			log.Errorf(c, "[GetPeerHandler] Failed to get peer %s: %v", peerID, err)
			ctx.JSON(http.StatusInternalServerError, map[string]interface{}{
				"error":   "Failed to get peer",
				"message": err.Error(),
			})
		}
		return
	}

	response := map[string]interface{}{
		"peer": peer,
	}

	ctx.JSON(http.StatusOK, response)
}

// RegistryStatusHandler handles GET /peer/registry/status
func RegistryStatusHandler(c context.Context, ctx *app.RequestContext) {
	response := map[string]interface{}{
		"has_default_registry": registry.GetDefaultRegistry() != nil,
		"registry_count":       len(registry.GetRegistries()),
		"namespace":            registry.DefaultPeersNetworkNamespace,
	}

	ctx.JSON(http.StatusOK, response)
}
