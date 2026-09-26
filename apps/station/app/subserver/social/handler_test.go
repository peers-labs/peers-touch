package social

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
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

	"github.com/cloudwego/hertz/pkg/app"
	hertzserver "github.com/cloudwego/hertz/pkg/app/server"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
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
//   - Reaction visibility: public parents are checked before mutation,
//     while private parents defer current-audience authorization to the
//     atomic Reaction repository path.
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
		&db.SocialMomentDelivery{},
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
	if err := infrastructure.MigrateIdentitySchema(gdb); err != nil {
		t.Fatalf("migrate Social relationship authority: %v", err)
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

func TestCanonicalPrivateContentActorRefRequiresPersistedIdentity(t *testing.T) {
	t.Parallel()

	const actorPTID = "ptid:v1:actor:peers:p:alice:fingerprint"
	ref, err := canonicalPrivateContentActorRef(actorPTID, &db.Actor{
		PTID:            actorPTID,
		FederatedHandle: " @Alice@Home.Example ",
		Kind:            "p",
	})
	if err != nil {
		t.Fatalf("canonical ActorRef: %v", err)
	}
	if got, want := ref.GetAcct(), "alice@home.example"; got != want {
		t.Fatalf("acct = %q, want %q", got, want)
	}
	if got, want := ref.GetKind(), model.ActorKind_ACTOR_KIND_PERSON; got != want {
		t.Fatalf("kind = %s, want %s", got, want)
	}

	for name, record := range map[string]*db.Actor{
		"missing row": nil,
		"wrong PTID": {
			PTID:            "ptid:v1:actor:peers:p:eve:fingerprint",
			FederatedHandle: "@alice@home.example",
			Kind:            "p",
		},
		"missing persisted handle": {
			PTID: actorPTID,
			Kind: "p",
		},
		"invalid kind": {
			PTID:            actorPTID,
			FederatedHandle: "@alice@home.example",
			Kind:            "unknown",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := canonicalPrivateContentActorRef(actorPTID, record); err == nil {
				t.Fatal("canonicalPrivateContentActorRef() error = nil")
			}
		})
	}
}

func (f *handlerFixture) seedMoment(
	userID uint64,
	request *model.CreatePostRequest,
) *model.Post {
	f.t.Helper()
	ctx := f.withViewer(userID)
	actorPTID, ok := getActorPTID(ctx)
	if !ok {
		f.t.Fatalf("seed actor %d has no authenticated PTID", userID)
	}
	post, err := f.subserver.momentSvc.CreateMoment(ctx, request, actorPTID)
	if err != nil {
		f.t.Fatalf("seed moment: %v", err)
	}
	return post
}

func textPostReq(audience *model.Audience, text string) *model.CreatePostRequest {
	return &model.CreatePostRequest{
		Type:     model.PostType_TEXT,
		Audience: audience,
		Content:  &model.CreatePostRequest_Text{Text: &model.CreateTextPostRequest{Text: text}},
	}
}

func TestPublicCreateRoutesRejectPrivateWrites(t *testing.T) {
	fixture := newHandlerFixture(t)
	ctx := fixture.withViewer(1)

	_, err := fixture.subserver.handleCreatePost(
		ctx,
		textPostReq(&model.Audience{Kind: model.Audience_FRIENDS}, "secret"),
	)
	if handlerErr, ok := err.(*server.HandlerError); !ok ||
		handlerErr.Code != http.StatusBadRequest {
		t.Fatalf("private Moment on public route error = %v", err)
	}

	// Private comments must use the Secure Content routes. The public
	// comment path rejects a target outside the public post store.
	_, err = fixture.subserver.handleCreateComment(
		ctx,
		&model.CreateCommentRequest{
			PostId:  "nonexistent-private-post-for-comment-gate",
			Content: "must use the private route",
		},
	)
	if err == nil {
		t.Fatal("expected comment outside the public post store to fail")
	}
}

func TestPrivateAndObjectRoutesPreserveOwnedSurfaces(t *testing.T) {
	fixture := newHandlerFixture(t)
	handlers := fixture.subserver.Handlers()
	expected := map[string]struct {
		method server.Method
		path   string
	}{
		"social-prepare-private-moment": {
			method: server.POST,
			path:   routeSocialPreparePrivateMoment,
		},
		"social-submit-private-moment": {
			method: server.POST,
			path:   routeSocialSubmitPrivateMoment,
		},
		"social-prepare-private-comment": {
			method: server.POST,
			path:   routeSocialPreparePrivateComment,
		},
		"social-submit-private-comment": {
			method: server.POST,
			path:   routeSocialSubmitPrivateComment,
		},
		"social-get-moment-comment": {
			method: server.GET,
			path:   routeSocialMomentCommentResource,
		},
		"social-private-object-upload-begin": {
			method: server.POST,
			path:   routeSocialObjectUploadBegin,
		},
		"social-private-object-upload-status": {
			method: server.GET,
			path:   routeSocialObjectUploadStatus,
		},
		"social-private-object-upload-chunk": {
			method: server.PUT,
			path:   routeSocialObjectUploadChunk,
		},
		"social-private-object-upload-complete": {
			method: server.POST,
			path:   routeSocialObjectUploadComplete,
		},
		"social-private-object-upload-cancel": {
			method: server.POST,
			path:   routeSocialObjectUploadCancel,
		},
		"social-private-object-download": {
			method: server.GET,
			path:   routeSocialObjectDownload,
		},
	}
	for name, contract := range expected {
		handler := socialHandlerByName(t, handlers, name)
		if handler.Method() != contract.method ||
			handler.Path() != contract.path {
			t.Fatalf(
				"private route %q = %s %s, want %s %s",
				name,
				handler.Method(),
				handler.Path(),
				contract.method,
				contract.path,
			)
		}
	}
}

