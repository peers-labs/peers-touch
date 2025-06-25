package touch

import (
	"context"
	"errors"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/peer"
)

const (
	RouterURLSetPeerAddr RouterURL = "/peer/set-addr"
)

type PeerRouters struct{}

func (mr *PeerRouters) Routers() []Router {
	return []Router{
		server.NewHandler(RouterURLSetPeerAddr.Name(), RouterURLSetPeerAddr.URL(), SetPeerAddrHandler,
			server.WithMethod(server.POST)),
	}
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
		failedResponse(ctx, err)
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
