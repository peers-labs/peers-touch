package application

import (
	"context"
	"errors"
	"testing"
	"time"

	searchpb "github.com/peers-labs/peers-touch/station/app/model/search"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
)

func TestPublicSearchReadScopeMatchesNativeBinding(t *testing.T) {
	const actor = "scope-contract-actor"
	// SHA-256 of the UTF-8 Actor PTID, shared by Desktop and Mobile bindings.
	const expected = "station.social.public:actor:61cf4d4c8c73db95ca3f0c4de9f365ce2031217e0aa144b39e705ff24a3670cf"
	for _, observation := range []string{"first-observation", "later-observation"} {
		cache := publicSearchCache(actor, observation, "validator")
		if cache.ReadValidity.ReadScope != expected {
			t.Fatalf("native read scope mismatch: %s", cache.ReadValidity.ReadScope)
		}
		if !cache.NoStore || !cache.ReadValidity.OwnerCheckRequired ||
			cache.ReadValidity.LeaseUntilUnixMs != 0 || cache.ContentFreshUntilUnixMs != 0 {
			t.Fatalf("read scope granted an offline lease: %+v", cache)
		}
	}
	if publicSearchReadValidity("another-actor", "first-observation").ReadScope == expected {
		t.Fatal("read scope is not actor-bound")
	}
}

func TestPublicSearchFilteredCursorProgressAndBinding(t *testing.T) {
	f := newFixture(t)
	seedPublicReadRows(t, f, 130)
	if err := f.gdb.Model(&db.Actor{}).Where("id IN ?", []uint64{1, 2, 3}).
		Update("home_station_domain", "original.example").Error; err != nil {
		t.Fatal(err)
	}
	service, err := NewPublicSearchService(f.gdb)
	if err != nil {
		t.Fatal(err)
	}
	ctx, viewer := context.Background(), fixturePTID(2)
	request := &searchpb.QueryIntent{Text: "reply", Limit: 20,
		Kinds:  []searchpb.SearchKind{searchpb.SearchKind_SEARCH_KIND_SOCIAL_COMMENT},
		Scopes: []searchpb.SearchScope{searchpb.SearchScope_SEARCH_SCOPE_STATION}}
	cursor := publicSearchCursor{Binding: publicSearchBinding(viewer, request), ExpiresAt: time.Now().Add(time.Minute).UnixMilli()}
	// Exercise the paging mechanism on a fixture. Production Snapshot refuses
	// SQLite and obtains its observation from pg_current_snapshot().
	page, err := service.queryPage(ctx, f.gdb, "fixture-observation", viewer, request, cursor, false, true)
	if err != nil || len(page.Candidates) != 0 || page.NextCursor == "" ||
		page.Coverage.State != searchpb.SourceState_SOURCE_STATE_PARTIAL || !page.Cache.NoStore ||
		!page.Cache.ReadValidity.OwnerCheckRequired || page.Cache.ReadValidity.LeaseUntilUnixMs != 0 {
		t.Fatalf("filtered source page/cache: %+v/%v", page, err)
	}
	continuation, err := service.decodeCursor(page.NextCursor, cursor.Binding)
	if err != nil || continuation.After.ID == 0 || continuation.ExpiresAt != cursor.ExpiresAt {
		t.Fatalf("continuation lost scan position/expiry: %+v/%v", continuation, err)
	}
	next, err := service.queryPage(ctx, f.gdb, "fixture-observation", viewer, request, continuation, false, true)
	if err != nil || len(next.Candidates) != 2 || next.NextCursor != "" ||
		next.Coverage.State != searchpb.SourceState_SOURCE_STATE_READY {
		t.Fatalf("filtered source did not advance: %+v/%v", next, err)
	}
	for _, candidate := range next.Candidates {
		ref := candidate.Resource
		if ref.Kind != "social-comment" || ref.Anchor.Kind != "comment" || ref.Anchor.Id != ref.Id ||
			ref.Parent.Kind != "social-post" || ref.Parent.Id != "1001" ||
			ref.AuthorityNamespace != "social:public:original.example" ||
			ref.Parent.AuthorityNamespace != ref.AuthorityNamespace {
			t.Fatalf("noncanonical original comment: %+v", ref)
		}
	}
	refresh := proto.Clone(request).(*searchpb.QueryIntent)
	refresh.Refresh = true
	if publicSearchBinding(viewer, refresh) != cursor.Binding {
		t.Fatal("refresh entered semantic cursor identity")
	}
	if _, err := service.decodeCursor(page.NextCursor, publicSearchBinding(fixturePTID(3), request)); err == nil {
		t.Fatal("cursor accepted another actor")
	}
	changedFilter := proto.Clone(request).(*searchpb.QueryIntent)
	changedFilter.Text = "other query"
	if _, err := service.decodeCursor(page.NextCursor, publicSearchBinding(viewer, changedFilter)); err == nil {
		t.Fatal("cursor accepted another query")
	}
	if _, err := service.decodeCursor("x"+page.NextCursor, cursor.Binding); err == nil {
		t.Fatal("tampered cursor accepted")
	}
	_, err = service.queryPage(ctx, f.gdb, "changed-fixture-observation", viewer, request, continuation, false, true)
	var readError *PublicSearchError
	if !errors.As(err, &readError) || readError.Code != searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_CHANGED {
		t.Fatalf("changed observation accepted: %v", err)
	}
	continuation.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	expired, err := service.encodeCursor(continuation)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.decodeCursor(expired, cursor.Binding); err == nil {
		t.Fatal("expired cursor accepted")
	}
}