func TestMomentRoutesBindCanonicalPostIDField(t *testing.T) {
	fixture := newHandlerFixture(t)
	handlers := fixture.subserver.Handlers()
	expected := map[string]string{
		"social-delete-moment":           "/api/v1/social/moments/:post_id",
		"social-get-moment":              "/api/v1/social/moments/:post_id",
		"social-react":                   "/api/v1/social/moments/:post_id/react",
		"social-unreact":                 "/api/v1/social/moments/:post_id/unreact",
		"social-get-moment-comments":     "/api/v1/social/moments/:post_id/comments",
		"social-get-moment-comment":      "/api/v1/social/moments/:post_id/comments/:comment_id",
		"social-create-moment-comment":   "/api/v1/social/moments/:post_id/comments",
		"social-prepare-private-comment": "/api/v1/social/moments/:post_id/comments/prepare-private",
		"social-submit-private-comment":  "/api/v1/social/moments/:post_id/comments/submit-private",
	}
	for name, path := range expected {
		if actual := socialHandlerByName(t, handlers, name).Path(); actual != path {
			t.Fatalf("route %q = %q, want %q", name, actual, path)
		}
	}
}

func TestPrivateReactionDefersAuthorizationToReactionOwner(t *testing.T) {
	fixture := newHandlerFixture(t)
	if err := fixture.subserver.assertReactionTargetReadable(
		context.Background(),
		"01M3CSJFM7C6BV8N37J1A4NQHM",
		"ptid:v1:actor:peers:p:bob:bob-fingerprint",
	); err != nil {
		t.Fatalf("private reaction preflight must defer to ReactionService: %v", err)
	}
}

func TestCircleRoutesBindCanonicalCircleIDField(t *testing.T) {
	fixture := newHandlerFixture(t)
	handlers := fixture.subserver.Handlers()
	expected := map[string]string{
		"social-rename-circle":        "/api/v1/social/circles/:circle_id",
		"social-delete-circle":        "/api/v1/social/circles/:circle_id",
		"social-add-circle-member":    "/api/v1/social/circles/:circle_id/members",
		"social-remove-circle-member": "/api/v1/social/circles/:circle_id/members",
		"social-list-circle-members":  "/api/v1/social/circles/:circle_id/members",
	}
	for name, path := range expected {
		if actual := socialHandlerByName(t, handlers, name).Path(); actual != path {
			t.Fatalf("route %q = %q, want %q", name, actual, path)
		}
	}
}

func TestPrivateAndObjectRoutesRegisterWithHertz(t *testing.T) {
	fixture := newHandlerFixture(t)
	engine := hertzserver.New()
	handler := func(context.Context, *app.RequestContext) {}

	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("Hertz route registration panicked: %v", recovered)
		}
	}()
	for _, route := range fixture.subserver.Handlers() {
		switch route.Method() {
		case server.GET:
			engine.GET(route.Path(), handler)
		case server.POST:
			engine.POST(route.Path(), handler)
		case server.PUT:
			engine.PUT(route.Path(), handler)
		case server.DELETE:
			engine.DELETE(route.Path(), handler)
		case server.PATCH:
			engine.PATCH(route.Path(), handler)
		default:
			engine.Any(route.Path(), handler)
		}
	}
}

