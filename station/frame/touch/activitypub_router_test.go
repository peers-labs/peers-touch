package touch

import (
	"testing"
)

func TestActivityPubRouterPrefixedPaths(t *testing.T) {
	router := NewActivityPubRouter()
	prefix := "/" + router.Name()
	infos := GetActivityPubHandlers()

	if prefix == "/" {
		t.Fatalf("activitypub router name must not be empty; got prefix %q", prefix)
	}

	for _, info := range infos {
		path := prefix + info.RouterURL.SubPath()
		if len(path) < len(prefix) || path[:len(prefix)] != prefix {
			t.Fatalf("handler %s path %q does not have expected prefix %q", info.RouterURL.Name(), path, prefix)
		}
	}

	// Specific checks for common endpoints
	want := map[RouterPath]string{
		ActivityPubRouterURLActor:       "/activitypub/:actor/actor",
		ActivityPubRouterURLInbox:       "/activitypub/:actor/inbox",
		ActivityPubRouterURLOutbox:      "/activitypub/:actor/outbox",
		ActivityPubRouterURLFollowers:   "/activitypub/:actor/followers",
		ActivityPubRouterURLFollowing:   "/activitypub/:actor/following",
		ActivityPubRouterURLLiked:       "/activitypub/:actor/liked",
		ActivityPubRouterURLSharedInbox: "/activitypub/inbox",
	}

	for _, info := range infos {
		if exp, ok := want[info.RouterURL]; ok {
			got := prefix + info.RouterURL.SubPath()
			if got != exp {
				t.Fatalf("path mismatch for %s: got %q want %q", info.RouterURL.Name(), got, exp)
			}
		}
	}
}