func TestPublicSearchHydrationRechecksKnownValidatorAndOrigin(t *testing.T) {
	f := newFixture(t)
	seedPublicReadRows(t, f, 3)
	if err := f.gdb.Model(&db.Actor{}).Where("id = 1").Update("home_station_domain", "original.example").Error; err != nil {
		t.Fatal(err)
	}
	service, err := NewPublicSearchService(f.gdb)
	if err != nil {
		t.Fatal(err)
	}
	ctx, viewer := context.Background(), fixturePTID(2)
	request := &searchpb.HydrationRequest{Items: []*searchpb.HydrationItem{{
		ItemId: "post", Resource: &searchpb.ResourceRef{Kind: "social-post", Id: "1001", AuthorityNamespace: "social:public:original.example"},
	}}}
	reply, err := service.hydrateSnapshot(ctx, f.gdb, "fixture-before", viewer, request)
	if err != nil || reply.Outcomes[0].GetChanged() == nil {
		t.Fatalf("authorized hydration failed: %+v/%v", reply, err)
	}
	changed := reply.Outcomes[0].GetChanged()
	if changed.Result.SourceId != PublicSearchSourceID || !changed.Cache.NoStore ||
		changed.Result.ReadValidity.PolicyRevision != changed.Cache.ReadValidity.PolicyRevision {
		t.Fatalf("item/cache authority mismatch: %+v", changed)
	}
	request.Items[0].KnownValidator = changed.Cache.Validator
	reply, err = service.hydrateSnapshot(ctx, f.gdb, "fixture-after", viewer, request)
	if err != nil || reply.Outcomes[0].GetUnchanged() == nil || !reply.Outcomes[0].GetUnchanged().Cache.NoStore {
		t.Fatalf("known validator not revalidated: %+v/%v", reply, err)
	}
	request.Items[0].Resource.AuthorityNamespace = "social:public:mirror.example"
	reply, err = service.hydrateSnapshot(ctx, f.gdb, "fixture-after", viewer, request)
	if err != nil || reply.Outcomes[0].GetUnavailable() == nil {
		t.Fatalf("mirror substituted original authority: %+v/%v", reply, err)
	}
	request.Items[0].Resource.AuthorityNamespace = "social:public:original.example"
	seedBlock(t, f, 1, 2)
	reply, err = service.hydrateSnapshot(ctx, f.gdb, "fixture-revoked", viewer, request)
	if err != nil || reply.Outcomes[0].GetUnavailable() == nil {
		t.Fatalf("known content validator bypassed revoke: %+v/%v", reply, err)
	}
	data, err := proto.Marshal(reply)
	if err != nil || len(data) > 20 {
		t.Fatalf("unavailable outcome retained resource/content: %x/%v", data, err)
	}
}

func TestPublicSearchRejectsWrongFiltersAndPrivateReferences(t *testing.T) {
	for _, request := range []*searchpb.QueryIntent{
		{Text: "query", Suggestions: true},
		{Text: "query", ConversationId: "conversation"},
		{Text: "query", AttachmentNamesOnly: true},
		{Text: "query", Limit: 101},
		{Text: "query", Scopes: []searchpb.SearchScope{searchpb.SearchScope_SEARCH_SCOPE_FEDERATION}},
	} {
		if _, _, err := validatePublicSearchQuery(request); err == nil {
			t.Fatalf("unsupported request accepted: %+v", request)
		}
	}
	for _, ref := range []*searchpb.ResourceRef{
		{Kind: "social-post", Id: "private-ulid", AuthorityNamespace: "social:public:original.example"},
		{Kind: "social-comment", Id: "12", AuthorityNamespace: "social:public:original.example"},
		{Kind: "social-post", Id: "001", AuthorityNamespace: "social:public:original.example"},
		{Kind: "message", Id: "12", AuthorityNamespace: "social:public:original.example"},
	} {
		if _, valid := publicSearchRefID(ref); valid {
			t.Fatalf("private/noncanonical reference accepted: %+v", ref)
		}
	}
}
