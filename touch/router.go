package touch

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

const (
	RoutersNameManagement  = "management"
	RoutersNameActivityPub = "activitypub"
)

// Router is a server handler that can be registered with a server.
// Peers defines a router protocol that can be used to register handlers with a server.
// also supplies standard handlers which follow activityPub protocol.
// if you what to register a handler with Peers server, you can implement this interface, then call server.Handle() to register it.
type Router server.Handler

type Routers interface {
	Routers() []Router

	// Name declares the cluster-name of routers
	// it must be unique. Peers uses it to check if there are already routers(like activitypub
	// and management interface.) that must be registered,
	// if you want to register a bundle of routers with the same name, it will be overwritten
	Name() string
}

type RouterURL string

func (apr RouterURL) Name() string {
	return string(apr)
}

func (apr RouterURL) URL() string {
	return string(apr)
}

func Handlers() []option.Option {
	m := NewManageRouter()
	a := NewActivityPubRouter()
	w := NewWellKnownRouter()

	handlers := make([]option.Option, 0)

	for _, r := range m.Routers() {
		handlers = append(handlers, server.WithHandlers(convertRouterToServerHandler(r)))
	}

	for _, r := range a.Routers() {
		handlers = append(handlers, server.WithHandlers(convertRouterToServerHandler(r)))
	}

	for _, r := range w.Routers() {
		handlers = append(handlers, server.WithHandlers(convertRouterToServerHandler(r)))
	}

	return handlers
}

func convertRouterToServerHandler(r Router) server.Handler {
	return server.Handler(r)
}
