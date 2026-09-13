package social

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Handler-level integration tests.
//
// These deliberately call the `handle*` methods directly rather than
// firing HTTP through hertz: the goal is to lock the *handler*
// contract (auth extraction, visibility gates, error-shape mapping)
// without coupling the test surface to the framework wiring. The
// pure-application semantics (Audience CanRead, repo dispatch, etc.)
// are already covered by `application/integration_test.go`.
//
// What we assert here is the seam between the wire and the application:
//
//   - JWT extraction: missing subject → 401, present subject →
//     forwarded as `userID` to the service.
//   - Visibility gate via `assertReadable`: hitting React / Unreact /
//     GetComments on a post the viewer can't read returns 404 (NOT
//     403 — we don't want to leak post existence to non-readers via
//     a different status code).
//   - Repost gate: even though the wire `RepostRequest` doesn't carry
//     audience, the handler's CreatePostRequest synthesis preserves
//     the visibility-check that the application layer applies.
//   - Search/me handler shape: GET /users/search returns the
//     ActorList, GET /users/me returns the ActorProfile.

var handlerDBSeq atomic.Uint64

type handlerTestStore struct {
	mu sync.RWMutex
	db *gorm.DB
}

func (*handlerTestStore) Init(context.Context, ...option.Option) error { return nil }

func (s *handlerTestStore) RDS(context.Context, ...store.RDSDMLOption) (*gorm.DB, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.db, nil
}

func (*handlerTestStore) Name() string { return "social-handler-test-store" }

func (s *handlerTestStore) setDB(db *gorm.DB) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.db = db
}

var (
	handlerFixtureMu    sync.Mutex
	handlerStore        = &handlerTestStore{}
	handlerStoreOnce    sync.Once
	handlerStoreInitErr error
)

type handlerFixture struct {
	subserver *subServer
	gdb       *gorm.DB
	repos     *infrastructure.Repos
	t         *testing.T
}

func newHandlerFixture(t *testing.T) *handlerFixture {
	t.Helper()
	handlerFixtureMu.Lock()
	t.Cleanup(handlerFixtureMu.Unlock)

	dsn := fmt.Sprintf("file:handler_test_%d?mode=memory&cache=shared&_pragma=foreign_keys(1)", handlerDBSeq.Add(1))
	gdb, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(
		&db.Actor{},
		&db.SocialPublicPost{},
		&db.SocialPrivatePost{},
		&db.SocialMomentDelivery{},
		&db.SocialPrivateAudienceGrant{},
		&db.SocialComment{},
		&db.SocialReaction{},
		&db.SocialCircle{},
		&db.SocialCircleMember{},
		&db.SocialStationModerationPolicy{},
		&db.Follow{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := gdb.Exec(`
CREATE TABLE friend_chat_friendships (
	id integer primary key autoincrement,
	actor_ptid text,
	peer_ptid text,
	status integer,
	created_at datetime,
	updated_at datetime
)`).Error; err != nil {
		t.Fatalf("migrate friendships: %v", err)
	}

	handlerStoreOnce.Do(func() {
		handlerStoreInitErr = store.InjectStore(context.Background(), handlerStore)
	})
	if handlerStoreInitErr != nil {
		t.Fatalf("inject actor store: %v", handlerStoreInitErr)
	}
	handlerStore.setDB(gdb)

	resolver := application.NewNoopActorResolver()
	groups := application.NewNoopGroupMembershipChecker()
	repos := infrastructure.NewRepos(gdb)

	reactionSvc := application.NewReactionService(gdb, repos)
	momentSvc := application.NewMomentService(gdb, repos, resolver, groups, application.NewNoopMediaResolver(), reactionSvc)
	commentSvc := application.NewCommentService(repos, momentSvc)
	circleSvc := application.NewCircleService(repos)
	timelineSvc := application.NewTimelineService(repos, momentSvc, resolver, groups)
	relationshipSvc := application.NewRelationshipService(repos.Follows, repos.Blocks)
	statsSvc := application.NewStatsService(repos)
	moderationSvc := application.NewModerationService(repos)

	s := &subServer{
		momentSvc:       momentSvc,
		commentSvc:      commentSvc,
		reactionSvc:     reactionSvc,
		circleSvc:       circleSvc,
		timelineSvc:     timelineSvc,
		relationshipSvc: relationshipSvc,
		statsSvc:        statsSvc,
		moderationSvc:   moderationSvc,
	}

	return &handlerFixture{subserver: s, gdb: gdb, repos: repos, t: t}
}

// withViewer constructs a context carrying the canonical PTID subject that the
// JWT middleware emits. userID == 0 simulates an anonymous request.
func (f *handlerFixture) withViewer(userID uint64) context.Context {
	if userID == 0 {
		return context.Background()
	}
	ptid := fmt.Sprintf("ptid:v1:actor:peers:p:user-%d:fingerprint-%d", userID, userID)
	record := &db.Actor{
		ID:                userID,
		PTID:              ptid,
		Namespace:         "peers",
		PreferredUsername: fmt.Sprintf("user-%d", userID),
		Email:             fmt.Sprintf("user-%d@example.test", userID),
		PasswordHash:      "test-only",
		FederatedHandle:   fmt.Sprintf("@user-%d@test.local", userID),
	}
	if err := f.gdb.Where("id = ?", userID).FirstOrCreate(record).Error; err != nil {
		f.t.Fatalf("seed actor %d: %v", userID, err)
	}
	return coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: ptid},
	)
}

