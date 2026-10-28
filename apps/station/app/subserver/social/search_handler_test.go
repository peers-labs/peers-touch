package social

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"

	searchpb "github.com/peers-labs/peers-touch/station/app/model/search"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

func TestSocialSearchAuthenticatedTypedRoutesAndNoStoreErrors(t *testing.T) {
	fixture := newHandlerFixture(t)
	fixture.subserver.commonWrapper = func(next server.EndpointHandler) server.EndpointHandler { return next }
	var err error
	fixture.subserver.publicSearchSvc, err = application.NewPublicSearchService(fixture.gdb)
	if err != nil {
		t.Fatal(err)
	}
	provider := coreauth.NewJWTProvider("social-search-test-signing-material", time.Hour)
	fixture.subserver.privateContentJWTWrapper = server.HTTPWrapperAdapter(
		httpadapter.RequireStructuredJWT(provider, int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED), false),
	)
	_, token, err := provider.Authenticate(context.Background(), coreauth.Credentials{SubjectID: "authenticated-viewer"})
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct {
		name, path string
		request    proto.Message
	}{
		{"social-search-query", routeSocialSearchQuery, &searchpb.QueryIntent{Text: "query"}},
		{"social-search-hydrate", routeSocialSearchHydrate, &searchpb.HydrationRequest{Items: []*searchpb.HydrationItem{{
			ItemId: "post", Resource: &searchpb.ResourceRef{Kind: "social-post", Id: "1", AuthorityNamespace: "social:public:original.example"},
		}}}},
		{"social-search-resolve", routeSocialSearchResolve, &searchpb.ResolveRequest{
			SourceId: application.PublicSearchSourceID, Resource: &searchpb.ResourceRef{Kind: "social-post", Id: "1", AuthorityNamespace: "social:public:original.example"},
		}},
	} {
		t.Run(route.name, func(t *testing.T) {
			handler := socialHandlerByName(t, fixture.subserver.Handlers(), route.name)
			testServer := serveSocialHandler(t, handler)
			defer testServer.Close()
			body, err := proto.Marshal(route.request)
			if err != nil {
				t.Fatal(err)
			}
			for _, authenticated := range []bool{false, true} {
				request, err := http.NewRequest(http.MethodPost, testServer.URL+route.path, bytes.NewReader(body))
				if err != nil {
					t.Fatal(err)
				}
				request.Header.Set("Content-Type", "application/protobuf")
				if authenticated {
					request.Header.Set("Authorization", "Bearer "+token.Value)
				}
				response, err := testServer.Client().Do(request)
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				wantStatus := http.StatusUnauthorized
				if authenticated {
					wantStatus = http.StatusServiceUnavailable // SQLite has no production MVCC revision.
				}
				if response.StatusCode != wantStatus || response.Header.Get("Cache-Control") != "no-store" ||
					response.Header.Get("Content-Type") != server.CanonicalProtobufContentType {
					t.Fatalf("status/media/no-store: %d %+v", response.StatusCode, response.Header)
				}
				var errorResponse model.ErrorResponse
				if err := proto.Unmarshal(data, &errorResponse); err != nil {
					t.Fatal(err)
				}
				if authenticated && errorResponse.Details["search_code"] != searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_UNAVAILABLE.String() {
					t.Fatalf("lost stable Search code: %+v", &errorResponse)
				}
			}
		})
	}
}

func TestSocialCommentsTypedAnchorWindow(t *testing.T) {
	fixture := newHandlerFixture(t)
	ctx := fixture.withViewer(1)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := fixture.gdb.Create(&db.SocialPublicPost{ID: 1001, AuthorID: 1, AudienceKind: "PUBLIC", Type: "TEXT",
		TextBody: "original", CreatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 130; i++ {
		if err := fixture.gdb.Create(&db.SocialComment{ID: uint64(2001 + i), PostID: 1001, PostClass: "public",
			AuthorID: 1, TextBody: "reply", CreatedAt: now.Add(time.Duration(i) * time.Minute)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	response, err := fixture.subserver.handleListMomentComments(ctx, &privatecontentpb.ListMomentCommentsRequest{
		PostId: "1001", AnchorCommentId: "2001", Limit: 20,
	})
	if err != nil || len(response.GetComments()) != 1 || response.Comments[0].GetMetadata().GetCommentId() != "2001" {
		t.Fatalf("typed original anchor response: %+v/%v", response, err)
	}
	_, err = fixture.subserver.handleListMomentComments(ctx, &privatecontentpb.ListMomentCommentsRequest{
		PostId: "1001", Cursor: "cursor", AnchorCommentId: "2001", Limit: 20,
	})
	var handlerError *server.HandlerError
	if !errors.As(err, &handlerError) || handlerError.Code != http.StatusBadRequest {
		t.Fatalf("cursor+anchor status: %v", err)
	}
}
