package federation

import (
	"context"
	"fmt"

	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
)

// ProcessActivity is a deprecated stub.
//
// The previous implementation persisted incoming AP activities (Create /
// Like / Follow / etc.) into the legacy `touch_posts` / `touch_post_likes`
// / `touch_comments` / `follows` tables. Those tables (except `follows`)
// were removed in Moments P1 (Dec 2025); the social subserver now uses
// the `social_*` table family with explicit audience modeling.
//
// ActivityPub federation is a post-v1 goal (architecture doc §1.2). When
// it is re-implemented:
//
//   * incoming Create activities should land in `social_public_posts` only
//     — `docs/architecture/social/moments.md §12` invariant 10 forbids
//     federation from writing to `social_private_*`
//   * incoming Like activities should map to `SocialReaction{Kind: "LIKE"}`
//   * incoming Follow activities should still write to `follows`
//   * incoming Comment activities should land in `social_comments`
//
// Until then, calls to this function are routed through here so the
// activitypub / mastodon handlers compile and uniformly return a deprecated
// error rather than half-working federation.
func ProcessActivity(c context.Context, username string, activity *ap.Activity, baseURL string) error {
	return fmt.Errorf("deprecated: ActivityPub federation is a post-v1 goal; legacy touch_posts schema removed in Moments P1")
}