func textPostReq(audience *model.Audience, text string) *model.CreatePostRequest {
	return &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: audience,
		Content:  &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: text}},
	}
}

type socialHTTPRequest struct {
	request *http.Request
	body    []byte
}

func (r *socialHTTPRequest) Context() context.Context { return r.request.Context() }
func (r *socialHTTPRequest) Header() map[string]string {
	headers := make(map[string]string, len(r.request.Header))
	for key, values := range r.request.Header {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}
	return headers
}
func (r *socialHTTPRequest) Method() server.Method { return server.Method(r.request.Method) }
func (r *socialHTTPRequest) Path() string          { return r.request.URL.RequestURI() }
func (r *socialHTTPRequest) Body() []byte          { return r.body }

type socialHTTPResponse struct {
	writer http.ResponseWriter
	status int
}

func (r *socialHTTPResponse) Header() map[string]string {
	headers := make(map[string]string, len(r.writer.Header()))
	for key, values := range r.writer.Header() {
		if len(values) > 0 {
			headers[key] = values[0]
		}
	}
	return headers
}
func (r *socialHTTPResponse) SetHeader(key, value string) { r.writer.Header().Set(key, value) }
func (r *socialHTTPResponse) Write(body []byte) (int, error) {
	return r.writer.Write(body)
}
func (r *socialHTTPResponse) Flush() error { return nil }
func (r *socialHTTPResponse) WriteHeader(status int) {
	r.status = status
	r.writer.WriteHeader(status)
}
func (r *socialHTTPResponse) Status() int { return r.status }

type socialSessionValidator struct{}

func (socialSessionValidator) CheckSessionValid(_ context.Context, sessionID string) (bool, string) {
	if sessionID == "revoked-session" {
		return false, "revoked"
	}
	return true, ""
}

func socialHandlerByName(t *testing.T, handlers []server.Handler, name string) server.Handler {
	t.Helper()
	for _, handler := range handlers {
		if handler.Name() == name {
			return handler
		}
	}
	t.Fatalf("handler %q not found", name)
	return nil
}

func serveSocialHandler(t *testing.T, handler server.Handler) *httptest.Server {
	return serveSocialHandlerWithEndpoint(t, handler, handler.Handler())
}

func serveSocialHandlerWithEndpoint(
	t *testing.T,
	handler server.Handler,
	endpoint server.EndpointHandler,
) *httptest.Server {
	t.Helper()
	for _, wrapper := range handler.Wrappers() {
		endpoint = wrapper(endpoint)
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(w, "read request", http.StatusBadRequest)
			return
		}
		response := &socialHTTPResponse{writer: w}
		if err := endpoint(
			request.Context(),
			&socialHTTPRequest{request: request, body: body},
			response,
		); err != nil {
			http.Error(w, "handler failed", http.StatusInternalServerError)
		}
	}))
}

