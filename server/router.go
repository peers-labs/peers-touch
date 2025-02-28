package server

import (
	"net/http"
	
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
)

// Router is a server handler that can be registered with a server.
// Peers defines a router protocol that can be used to register handlers with a server.
// also supplies standard handlers which follow activityPub protocol.
// if you what to register a handler with Peers server, you can implement this interface, then call server.Handle() to register it.
type Router interface {
	server.Handler
}

type ActivityPubRouterURL string

const (
	ActivityPubRouterURLInbox    ActivityPubRouterURL = "/inbox"
	ActivityPubRouterURLOutbox   ActivityPubRouterURL = "/outbox"
	ActivityPubRouterURLFollow   ActivityPubRouterURL = "/follow"
	ActivityPubRouterURLUnfollow ActivityPubRouterURL = "/unfollow"
	ActivityPubRouterURLLike     ActivityPubRouterURL = "/like"
	ActivityPubRouterURLUndo     ActivityPubRouterURL = "/undo"
)

type ActivityPubRouter struct{}

func (r *ActivityPubRouter) handleInbox(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Handle incoming activities
}

func (r *ActivityPubRouter) handleOutbox(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Handle outgoing activities
}

func (r *ActivityPubRouter) handleActor(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Return actor information
}

func (r *ActivityPubRouter) handleFollowers(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Return followers collection
}

func (r *ActivityPubRouter) handleFollowing(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Return following collection
}

func (r *ActivityPubRouter) handleLiked(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Return liked activities
}

func (r *ActivityPubRouter) handleShares(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Return shared activities
}

func (r *ActivityPubRouter) handleBlocks(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Handle blocked users
}

func (r *ActivityPubRouter) handleMutes(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Handle muted users
}

func (r *ActivityPubRouter) handleReports(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/activity+json")
	// Handle reports
}

// NewActivityPubRouter creates a new router with ActivityPub endpoints
func NewActivityPubRouter() *ActivityPubRouter {
	return &ActivityPubRouter{}
}
