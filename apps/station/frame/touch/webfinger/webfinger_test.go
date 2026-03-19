package webfinger

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestBuildWebFingerResponseSelfLinkPrefixed(t *testing.T) {
	base := "https://localhost:8080"
	actor := &model.WebFingerActivityPubActor{
		ID:                base + "/activitypub/alice/actor",
		PreferredUsername: "alice",
		Inbox:             base + "/activitypub/alice/inbox",
		Outbox:            base + "/activitypub/alice/outbox",
	}
	resp := model.BuildWebFingerResponse(actor, base, model.WebFingerResource("acct:alice@localhost"))
	wantSelf := base + "/activitypub/alice/actor"
	var foundSelf bool
	for _, l := range resp.Links {
		if l.Rel == model.RelSelf && l.Type == model.ContentTypeActivityJSON && l.Href == wantSelf {
			foundSelf = true
			break
		}
	}
	if !foundSelf {
		t.Fatalf("self link not found; want href %q", wantSelf)
	}
}

// Additional endpoint tests should be covered by integration tests with a live handler if needed.