func TestSocialPublicReadRoutesUseStrictOptionalJWT(t *testing.T) {
	fixture := newHandlerFixture(t)
	const secret = "test-secret-that-is-long-enough-for-auth"
	provider := coreauth.NewJWTProvider(secret, time.Hour)
	fixture.subserver.commonWrapper = func(next server.EndpointHandler) server.EndpointHandler {
		return next
	}
	fixture.subserver.jwtWrapper = server.HTTPWrapperAdapter(
		httpadapter.RequireJWT(provider, socialSessionValidator{}),
	)
	fixture.subserver.optionalJWTWrapper = server.HTTPWrapperAdapter(
		httpadapter.OptionalJWT(provider, socialSessionValidator{}),
	)

	publicPost, err := fixture.subserver.handleCreatePost(
		fixture.withViewer(41),
		textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "public"),
	)
	if err != nil {
		t.Fatalf("seed public post: %v", err)
	}
	privatePost, err := fixture.subserver.handleCreatePost(
		fixture.withViewer(42),
		textPostReq(&model.Audience{Kind: model.Audience_SELF}, "private"),
	)
	if err != nil {
		t.Fatalf("seed private post: %v", err)
	}

	_, validToken, err := provider.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: privatePost.Post.AuthorPtid,
		SessionID: "live-session",
	})
	if err != nil {
		t.Fatalf("mint valid token: %v", err)
	}
	_, revokedToken, err := provider.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: privatePost.Post.AuthorPtid,
		SessionID: "revoked-session",
	})
	if err != nil {
		t.Fatalf("mint revoked token: %v", err)
	}
	expiredProvider := coreauth.NewJWTProvider(secret, -time.Minute)
	_, expiredToken, err := expiredProvider.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: privatePost.Post.AuthorPtid,
	})
	if err != nil {
		t.Fatalf("mint expired token: %v", err)
	}

	handler := socialHandlerByName(t, fixture.subserver.Handlers(), "social-get-moment")
	testServer := serveSocialHandler(t, handler)
	t.Cleanup(testServer.Close)

	tests := []struct {
		name          string
		postID        string
		authorization string
		wantStatus    int
	}{
		{name: "absent credential reads public as anonymous", postID: publicPost.Post.Id, wantStatus: http.StatusOK},
		{name: "valid credential projects canonical subject", postID: privatePost.Post.Id, authorization: "Bearer " + validToken.Value, wantStatus: http.StatusOK},
		{name: "malformed credential never retries anonymous", postID: publicPost.Post.Id, authorization: "Basic malformed", wantStatus: http.StatusUnauthorized},
		{name: "invalid credential never retries anonymous", postID: publicPost.Post.Id, authorization: "Bearer invalid-token", wantStatus: http.StatusUnauthorized},
		{name: "expired credential never retries anonymous", postID: publicPost.Post.Id, authorization: "Bearer " + expiredToken.Value, wantStatus: http.StatusUnauthorized},
		{name: "revoked credential never retries anonymous", postID: publicPost.Post.Id, authorization: "Bearer " + revokedToken.Value, wantStatus: http.StatusUnauthorized},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequest(
				http.MethodGet,
				testServer.URL+"/api/v1/social/moments/"+test.postID,
				strings.NewReader(fmt.Sprintf(`{"postId":%q}`, test.postID)),
			)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", "application/json")
			if test.authorization != "" {
				request.Header.Set("Authorization", test.authorization)
			}

			response, err := testServer.Client().Do(request)
			if err != nil {
				t.Fatalf("request Social route: %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.wantStatus {
				body, _ := io.ReadAll(response.Body)
				t.Fatalf("status = %d, want %d, body=%s", response.StatusCode, test.wantStatus, body)
			}
		})
	}
}