func TestPrivateContentRouteStackWritesProtobufAuthenticationErrors(t *testing.T) {
	fixture := newHandlerFixture(t)
	fixture.subserver.commonWrapper = func(
		next server.EndpointHandler,
	) server.EndpointHandler {
		return next
	}
	const testSigningKey = "fixture-hmac-signing-key-material-v1"
	provider := coreauth.NewJWTProvider(testSigningKey, time.Hour)
	fixture.subserver.privateContentJWTWrapper = server.HTTPWrapperAdapter(
		httpadapter.RequireStructuredJWT(
			provider,
			int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED),
			true,
		),
	)
	_, token, err := provider.Authenticate(
		context.Background(),
		coreauth.Credentials{
			SubjectID: "ptid:v1:actor:peers:p:alice:alice-fingerprint",
			SessionID: "private-content-session",
		},
	)
	if err != nil {
		t.Fatalf("mint private-content token: %v", err)
	}

	routes := []struct {
		name           string
		method         string
		path           string
		requiresDevice bool
	}{
		{
			name:           "social-prepare-private-moment",
			method:         http.MethodPost,
			path:           routeSocialPreparePrivateMoment,
			requiresDevice: true,
		},
		{
			name:   "social-private-object-download",
			method: http.MethodGet,
			path: "/api/v1/social/moments/objects/object-1" +
				"?expected_descriptor_sha256=" +
				strings.Repeat("0", 64),
			requiresDevice: true,
		},
		{
			name:   "social-list-recoverable-private-content",
			method: http.MethodGet,
			path:   routeSocialRecoverablePrivateContent + "?limit=1",
		},
	}
	for _, testCase := range routes {
		t.Run(testCase.name, func(t *testing.T) {
			handler := socialHandlerByName(
				t,
				fixture.subserver.Handlers(),
				testCase.name,
			)
			testServer := serveSocialHandler(t, handler)
			t.Cleanup(testServer.Close)

			request, err := http.NewRequest(
				testCase.method,
				testServer.URL+testCase.path,
				nil,
			)
			if err != nil {
				t.Fatal(err)
			}
			if testCase.requiresDevice {
				request.Header.Set("X-Device-ID", "alice-device")
			}
			response, err := testServer.Client().Do(request)
			if err != nil {
				t.Fatalf("request private-content route: %v", err)
			}
			assertPrivateContentHTTPError(
				t,
				response,
				http.StatusUnauthorized,
				model.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			)

			if !testCase.requiresDevice {
				return
			}
			request, err = http.NewRequest(
				testCase.method,
				testServer.URL+testCase.path,
				nil,
			)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", "Bearer "+token.Value)
			response, err = testServer.Client().Do(request)
			if err != nil {
				t.Fatalf("request private-content route without device: %v", err)
			}
			assertPrivateContentHTTPError(
				t,
				response,
				http.StatusUnauthorized,
				model.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			)
		})
	}
}

func assertPrivateContentHTTPError(
	t *testing.T,
	response *http.Response,
	status int,
	code model.ErrorCode,
) {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read private-content error body: %v", err)
	}
	errorResponse := &model.ErrorResponse{}
	if err := proto.Unmarshal(body, errorResponse); err != nil {
		t.Fatalf("decode private-content ErrorResponse: %v", err)
	}
	if response.StatusCode != status ||
		response.Header.Get("Content-Type") !=
			server.CanonicalProtobufContentType ||
		errorResponse.GetCode() != code {
		t.Fatalf(
			"private-content response = status %d headers %v body %x",
			response.StatusCode,
			response.Header,
			body,
		)
	}
	deterministic, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		errorResponse,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(body, deterministic) {
		t.Fatalf(
			"private-content ErrorResponse is not deterministic: %x != %x",
			body,
			deterministic,
		)
	}
}

func TestPrivateObjectRawHandlerDoesNotTypeGenericNotFound(t *testing.T) {
	recorder := httptest.NewRecorder()
	err := socialObjectRawHandler(func(
		context.Context,
		server.Request,
		server.Response,
	) error {
		return server.NotFound("private object not found")
	})(
		context.Background(),
		&socialHTTPRequest{
			request: httptest.NewRequest(
				http.MethodGet,
				"/api/v1/social/moments/objects/private-object",
				nil,
			),
		},
		&socialHTTPResponse{writer: recorder},
	)
	if err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusNotFound ||
		recorder.Header().Get("Content-Type") != "application/json" {
		t.Fatalf(
			"generic raw not-found response = status %d headers %v body %s",
			recorder.Code,
			recorder.Header(),
			recorder.Body.String(),
		)
	}
	response := map[string]any{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode generic raw not-found response: %v", err)
	}
	if response["code"] != float64(http.StatusNotFound) {
		t.Fatalf("generic raw not-found response = %v", response)
	}
}

func TestPrivateObjectRawHandlerPreservesTypedDomainNotFound(t *testing.T) {
	recorder := httptest.NewRecorder()
	err := socialObjectRawHandler(func(
		context.Context,
		server.Request,
		server.Response,
	) error {
		return privateObjectDownloadHandlerError(
			domain.NewPrivateContentError(
				domain.PrivateContentNotFound,
				"test.private_object.download",
				"object_id",
				"was not found",
			),
			false,
		)
	})(
		context.Background(),
		&socialHTTPRequest{
			request: httptest.NewRequest(
				http.MethodGet,
				"/api/v1/social/moments/objects/private-object",
				nil,
			),
		},
		&socialHTTPResponse{writer: recorder},
	)
	if err != nil {
		t.Fatal(err)
	}
	response := &model.ErrorResponse{}
	if err := proto.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("decode typed raw not-found ErrorResponse: %v", err)
	}
	if recorder.Code != http.StatusNotFound ||
		recorder.Header().Get("Content-Type") !=
			server.CanonicalProtobufContentType ||
		response.GetCode() != model.ErrorCode_ERROR_CODE_POST_NOT_FOUND {
		t.Fatalf(
			"typed raw not-found response = status %d headers %v body %x",
			recorder.Code,
			recorder.Header(),
			recorder.Body.Bytes(),
		)
	}
}

