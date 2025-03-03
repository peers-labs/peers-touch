package server

import (
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

// Router is a server handler that can be registered with a server.
// Peers defines a router protocol that can be used to register handlers with a server.
// also supplies standard handlers which follow activityPub protocol.
// if you what to register a handler with Peers server, you can implement this interface, then call server.Handle() to register it.
type Router server.Handler

type Routers interface {
	Routers() []Router
}

type RouterURL string

func (apr RouterURL) Name() string {
	return string(apr)
}

func (apr RouterURL) URL() string {
	return string(apr)
}