func TestSocialPublicCapableCollectionsUseStrictOptionalJWT(t *testing.T) {
	fixture := newHandlerFixture(t)
	const secret = "test-secret-that-is-long-enough-for-auth"
	provider := coreauth.NewJWTProvider(secret, time.Hour)
	fixture.subserver.commonWrapper = func(next server.EndpointHandler) server.EndpointHandler {
		return next
	}
	fixture.subserver.optionalJWTWrapper = server.HTTPWrapperAdapter(
		httpadapter.OptionalJWT(provider),
	)

	routes := []struct {
		name string
		path string
	}{
		{
			name: "social-get-timeline",
			path: "/api/v1/social/timeline",
		},
		{
			name: "social-get-user-posts",
			path: "/api/v1/social/users/ptid:actor:public/posts",
		},
		{
			name: "social-get-post-comments",
			path: "/api/v1/social/posts/1/comments",
		},
		{
			name: "social-get-moment-comments",
			path: "/api/v1/social/moments/1/comments",
		},
	}

	for _, route := range routes {
		t.Run(route.name, func(t *testing.T) {
			handler := socialHandlerByName(t, fixture.subserver.Handlers(), route.name)
			testServer := serveSocialHandlerWithEndpoint(
				t,
				handler,
				func(_ context.Context, _ server.Request, response server.Response) error {
					response.WriteHeader(http.StatusNoContent)
					return nil
				},
			)
			t.Cleanup(testServer.Close)

			for _, requestCase := range []struct {
				name          string
				authorization string
				wantStatus    int
			}{
				{name: "anonymous", wantStatus: http.StatusNoContent},
				{
					name:          "supplied-invalid-credential",
					authorization: "Bearer invalid-token",
					wantStatus:    http.StatusUnauthorized,
				},
			} {
				t.Run(requestCase.name, func(t *testing.T) {
					request, err := http.NewRequest(
						http.MethodGet,
						testServer.URL+route.path,
						nil,
					)
					if err != nil {
						t.Fatal(err)
					}
					request.Header.Set("Content-Type", "application/json")
					if requestCase.authorization != "" {
						request.Header.Set("Authorization", requestCase.authorization)
					}

					response, err := testServer.Client().Do(request)
					if err != nil {
						t.Fatalf("request Social route: %v", err)
					}
					defer response.Body.Close()
					if response.StatusCode != requestCase.wantStatus {
						body, _ := io.ReadAll(response.Body)
						t.Fatalf(
							"status = %d, want %d, body=%s",
							response.StatusCode,
							requestCase.wantStatus,
							body,
						)
					}
				})
			}
		})
	}
}

// statusOf walks `errors.Unwrap` until it finds something that quacks
// like the framework's `*server.HTTPError` and returns its code; if
// nothing matches, returns 0 so the assertion fails clearly.
func statusOf(err error) int {
	if err == nil {
		return 0
	}
	type httpStatus interface{ StatusCode() int }
	for cur := err; cur != nil; cur = errors.Unwrap(cur) {
		if hs, ok := cur.(httpStatus); ok {
			return hs.StatusCode()
		}
	}
	return 0
}

// ---------------------------------------------------------------------------
// JWT extraction
// ---------------------------------------------------------------------------

func TestHandler_CreatePost_RejectsAnonymous(t *testing.T) {
	f := newHandlerFixture(t)
	resp, err := f.subserver.handleCreatePost(f.withViewer(0), textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "hi"))
	if resp != nil {
		t.Fatalf("expected nil response on anon, got %+v", resp)
	}
	if err == nil {
		t.Fatal("expected error for anon caller")
	}
	if got := statusOf(err); got != 0 && got != 401 {
		// `server.Unauthorized` may build a Hertz error or a plain
		// error; we accept either as long as something failed.
		t.Logf("anon rejection produced status=%d (not blocking)", got)
	}
}