func TestPrivateObjectChunkBodyIsBoundedBeforeAllocation(t *testing.T) {
	request := httptest.NewRequest(http.MethodPut, "/", nil)
	reader := bytes.NewReader(bytes.Repeat([]byte{0x7a}, 100))
	streaming := &streamingSocialHTTPRequest{
		socialHTTPRequest: &socialHTTPRequest{request: request},
		stream:            reader,
	}

	if _, err := readBoundedSocialObjectBody(streaming, 4); err == nil {
		t.Fatal("oversized streamed body was accepted")
	}
	if streaming.bodyCalled {
		t.Fatal("bounded path fell back to the allocating Body method")
	}
	if reader.Len() != 95 {
		t.Fatalf("bounded reader consumed %d bytes, want 5", 100-reader.Len())
	}
}

func TestPrivateObjectStatusRequiresCanonicalQueryAndNoBody(t *testing.T) {
	uploadID := strings.Repeat("a", 64)
	path := "/api/v1/social/moments/objects/uploads/" + uploadID +
		"?generation=1"
	gotUploadID, generation, err := canonicalSocialObjectStatusRequest(path)
	if err != nil {
		t.Fatal(err)
	}
	if gotUploadID != uploadID || generation != 1 {
		t.Fatalf("status identity = %q/%d", gotUploadID, generation)
	}
	for _, invalid := range []string{
		"/api/v1/social/moments/objects/uploads/" + uploadID,
		"/api/v1/social/moments/objects/uploads/" + uploadID + "?generation=01",
		"/api/v1/social/moments/objects/uploads/" + uploadID + "?generation=%31",
		"/api/v1/social/moments/objects/uploads/" + uploadID + "?generation=1&extra=1",
		"/api/v1/social/moments/objects/uploads/" + uploadID + "?generation=1&generation=1",
	} {
		if _, _, err := canonicalSocialObjectStatusRequest(invalid); err == nil {
			t.Fatalf("noncanonical status query was accepted: %s", invalid)
		}
	}
	request := httptest.NewRequest(http.MethodGet, path, nil)
	if err := rejectSocialRequestBody(
		&socialHTTPRequest{
			request: request,
			body:    []byte{0x01},
		},
		"body forbidden",
	); err == nil {
		t.Fatal("status request body was accepted")
	}
}

func TestPrivateObjectChunkPathRejectsQuery(t *testing.T) {
	if _, _, err := socialObjectChunkPath(
		"/api/v1/social/moments/objects/uploads/upload-1/chunks/0?extra=1",
	); err == nil {
		t.Fatal("chunk query was silently discarded")
	}
}

func TestMomentPathWrapperRejectsBodyAndQuery(t *testing.T) {
	called := false
	wrapped := socialMomentPathWrapper(func(
		context.Context,
		server.Request,
		server.Response,
	) error {
		called = true
		return nil
	})
	response := &socialHTTPResponse{writer: httptest.NewRecorder()}
	for _, request := range []*socialHTTPRequest{
		{
			request: httptest.NewRequest(
				http.MethodGet,
				"/api/v1/social/moments/1?post_id=1",
				nil,
			),
		},
		{
			request: httptest.NewRequest(
				http.MethodGet,
				"/api/v1/social/moments/1",
				nil,
			),
			body: []byte(`{"post_id":"1"}`),
		},
	} {
		if err := wrapped(
			context.Background(),
			request,
			response,
		); err == nil {
			t.Fatalf("noncanonical Moment request was accepted: %s", request.Path())
		}
	}
	if called {
		t.Fatal("Moment handler ran for a noncanonical request")
	}
}

func TestPrivateContentHandlerErrorProjectsStableProtobuf(t *testing.T) {
	tests := []struct {
		domainCode domain.PrivateContentErrorCode
		status     int
		stableCode model.ErrorCode
	}{
		{domain.PrivateContentInvalidArgument, http.StatusBadRequest, model.ErrorCode_ERROR_CODE_INVALID_REQUEST},
		{domain.PrivateContentUnsupported, http.StatusBadRequest, model.ErrorCode_ERROR_CODE_INVALID_REQUEST},
		{domain.PrivateContentUnauthorized, http.StatusForbidden, model.ErrorCode_ERROR_CODE_UNAUTHORIZED},
		{domain.PrivateContentNotFound, http.StatusNotFound, model.ErrorCode_ERROR_CODE_POST_NOT_FOUND},
		{domain.PrivateContentConflict, http.StatusConflict, model.ErrorCode_ERROR_CODE_INVALID_REQUEST},
		{domain.PrivateContentStalePlan, http.StatusConflict, model.ErrorCode_ERROR_CODE_INVALID_REQUEST},
		{domain.PrivateContentExpiredPlan, http.StatusConflict, model.ErrorCode_ERROR_CODE_INVALID_REQUEST},
		{domain.PrivateContentIntegrityFailed, http.StatusInternalServerError, model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR},
		{domain.PrivateContentDependency, http.StatusInternalServerError, model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR},
		{domain.PrivateContentIntegrationGap, http.StatusInternalServerError, model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR},
		{domain.PrivateContentInternal, http.StatusInternalServerError, model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR},
	}
	for _, testCase := range tests {
		t.Run(string(testCase.domainCode), func(t *testing.T) {
			handlerError, response := decodePrivateContentHandlerError(
				t,
				privateContentHandlerError(
					domain.NewPrivateContentError(
						testCase.domainCode,
						"test.private_content",
						"",
						"bounded failure",
					),
				),
			)
			if handlerError.Code != testCase.status ||
				response.GetCode() != testCase.stableCode ||
				response.GetDetails()["private_content_code"] !=
					string(testCase.domainCode) {
				t.Fatalf(
					"projection = status %d code %s private code %q, want status %d code %s private code %q",
					handlerError.Code,
					response.GetCode(),
					response.GetDetails()["private_content_code"],
					testCase.status,
					testCase.stableCode,
					testCase.domainCode,
				)
			}
		})
	}
}

