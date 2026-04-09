package federation

import (
	"fmt"
	"strings"
)

// URLGenerator generates ActivityPub endpoint URLs.
type URLGenerator struct {
	baseURL string
}

// NewURLGenerator creates a URL generator with the given base URL.
func NewURLGenerator(baseURL string) *URLGenerator {
	return &URLGenerator{
		baseURL: strings.TrimSuffix(baseURL, "/"),
	}
}

func (g *URLGenerator) ActorURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/actor", g.baseURL, username)
}

func (g *URLGenerator) ActivityURL(activityID uint64) string {
	return fmt.Sprintf("%s/activitypub/activities/%d", g.baseURL, activityID)
}

func (g *URLGenerator) ObjectURL(objectID uint64) string {
	return fmt.Sprintf("%s/activitypub/objects/%d", g.baseURL, objectID)
}

func (g *URLGenerator) OutboxURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/outbox", g.baseURL, username)
}

func (g *URLGenerator) InboxURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/inbox", g.baseURL, username)
}

func (g *URLGenerator) FollowersURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/followers", g.baseURL, username)
}

func (g *URLGenerator) FollowingURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/following", g.baseURL, username)
}

func (g *URLGenerator) LikedURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/liked", g.baseURL, username)
}

func (g *URLGenerator) SharedInboxURL() string {
	return fmt.Sprintf("%s/activitypub/inbox", g.baseURL)
}