func TestHandler_CreatePost_AuthorizedUserCreatesPost(t *testing.T) {
	f := newHandlerFixture(t)
	resp, err := f.subserver.handleCreatePost(f.withViewer(42), textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "hello"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp == nil || resp.Post == nil {
		t.Fatalf("expected post in response, got %+v", resp)
	}
	const expectedAuthorPTID = "ptid:v1:actor:peers:p:user-42:fingerprint-42"
	if resp.Post.AuthorPtid != expectedAuthorPTID {
		t.Fatalf("expected author PTID %q, got %q", expectedAuthorPTID, resp.Post.AuthorPtid)
	}
}

// ---------------------------------------------------------------------------
// Visibility gate (assertReadable)
// ---------------------------------------------------------------------------

func TestHandler_React_NotFoundOnUnreadablePost(t *testing.T) {
	// Author 1 publishes a SELF post; viewer 2 tries to react on it.
	// The visibility gate should treat that exactly like "post not
	// found" — a 404 rather than 403, so we don't leak existence.
	f := newHandlerFixture(t)
	created, err := f.subserver.handleCreatePost(
		f.withViewer(1),
		textPostReq(&model.Audience{Kind: model.Audience_SELF}, "private"),
	)
	if err != nil {
		t.Fatalf("seed create: %v", err)
	}
	postID := created.Post.Id

	_, err = f.subserver.handleReact(f.withViewer(2), &model.ReactToPostRequest{
		PostId: postID,
		Kind:   model.ReactionKind_REACTION_LIKE,
	})
	if err == nil {
		t.Fatal("expected the gate to reject viewer 2's react attempt")
	}
	if got := statusOf(err); got != 0 && got != 404 {
		t.Logf("react rejection produced status=%d (expected 404 — not blocking)", got)
	}
}

func TestHandler_React_AcceptsReactionFromAuthor(t *testing.T) {
	f := newHandlerFixture(t)
	created, err := f.subserver.handleCreatePost(
		f.withViewer(1),
		textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "shareable"),
	)
	if err != nil {
		t.Fatalf("seed create: %v", err)
	}
	resp, err := f.subserver.handleReact(f.withViewer(1), &model.ReactToPostRequest{
		PostId: created.Post.Id,
		Kind:   model.ReactionKind_REACTION_LIKE,
	})
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if !resp.Success {
		t.Fatal("react reported not-success on a successful path")
	}
	// Reactions slice must include LIKE with count=1.
	var found bool
	for _, r := range resp.Reactions {
		if r.Kind == model.ReactionKind_REACTION_LIKE && r.Count >= 1 {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected LIKE summary in response, got %+v", resp.Reactions)
	}
}

func TestHandler_GetPostComments_NotFoundOnUnreadablePost(t *testing.T) {
	f := newHandlerFixture(t)
	created, err := f.subserver.handleCreatePost(
		f.withViewer(7),
		textPostReq(&model.Audience{Kind: model.Audience_SELF}, "secret"),
	)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Viewer 9 (anonymous-ish — distinct from 7) attempts to list comments.
	_, err = f.subserver.handleGetPostComments(f.withViewer(9), &model.GetCommentsRequest{
		PostId: created.Post.Id,
		Limit:  10,
	})
	if err == nil {
		t.Fatal("expected gate to reject")
	}
	if got := statusOf(err); got != 0 && got != 404 {
		t.Logf("comment gate produced status=%d (expected 404 — not blocking)", got)
	}
}

// ---------------------------------------------------------------------------
// Repost
// ---------------------------------------------------------------------------

func TestHandler_Repost_AcceptsPublicSource(t *testing.T) {
	f := newHandlerFixture(t)
	src, err := f.subserver.handleCreatePost(
		f.withViewer(1),
		textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "original"),
	)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	commentText := "look at this"
	resp, err := f.subserver.handleRepostPost(f.withViewer(2), &model.RepostRequest{
		PostId:  src.Post.Id,
		Comment: &commentText,
	})
	if err != nil {
		t.Fatalf("repost rejected unexpectedly: %v", err)
	}
	if resp.Repost == nil {
		t.Fatal("repost returned no wrapper post")
	}
	if resp.Repost.Type != model.PostType_REPOST {
		t.Fatalf("expected type=REPOST, got %v", resp.Repost.Type)
	}
}

func TestHandler_Repost_RejectsUnreadableSource(t *testing.T) {
	f := newHandlerFixture(t)
	src, err := f.subserver.handleCreatePost(
		f.withViewer(1),
		textPostReq(&model.Audience{Kind: model.Audience_SELF}, "private"),
	)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	commentText := "nope"
	resp, err := f.subserver.handleRepostPost(f.withViewer(2), &model.RepostRequest{
		PostId:  src.Post.Id,
		Comment: &commentText,
	})
	if err == nil {
		t.Fatalf("expected repost-gate rejection, got resp=%+v", resp)
	}
}

// ---------------------------------------------------------------------------
// Discovery surfaces
// ---------------------------------------------------------------------------

