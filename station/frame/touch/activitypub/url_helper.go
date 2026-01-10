package activitypub

import (
	"fmt"
	"strings"
)

// URLGenerator 生成 ActivityPub URL
type URLGenerator struct {
	baseURL string
}

// NewURLGenerator 创建 URL 生成器
func NewURLGenerator(baseURL string) *URLGenerator {
	return &URLGenerator{
		baseURL: strings.TrimSuffix(baseURL, "/"),
	}
}

// ActorURL 生成 Actor URL
func (g *URLGenerator) ActorURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/actor", g.baseURL, username)
}

// ActivityURL 生成 Activity URL
func (g *URLGenerator) ActivityURL(activityID uint64) string {
	return fmt.Sprintf("%s/activitypub/activities/%d", g.baseURL, activityID)
}

// ObjectURL 生成 Object URL
func (g *URLGenerator) ObjectURL(objectID uint64) string {
	return fmt.Sprintf("%s/activitypub/objects/%d", g.baseURL, objectID)
}

// OutboxURL 生成 Outbox URL
func (g *URLGenerator) OutboxURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/outbox", g.baseURL, username)
}

// InboxURL 生成 Inbox URL
func (g *URLGenerator) InboxURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/inbox", g.baseURL, username)
}

// FollowersURL 生成 Followers URL
func (g *URLGenerator) FollowersURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/followers", g.baseURL, username)
}

// FollowingURL 生成 Following URL
func (g *URLGenerator) FollowingURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/following", g.baseURL, username)
}

// LikedURL 生成 Liked URL
func (g *URLGenerator) LikedURL(username string) string {
	return fmt.Sprintf("%s/activitypub/%s/liked", g.baseURL, username)
}

// SharedInboxURL 生成 Shared Inbox URL
func (g *URLGenerator) SharedInboxURL() string {
	return fmt.Sprintf("%s/activitypub/inbox", g.baseURL)
}
