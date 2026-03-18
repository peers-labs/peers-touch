package touch

import (
	"context"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	peerhandler "github.com/peers-labs/peers-touch/station/frame/touch/peer/handler"
)

const (
	RouterURLSetPeerAddr   RouterPath = "/set-addr"
	RouterURLGetMyPeerAddr RouterPath = "/get-my-peer-info"
	RouterURLTouchHiTo     RouterPath = "/touch-hi-to"
)

type PeerRouters struct{}

// Ensure PeerRouters implements server.Routers interface
var _ server.Routers = (*PeerRouters)(nil)

// Routers registers all peer-related handlers
func (pr *PeerRouters) Handlers() []server.Handler {
	log.Infof(context.Background(), "Registering peer handlers")

	commonWrapper := CommonAccessControlWrapper(model.RouteNamePeer)
	nodeHandlers := peerhandler.NewNodeHandlers()

	return []server.Handler{
		server.NewTypedHandler(
			RouterURLSetPeerAddr.Name(),
			RouterURLSetPeerAddr.SubPath(),
			server.POST,
			peerhandler.HandleSetPeerAddr,
			commonWrapper,
		),
		server.NewTypedHandler(
			RouterURLGetMyPeerAddr.Name(),
			RouterURLGetMyPeerAddr.SubPath(),
			server.GET,
			peerhandler.HandleGetMyPeerAddr,
			commonWrapper,
		),
		server.NewTypedHandler(
			RouterURLTouchHiTo.Name(),
			RouterURLTouchHiTo.SubPath(),
			server.POST,
			peerhandler.HandleTouchHi,
			commonWrapper,
		),
		server.NewTypedHandler(
			"peer-list-nodes",
			"/nodes",
			server.GET,
			nodeHandlers.HandleListNodes,
			commonWrapper,
		),
		server.NewTypedHandler(
			"peer-get-node",
			"/nodes/:id",
			server.GET,
			nodeHandlers.HandleGetNode,
			commonWrapper,
		),
		server.NewTypedHandler(
			"peer-register-node",
			"/nodes",
			server.POST,
			nodeHandlers.HandleRegisterNode,
			commonWrapper,
		),
		server.NewTypedHandler(
			"peer-deregister-node",
			"/nodes/:id",
			server.DELETE,
			nodeHandlers.HandleDeregisterNode,
			commonWrapper,
		),
	}
}

func (mr *PeerRouters) Name() string {
	return model.RouteNamePeer
}

// NewPeerRouter creates PeerRouters
func NewPeerRouter() *PeerRouters {
	return &PeerRouters{}
}