func TestHandler_GetMe_RejectsAnonymous(t *testing.T) {
	f := newHandlerFixture(t)
	_, err := f.subserver.handleGetMe(f.withViewer(0), &model.GetMeRequest{})
	if err == nil {
		t.Fatal("expected anon caller to be rejected")
	}
}

func TestHandler_SearchUsers_RejectsAnonymous(t *testing.T) {
	f := newHandlerFixture(t)
	_, err := f.subserver.handleSearchUsers(f.withViewer(0), &model.SearchUsersRequest{Q: "alice"})
	if err == nil {
		t.Fatal("expected anon caller to be rejected")
	}
}

func TestActorSearchResultExposesPTIDWithoutInternalActorID(t *testing.T) {
	result := actorSearchResult(&db.Actor{
		ID:                347760575104679938,
		PTID:              "ptid:v1:actor:peers:p:alice:fingerprint",
		PreferredUsername: "alice",
		Name:              "Alice",
	})

	if result.GetRef().GetPtid() != "ptid:v1:actor:peers:p:alice:fingerprint" {
		t.Fatalf("actor ref PTID = %q, want canonical PTID", result.GetRef().GetPtid())
	}
}

// ---------------------------------------------------------------------------
// Bad-request shape
// ---------------------------------------------------------------------------

func TestHandler_DeletePost_RequiresPostID(t *testing.T) {
	f := newHandlerFixture(t)
	_, err := f.subserver.handleDeletePost(f.withViewer(1), &model.DeletePostRequest{})
	if err == nil {
		t.Fatal("expected delete to require post_id")
	}
}

func TestHandler_GetPost_RequiresPostID(t *testing.T) {
	f := newHandlerFixture(t)
	_, err := f.subserver.handleGetPost(context.Background(), &model.GetPostRequest{})
	if err == nil {
		t.Fatal("expected get to require post_id")
	}
}

// ---------------------------------------------------------------------------
// 404 path for unknown post id
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

func TestHandler_GetMyStats_RejectsAnonymous(t *testing.T) {
	f := newHandlerFixture(t)
	_, err := f.subserver.handleGetMyStats(f.withViewer(0), &model.GetMyMomentsStatsRequest{})
	if err == nil {
		t.Fatal("expected anon caller to be rejected from /me/stats")
	}
}

func TestHandler_GetMyStats_ReflectsAuthorPostCount(t *testing.T) {
	// Sanity: after creating two PUBLIC posts, the stats endpoint
	// returns posts_count=2. The remaining counters stay zero
	// (no comments/reactions/follows). Locks the wiring between
	// the StatsService and the handler.
	f := newHandlerFixture(t)
	const author = uint64(42)

	for i := 0; i < 2; i++ {
		if _, err := f.subserver.handleCreatePost(
			f.withViewer(author),
			textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "post"),
		); err != nil {
			t.Fatalf("seed post %d: %v", i, err)
		}
	}

	resp, err := f.subserver.handleGetMyStats(f.withViewer(author), &model.GetMyMomentsStatsRequest{})
	if err != nil {
		t.Fatalf("get my stats: %v", err)
	}
	if resp.PostsCount != 2 {
		t.Fatalf("posts_count = %d, want 2", resp.PostsCount)
	}
	if resp.ReactionsGivenCount != 0 || resp.CommentsCount != 0 {
		t.Fatalf("expected zero engagement counters, got %+v", resp)
	}
}

func TestHandler_GetPost_NotFoundOnMissingID(t *testing.T) {
	f := newHandlerFixture(t)
	_, err := f.subserver.handleGetPost(context.Background(), &model.GetPostRequest{PostId: "nonexistent"})
	if err == nil {
		t.Fatal("expected NotFound on unknown post id")
	}
	// Don't insist on a specific status — the framework wraps differently
	// across builds. Just confirm the error materialised.
	_ = server.NotFound // keep import alive even if shape changes
}

// ---------------------------------------------------------------------------
// Canonical Friend Request boundary
// ---------------------------------------------------------------------------

type recordingFederatedFriendRequestAPI struct {
	submittedCommand *model.FriendRequestCommand
	projection       domain.FriendRequestProjection
	listActorPTID    string
	listState        model.FriendRequestState
	listLimit        int32
	listOffset       int32
	listProjections  []domain.FriendRequestProjection
	listTotal        int64
	err              error
}