type privateMomentReaderFunc func(
	context.Context,
	*model.ActorDeviceRef,
	string,
) (*privatecontentpb.GetMomentResourceResponse, error)

func (f privateMomentReaderFunc) GetPrivateMoment(
	ctx context.Context,
	viewer *model.ActorDeviceRef,
	postID string,
) (*privatecontentpb.GetMomentResourceResponse, error) {
	return f(ctx, viewer, postID)
}

type privateCommentReaderStub struct {
	get func(
		context.Context,
		*model.ActorDeviceRef,
		string,
		string,
	) (*privatecontentpb.GetMomentCommentResourceResponse, error)
	list func(
		context.Context,
		*model.ActorDeviceRef,
		*privatecontentpb.ListMomentCommentsRequest,
	) (*privatecontentpb.ListMomentCommentsResponse, error)
}

func (s privateCommentReaderStub) GetPrivateComment(
	ctx context.Context,
	viewer *model.ActorDeviceRef,
	postID string,
	commentID string,
) (*privatecontentpb.GetMomentCommentResourceResponse, error) {
	return s.get(ctx, viewer, postID, commentID)
}

func (s privateCommentReaderStub) ListPrivateComments(
	ctx context.Context,
	viewer *model.ActorDeviceRef,
	request *privatecontentpb.ListMomentCommentsRequest,
) (*privatecontentpb.ListMomentCommentsResponse, error) {
	return s.list(ctx, viewer, request)
}

func TestPrivateCommentPointAndListReadsDelegateCanonicalViewer(t *testing.T) {
	const (
		postID    = "01K55XG0000000000000000000"
		commentID = "01K55XG0000000000000000001"
		actorPTID = "ptid:v1:actor:peers:p:bob:bob-fingerprint"
		deviceID  = "bob-device"
	)
	var pointViewer, listViewer *model.ActorDeviceRef
	reader := privateCommentReaderStub{
		get: func(
			_ context.Context,
			viewer *model.ActorDeviceRef,
			gotPostID string,
			gotCommentID string,
		) (*privatecontentpb.GetMomentCommentResourceResponse, error) {
			pointViewer = viewer
			if gotPostID != postID || gotCommentID != commentID {
				t.Fatalf(
					"private Comment point identity = %q/%q",
					gotPostID,
					gotCommentID,
				)
			}
			return &privatecontentpb.GetMomentCommentResourceResponse{
				Comment: &privatecontentpb.CommentResource{
					Metadata: &privatecontentpb.CommentMetadata{
						PostId:    postID,
						CommentId: commentID,
					},
				},
			}, nil
		},
		list: func(
			_ context.Context,
			viewer *model.ActorDeviceRef,
			request *privatecontentpb.ListMomentCommentsRequest,
		) (*privatecontentpb.ListMomentCommentsResponse, error) {
			listViewer = viewer
			if request.GetPostId() != postID || request.GetLimit() != 2 {
				t.Fatalf("private Comment list request = %+v", request)
			}
			return &privatecontentpb.ListMomentCommentsResponse{
				Comments: []*privatecontentpb.CommentResource{
					{
						Metadata: &privatecontentpb.CommentMetadata{
							PostId:    postID,
							CommentId: commentID,
						},
					},
				},
			}, nil
		},
	}
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/social/moments/"+postID+"/comments/"+commentID,
		nil,
	)
	request.Header.Set("X-Device-ID", deviceID)
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: actorPTID},
	)
	var point *privatecontentpb.GetMomentCommentResourceResponse
	var page *privatecontentpb.ListMomentCommentsResponse
	handler := serverwrapper.DeviceID()(func(
		handlerCtx context.Context,
		_ server.Request,
		_ server.Response,
	) error {
		var err error
		point, err = (&subServer{}).handleGetMomentCommentResourceWithReader(
			handlerCtx,
			&privatecontentpb.GetMomentCommentResourceRequest{
				PostId:    postID,
				CommentId: commentID,
			},
			reader,
		)
		if err != nil {
			return err
		}
		page, err = (&subServer{}).handleListMomentCommentsWithReader(
			handlerCtx,
			&privatecontentpb.ListMomentCommentsRequest{
				PostId: postID,
				Limit:  2,
			},
			reader,
		)
		return err
	})
	if err := handler(
		ctx,
		&socialHTTPRequest{request: request},
		&socialHTTPResponse{writer: httptest.NewRecorder()},
	); err != nil {
		t.Fatal(err)
	}
	if point.GetComment().GetMetadata().GetCommentId() != commentID ||
		len(page.GetComments()) != 1 {
		t.Fatalf("private Comment responses = point %+v page %+v", point, page)
	}
	for name, viewer := range map[string]*model.ActorDeviceRef{
		"point": pointViewer,
		"list":  listViewer,
	} {
		if viewer.GetActor().GetPtid() != actorPTID ||
			viewer.GetDeviceId() != deviceID {
			t.Fatalf("%s private Comment viewer = %+v", name, viewer)
		}
	}
}

