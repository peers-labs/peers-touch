package model

const (
	// Content types
	ContentTypeActivityJSON     = "application/activity+json"
	ContentTypeActivityJSONUTF8 = "application/activity+json; charset=utf-8"
	ContentTypeJSON             = "application/json"
	ContentTypeJSONUTF8         = "application/json; charset=utf-8"
	ContentTypeHTML             = "text/html"
	ContentTypeJRD              = "application/jrd+json"
	ContentTypeJRDUTF8          = "application/jrd+json; charset=utf-8"

	// Accept headers
	AcceptActivityJSON   = "application/activity+json"
	AcceptActivityJSONLD = "application/activity+json, application/ld+json"
	AcceptJRDJSON        = "application/jrd+json, application/json"
)

// router constants
const (
	RouteNameActivityPub = "activitypub"
	RouteNameManagement  = "management"
	RouteNameWellKnown   = ".well-known"
	RouteNameActor       = "actor"
	RouteNamePeer        = "peer"
	RouteNameMessage     = "message"
	RouteNameMastodon    = "mastodon"
)