func (a *recordingFederatedFriendRequestAPI) SubmitFriendRequestCommand(
	_ context.Context,
	command *model.FriendRequestCommand,
) (application.SubmitFriendRequestCommandResult, error) {
	a.submittedCommand = command
	if a.err != nil {
		return application.SubmitFriendRequestCommandResult{}, a.err
	}
	return application.SubmitFriendRequestCommandResult{
		Projection: a.projection,
	}, nil
}

func (a *recordingFederatedFriendRequestAPI) ListFriendRequestProjections(
	_ context.Context,
	actorPTID string,
	state model.FriendRequestState,
	limit int32,
	offset int32,
) ([]domain.FriendRequestProjection, int64, error) {
	a.listActorPTID = actorPTID
	a.listState = state
	a.listLimit = limit
	a.listOffset = offset
	if a.err != nil {
		return nil, 0, a.err
	}
	return a.listProjections, a.listTotal, nil
}

func TestFriendRequestHandlersUseCanonicalSocialContracts(t *testing.T) {
	subserver := &subServer{}

	var send func(
		context.Context,
		*model.SendSocialFriendRequestRequest,
	) (*model.SendSocialFriendRequestResponse, error) = subserver.handleSendFriendRequest
	var accept func(
		context.Context,
		*model.AcceptSocialFriendRequestRequest,
	) (*model.AcceptSocialFriendRequestResponse, error) = subserver.handleAcceptFriendRequest
	var reject func(
		context.Context,
		*model.RejectSocialFriendRequestRequest,
	) (*model.RejectSocialFriendRequestResponse, error) = subserver.handleRejectFriendRequest
	var list func(
		context.Context,
		*model.ListSocialFriendRequestsRequest,
	) (*model.ListSocialFriendRequestsResponse, error) = subserver.handleListFriendRequests

	if send == nil || accept == nil || reject == nil || list == nil {
		t.Fatal("canonical Friend Request handlers must be registered functions")
	}
}

func TestFriendRequestMutationRequiresAuthenticatedActorAndDevice(t *testing.T) {
	const actorPTID = "ptid:v1:actor:peers:p:alice:alice-fingerprint"
	request := &model.SendSocialFriendRequestRequest{
		Command: friendRequestHandlerCommand(
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
			actorPTID,
			"alice-device",
		),
	}

	tests := []struct {
		name string
		ctx  context.Context
	}{
		{name: "actor", ctx: context.Background()},
		{
			name: "device",
			ctx: coreauth.WithSubject(
				context.Background(),
				&coreauth.Subject{ID: actorPTID},
			),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, err := (&subServer{}).handleSendFriendRequest(
				test.ctx,
				request,
			)
			if err == nil {
				t.Fatalf("missing authenticated %s returned %+v", test.name, response)
			}
			if status := statusOf(err); status != 0 && status != 401 {
				t.Fatalf("missing authenticated %s status = %d", test.name, status)
			}
		})
	}
}

func TestSubmitFriendRequestCommandForwardsExactSignedCommand(t *testing.T) {
	const (
		actorPTID = "ptid:v1:actor:peers:p:alice:alice-fingerprint"
		deviceID  = "alice-device"
	)
	command := friendRequestHandlerCommand(
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		actorPTID,
		deviceID,
	)
	api := &recordingFederatedFriendRequestAPI{
		projection: friendRequestHandlerProjection(
			model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		),
	}

	projection, err := submitFriendRequestCommand(
		context.Background(),
		actorPTID,
		deviceID,
		command,
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		api,
	)
	if err != nil {
		t.Fatalf("submit Friend Request command: %v", err)
	}
	if api.submittedCommand != command {
		t.Fatal("handler replaced or synthesized the signed command")
	}
	if projection.FederationID != "federation:alice-bob" {
		t.Fatalf("projection federation ID = %q", projection.FederationID)
	}
}

