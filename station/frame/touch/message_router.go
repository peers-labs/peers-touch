package touch

import (
    "github.com/peers-touch/peers-touch/station/frame/core/server"
)

const (
    MessageRouterURLCreateConv   RouterPath = "/conv"
    MessageRouterURLGetConv      RouterPath = "/conv/:id"
    MessageRouterURLGetConvState RouterPath = "/conv/:id/state"
    MessageRouterURLMembers      RouterPath = "/conv/:id/members"
    MessageRouterURLKeyRotate    RouterPath = "/conv/:id/key-rotate"
    MessageRouterURLAppendMsg    RouterPath = "/conv/:id/msg"
    MessageRouterURLListMsg      RouterPath = "/conv/:id/msg"
    MessageRouterURLStream       RouterPath = "/conv/:id/stream"
    MessageRouterURLReceipt      RouterPath = "/conv/:id/receipt"
    MessageRouterURLReceipts     RouterPath = "/conv/:id/receipts"
    MessageRouterURLAttach       RouterPath = "/conv/:id/attach"
    MessageRouterURLGetAttach    RouterPath = "/attach/:cid"
    MessageRouterURLSearch       RouterPath = "/conv/:id/search"
    MessageRouterURLSnapshot     RouterPath = "/conv/:id/snapshot"
)

type MessageRouters struct{}

var _ server.Routers = (*MessageRouters)(nil)

func (mr *MessageRouters) Handlers() []server.Handler {
    handlerInfos := GetMessageHandlers()
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

func (mr *MessageRouters) Name() string {
    return ""
}

func NewMessageRouter() *MessageRouters {
    return &MessageRouters{}
}