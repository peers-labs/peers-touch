package touch

import (
	"context"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-touch/peers-touch/station/frame/core/server"
)

// PeerHandlerInfo represents a single handler's information
type PeerHandlerInfo struct {
	RouterURL RouterPath
	Handler   func(context.Context, *app.RequestContext)
	Method    server.Method
	Wrappers  []server.Wrapper
}

// GetPeerHandlers returns all peer handler configurations
func GetPeerHandlers() []PeerHandlerInfo {
	commonWrapper := CommonAccessControlWrapper(RoutersNamePeer)

	return []PeerHandlerInfo{
		{
			RouterURL: RouterURLSetPeerAddr,
			Handler:   SetPeerAddrHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: RouterURLGetMyPeerAddr,
			Handler:   GetMyPeerAddrInfos,
			Method:    server.GET,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
		{
			RouterURL: RouterURLTouchHiTo,
			Handler:   TouchHiToHandler,
			Method:    server.POST,
			Wrappers:  []server.Wrapper{commonWrapper},
		},
	}
}