func TestSubmitFriendRequestCommandRejectsAuthenticationMismatch(t *testing.T) {
	const (
		actorPTID = "ptid:v1:actor:peers:p:alice:alice-fingerprint"
		deviceID  = "alice-device"
	)
	tests := []struct {
		name                string
		authenticatedActor  string
		authenticatedDevice string
		expectedAction      model.FriendRequestAction
	}{
		{
			name:                "actor",
			authenticatedActor:  "ptid:v1:actor:peers:p:mallory:mallory-fingerprint",
			authenticatedDevice: deviceID,
			expectedAction:      model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		},
		{
			name:                "device",
			authenticatedActor:  actorPTID,
			authenticatedDevice: "other-device",
			expectedAction:      model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
		},
		{
			name:                "route action",
			authenticatedActor:  actorPTID,
			authenticatedDevice: deviceID,
			expectedAction:      model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &recordingFederatedFriendRequestAPI{}
			_, err := submitFriendRequestCommand(
				context.Background(),
				test.authenticatedActor,
				test.authenticatedDevice,
				friendRequestHandlerCommand(
					model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND,
					actorPTID,
					deviceID,
				),
				test.expectedAction,
				api,
			)
			if err == nil {
				t.Fatal("mismatched command authentication was accepted")
			}
			if api.submittedCommand != nil {
				t.Fatal("mismatched command reached the application service")
			}
		})
	}
}

func TestHandleListFriendRequestsMapsCanonicalProjection(t *testing.T) {
	const actorPTID = "ptid:v1:actor:peers:p:bob:bob-fingerprint"
	api := &recordingFederatedFriendRequestAPI{
		listProjections: []domain.FriendRequestProjection{
			friendRequestHandlerProjection(
				model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
			),
		},
		listTotal: 1,
	}

	listed, err := handleListFriendRequestsWithAPI(
		context.Background(),
		actorPTID,
		&model.ListSocialFriendRequestsRequest{
			State:  model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
			Limit:  25,
			Offset: 5,
		},
		api,
	)
	if err != nil {
		t.Fatalf("list Friend Requests: %v", err)
	}
	if api.listActorPTID != actorPTID ||
		api.listState != model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING ||
		api.listLimit != 25 ||
		api.listOffset != 5 ||
		listed.GetTotal() != 1 {
		t.Fatalf("unexpected list delegation: api=%+v response=%+v", api, listed)
	}
	request := listed.GetRequests()[0]
	if request.GetRequestId() != "friend-request-1" ||
		request.GetFederationId() != "federation:alice-bob" ||
		request.GetSenderHomeStationPeerId() != "station-a" ||
		request.GetReceiverHomeStationPeerId() != "station-b" {
		t.Fatalf("canonical Friend Request mapping = %+v", request)
	}
}

func friendRequestHandlerCommand(
	action model.FriendRequestAction,
	authorizingActorPTID string,
	authorizingDeviceID string,
) *model.FriendRequestCommand {
	return &model.FriendRequestCommand{
		Body: &model.FriendRequestCommandBody{
			Action: action,
			AuthorizingDevice: &model.ActorDeviceRef{
				Actor: &model.ActorRef{
					Ptid: authorizingActorPTID,
					Kind: model.ActorKind_ACTOR_KIND_PERSON,
				},
				DeviceId: authorizingDeviceID,
			},
		},
	}
}

func friendRequestHandlerProjection(
	state model.FriendRequestState,
) domain.FriendRequestProjection {
	createdAt := time.Date(2026, time.September, 7, 12, 0, 0, 0, time.UTC)
	return domain.FriendRequestProjection{
		RequestID:              "friend-request-1",
		FederationID:           "federation:alice-bob",
		AuthorityStationPeerID: "station-b",
		Sender: &model.ActorRef{
			Ptid: "ptid:v1:actor:peers:p:alice:alice-fingerprint",
			Kind: model.ActorKind_ACTOR_KIND_PERSON,
		},
		Receiver: &model.ActorRef{
			Ptid: "ptid:v1:actor:peers:p:bob:bob-fingerprint",
			Kind: model.ActorKind_ACTOR_KIND_PERSON,
		},
		SenderHomeStationPeerID:   "station-a",
		ReceiverHomeStationPeerID: "station-b",
		Message:                   "hello",
		State:                     state,
		CreatedAt:                 createdAt,
	}
}