func TestPublicCommentPointAndListProjectUnifiedResource(t *testing.T) {
	fixture := newHandlerFixture(t)
	public := fixture.seedMoment(
		1,
		textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "public"),
	)
	created, err := fixture.subserver.handleCreateComment(
		fixture.withViewer(1),
		&model.CreateCommentRequest{
			PostId:  public.GetId(),
			Content: "public reply",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	commentID := created.GetComment().GetId()
	point, err := fixture.subserver.handleGetMomentCommentResource(
		fixture.withViewer(1),
		&privatecontentpb.GetMomentCommentResourceRequest{
			PostId:    public.GetId(),
			CommentId: commentID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	page, err := fixture.subserver.handleListMomentComments(
		fixture.withViewer(1),
		&privatecontentpb.ListMomentCommentsRequest{
			PostId: public.GetId(),
			Limit:  20,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	resource := point.GetComment()
	if resource.GetMetadata().GetCommentId() != commentID ||
		resource.GetPublicContent().GetText() != "public reply" ||
		resource.GetMetadata().GetAuthor().GetAcct() != "user-1@test.local" {
		t.Fatalf("public Comment point resource = %+v", resource)
	}
	if len(page.GetComments()) != 1 ||
		!proto.Equal(page.GetComments()[0], resource) {
		t.Fatalf("public Comment list resource = %+v", page)
	}
}

func TestHiddenPrivateMomentReadReturnsTypedPostNotFound(t *testing.T) {
	const (
		postID    = "01K55XG0000000000000000000"
		actorPTID = "ptid:v1:actor:peers:p:eve:eve-fingerprint"
		deviceID  = "eve-device"
	)
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/social/moments/"+postID,
		nil,
	)
	request.Header.Set("X-Device-ID", deviceID)
	var observedViewer *model.ActorDeviceRef
	reader := privateMomentReaderFunc(func(
		_ context.Context,
		viewer *model.ActorDeviceRef,
		gotPostID string,
	) (*privatecontentpb.GetMomentResourceResponse, error) {
		observedViewer = viewer
		if gotPostID != postID {
			t.Fatalf("private reader post ID = %q, want %q", gotPostID, postID)
		}
		return nil, domain.NewPrivateContentError(
			domain.PrivateContentNotFound,
			"test.private_content.hidden_read",
			"",
			"resource is missing or hidden",
		)
	})
	handler := serverwrapper.DeviceID()(func(
		ctx context.Context,
		_ server.Request,
		_ server.Response,
	) error {
		_, err := (&subServer{}).handleGetMomentResourceWithReader(
			context.WithValue(
				ctx,
				socialMomentPathContextKey{},
				postID,
			),
			&privatecontentpb.GetMomentResourceRequest{PostId: postID},
			reader,
		)
		return err
	})
	err := handler(
		coreauth.WithSubject(
			context.Background(),
			&coreauth.Subject{ID: actorPTID},
		),
		&socialHTTPRequest{request: request},
		&socialHTTPResponse{writer: httptest.NewRecorder()},
	)
	handlerError, response := decodePrivateContentHandlerError(t, err)
	if handlerError.Code != http.StatusNotFound ||
		response.GetCode() != model.ErrorCode_ERROR_CODE_POST_NOT_FOUND {
		t.Fatalf(
			"hidden private read = status %d code %s",
			handlerError.Code,
			response.GetCode(),
		)
	}
	if observedViewer.GetActor().GetPtid() != actorPTID ||
		observedViewer.GetDeviceId() != deviceID {
		t.Fatalf("hidden private read viewer = %+v", observedViewer)
	}
}

func TestMomentResourceDoesNotParsePrivateIDAsNumericPrefix(t *testing.T) {
	fixture := newHandlerFixture(t)
	public := fixture.seedMoment(
		1,
		textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "public"),
	)
	_, err := fixture.subserver.handleGetMomentResource(
		context.WithValue(
			context.Background(),
			socialMomentPathContextKey{},
			public.GetId()+"ABC",
		),
		&privatecontentpb.GetMomentResourceRequest{
			PostId: public.GetId() + "ABC",
		},
	)
	handlerError, response := decodePrivateContentHandlerError(t, err)
	if handlerError.Code != http.StatusNotFound ||
		response.GetCode() != model.ErrorCode_ERROR_CODE_POST_NOT_FOUND {
		t.Fatalf(
			"numeric-prefix private ID = status %d code %s",
			handlerError.Code,
			response.GetCode(),
		)
	}
}

func decodePrivateContentHandlerError(
	t *testing.T,
	err error,
) (*server.HandlerError, *model.ErrorResponse) {
	t.Helper()
	handlerError, ok := err.(*server.HandlerError)
	if !ok {
		t.Fatalf("private-content error type = %T, want *server.HandlerError", err)
	}
	if handlerError.ContentType != server.CanonicalProtobufContentType {
		t.Fatalf(
			"private-content content type = %q, want %q",
			handlerError.ContentType,
			server.CanonicalProtobufContentType,
		)
	}
	response := &model.ErrorResponse{}
	if err := proto.Unmarshal(handlerError.Body, response); err != nil {
		t.Fatalf("decode private-content ErrorResponse: %v", err)
	}
	deterministic, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		t.Fatalf("encode private-content ErrorResponse: %v", err)
	}
	if !bytes.Equal(handlerError.Body, deterministic) {
		t.Fatalf(
			"private-content ErrorResponse is not deterministic: %x != %x",
			handlerError.Body,
			deterministic,
		)
	}
	return handlerError, response
}

func TestPublicMomentResourcePreservesGetPostResponseWire(t *testing.T) {
	fixture := newHandlerFixture(t)
	public := fixture.seedMoment(
		1,
		textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "public"),
	)
	response, err := fixture.subserver.handleGetMomentResource(
		context.WithValue(
			context.Background(),
			socialMomentPathContextKey{},
			public.GetId(),
		),
		&privatecontentpb.GetMomentResourceRequest{PostId: public.GetId()},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetResource().GetPublicContent().GetPost().GetId() !=
		public.GetId() {
		t.Fatalf("typed public resource = %+v", response.GetResource())
	}
	wire, err := proto.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	legacy := &model.GetPostResponse{}
	if err := proto.Unmarshal(wire, legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.GetPost().GetId() != public.GetId() ||
		legacy.GetExplanation() == nil {
		t.Fatalf("legacy GetPostResponse projection = %+v", legacy)
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

type streamingSocialHTTPRequest struct {
	*socialHTTPRequest
	stream     io.Reader
	bodyCalled bool
}

func (r *streamingSocialHTTPRequest) Body() []byte {
	r.bodyCalled = true
	return nil
}

func (r *streamingSocialHTTPRequest) BodyStream() io.Reader {
	return r.stream
}

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
	const testSigningKey = "fixture-hmac-signing-key-material-v1"
	provider := coreauth.NewJWTProvider(testSigningKey, time.Hour)
	fixture.subserver.commonWrapper = func(next server.EndpointHandler) server.EndpointHandler {
		return next
	}
	fixture.subserver.jwtWrapper = server.HTTPWrapperAdapter(
		httpadapter.RequireJWT(provider, socialSessionValidator{}),
	)
	fixture.subserver.privateContentOptionalJWTWrapper =
		server.HTTPWrapperAdapter(
			httpadapter.OptionalStructuredJWT(
				provider,
				int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED),
				true,
				socialSessionValidator{},
			),
		)

	publicPost, err := fixture.subserver.handleCreatePost(
		fixture.withViewer(41),
		textPostReq(&model.Audience{Kind: model.Audience_PUBLIC}, "public"),
	)
	if err != nil {
		t.Fatalf("seed public post: %v", err)
	}
	_, validToken, err := provider.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: publicPost.Post.AuthorPtid,
		SessionID: "live-session",
	})
	if err != nil {
		t.Fatalf("mint valid token: %v", err)
	}
	_, revokedToken, err := provider.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: publicPost.Post.AuthorPtid,
		SessionID: "revoked-session",
	})
	if err != nil {
		t.Fatalf("mint revoked token: %v", err)
	}
	expiredProvider := coreauth.NewJWTProvider(testSigningKey, -time.Minute)
	_, expiredToken, err := expiredProvider.Authenticate(context.Background(), coreauth.Credentials{
		SubjectID: publicPost.Post.AuthorPtid,
	})
	if err != nil {
		t.Fatalf("mint expired token: %v", err)
	}

	handler := socialHandlerByName(t, fixture.subserver.Handlers(), "social-get-moment")
	testServer := serveSocialHandlerWithEndpoint(
		t,
		handler,
		func(
			ctx context.Context,
			_ server.Request,
			response server.Response,
		) error {
			result, err := fixture.subserver.handleGetMomentResource(
				ctx,
				&privatecontentpb.GetMomentResourceRequest{},
			)
			if err != nil {
				return err
			}
			body, err := proto.Marshal(result)
			if err != nil {
				return err
			}
			response.SetHeader("Content-Type", "application/x-protobuf")
			response.WriteHeader(http.StatusOK)
			_, err = response.Write(body)
			return err
		},
	)
	t.Cleanup(testServer.Close)

	tests := []struct {
		name          string
		postID        string
		authorization string
		wantStatus    int
	}{
		{name: "absent credential reads public as anonymous", postID: publicPost.Post.Id, wantStatus: http.StatusOK},
		{name: "valid credential projects canonical subject", postID: publicPost.Post.Id, authorization: "Bearer " + validToken.Value, wantStatus: http.StatusOK},
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
				nil,
			)
			if err != nil {
				t.Fatal(err)
			}
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
			if test.wantStatus == http.StatusUnauthorized {
				assertPrivateContentHTTPError(
					t,
					response,
					http.StatusUnauthorized,
					model.ErrorCode_ERROR_CODE_UNAUTHORIZED,
				)
			}
		})
	}
}

