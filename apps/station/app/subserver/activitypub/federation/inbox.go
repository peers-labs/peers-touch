package federation

import (
	"context"
	"fmt"
)

// FetchInbox is a deprecated stub.
//
// The previous implementation served an OrderedCollection by reading the
// legacy `touch_posts` / `touch_comments` tables. Those tables were removed
// in Moments P1 (Dec 2025) when the social subserver moved to the
// `social_*` table family with audience-aware visibility (see
// `docs/architecture/social/moments.md §6`). ActivityPub federation is a
// post-v1 goal (architecture doc §1.2); when it is re-implemented, this
// function will be rewritten to read from `social_public_posts` only —
// private posts are never federated by design.
func FetchInbox(c context.Context, username string, baseURL string, page bool) (interface{}, error) {
	return nil, fmt.Errorf("deprecated: ActivityPub federation is a post-v1 goal; use Social API /api/v1/social/moments/timeline instead")
}