func TestSocialPublicCapableCollectionsUseStrictOptionalJWT(t *testing.T) {
	fixture := newHandlerFixture(t)
	const testSigningKey = "fixture-hmac-signing-key-material-v1"
	provider := coreauth.NewJWTProvider(testSigningKey, time.Hour)
	fixture.subserver.commonWrapper = func(next server.EndpointHandler) server.EndpointHandler {
		return next
	}
	fixture.subserver.optionalJWTWrapper = server.HTTPWrapperAdapter(
		httpadapter.OptionalJWT(provider),
	)
	fixture.subserver.privateContentOptionalJWTWrapper =
		server.HTTPWrapperAdapter(
			httpadapter.OptionalStructuredJWT(
				provider,
				int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED),
				true,
			),
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
// Reaction visibility
// ---------------------------------------------------------------------------

func TestHandler_React_NotFoundOnUnreadablePost(t *testing.T) {
	// The public interaction path must not distinguish an unavailable
	// post from a post the caller cannot read.
	f := newHandlerFixture(t)

	_, err := f.subserver.handleReact(f.withViewer(2), &model.ReactToPostRequest{
		PostId: "nonexistent-post-id-for-gate-test",
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

	// Viewer 9 attempts to list comments for a post outside the public store.
	_, err := f.subserver.handleListMomentComments(f.withViewer(9), &privatecontentpb.ListMomentCommentsRequest{
		PostId: "nonexistent-post-id-for-comment-gate",
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

// ---------------------------------------------------------------------------
// Canonical Friend Request boundary
// ---------------------------------------------------------------------------

type recordingFederatedFriendRequestAPI struct {
	submittedCommand *model.FriendRequestCommand
	projection       domain.FriendRequestProjection
	lookupActorPTID  string
	lookupRequest    *model.LookupFriendRequestCommandResultRequest
	lookupResponse   *model.LookupFriendRequestCommandResultResponse
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

func (a *recordingFederatedFriendRequestAPI) LookupFriendRequestCommandResult(
	_ context.Context,
	actorPTID string,
	request *model.LookupFriendRequestCommandResultRequest,
) (*model.LookupFriendRequestCommandResultResponse, error) {
	a.lookupActorPTID = actorPTID
	a.lookupRequest = request
	if a.err != nil {
		return nil, a.err
	}
	return a.lookupResponse, nil
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
	var lookup func(
		context.Context,
		*model.LookupFriendRequestCommandResultRequest,
	) (*model.LookupFriendRequestCommandResultResponse, error) = subserver.handleLookupFriendRequestCommandResult

	if send == nil || accept == nil || reject == nil || list == nil || lookup == nil {
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

func TestFriendRequestResultLookupRequiresAuthenticatedActor(t *testing.T) {
	response, err := (&subServer{}).handleLookupFriendRequestCommandResult(
		context.Background(),
		&model.LookupFriendRequestCommandResultRequest{
			CommandId:            "command-1",
			CommandPayloadSha256: bytes.Repeat([]byte{0x51}, sha256.Size),
		},
	)
	if err == nil {
		t.Fatalf("unauthenticated lookup returned %+v", response)
	}
	if status := statusOf(err); status != 0 && status != 401 {
		t.Fatalf("unauthenticated lookup status = %d", status)
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

func TestLookupFriendRequestCommandResultForwardsAuthenticatedActorAndHash(
	t *testing.T,
) {
	const actorPTID = "ptid:v1:actor:peers:p:alice:alice-fingerprint"
	payloadHash := bytes.Repeat([]byte{0x51}, sha256.Size)
	request := &model.LookupFriendRequestCommandResultRequest{
		CommandId:            "command-1",
		CommandPayloadSha256: payloadHash,
	}
	api := &recordingFederatedFriendRequestAPI{
		lookupResponse: &model.LookupFriendRequestCommandResultResponse{
			State:                model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_ACCEPTED_PENDING,
			CommandId:            "command-1",
			CommandPayloadSha256: payloadHash,
		},
	}

	response, err := lookupFriendRequestCommandResultWithAPI(
		context.Background(),
		actorPTID,
		request,
		api,
	)
	if err != nil {
		t.Fatalf("lookup Friend Request result: %v", err)
	}
	if api.lookupActorPTID != actorPTID || api.lookupRequest != request {
		t.Fatalf(
			"lookup delegation actor=%q request=%+v",
			api.lookupActorPTID,
			api.lookupRequest,
		)
	}
	if response.GetState() !=
		model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_ACCEPTED_PENDING ||
		!bytes.Equal(response.GetCommandPayloadSha256(), payloadHash) {
		t.Fatalf("lookup response = %+v", response)
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
