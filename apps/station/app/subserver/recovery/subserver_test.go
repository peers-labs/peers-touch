package recovery

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/infrastructure/persistence"
	recoverymodel "github.com/peers-labs/peers-touch/station/app/subserver/recovery/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const recoveryTestPTID = "ptid:v1:actor:peers:p:alice:fingerprint"

type recoveryTestAuthProvider struct {
	subjectID string
}

func (p recoveryTestAuthProvider) Method() coreauth.Method {
	return coreauth.MethodJWT
}

func (p recoveryTestAuthProvider) Authenticate(
	_ context.Context,
	credentials coreauth.Credentials,
) (*coreauth.Subject, *coreauth.Token, error) {
	return &coreauth.Subject{ID: credentials.SubjectID}, &coreauth.Token{}, nil
}

func (p recoveryTestAuthProvider) Validate(
	_ context.Context,
	_ string,
) (*coreauth.Subject, error) {
	return &coreauth.Subject{ID: p.subjectID}, nil
}

func (recoveryTestAuthProvider) Revoke(context.Context, string) error {
	return nil
}

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time {
	return c.now
}

type recoveryTestRequest struct {
	headers map[string]string
	method  server.Method
	path    string
	body    []byte
}

func (r recoveryTestRequest) Context() context.Context  { return context.Background() }
func (r recoveryTestRequest) Header() map[string]string { return r.headers }
func (r recoveryTestRequest) Method() server.Method     { return r.method }
func (r recoveryTestRequest) Path() string              { return r.path }
func (r recoveryTestRequest) Body() []byte              { return r.body }

type recoveryTestResponse struct {
	headers map[string]string
	status  int
	body    []byte
}

func (r *recoveryTestResponse) Header() map[string]string {
	return r.headers
}

func (r *recoveryTestResponse) SetHeader(key string, value string) {
	r.headers[key] = value
}

func (r *recoveryTestResponse) Write(body []byte) (int, error) {
	r.body = append(r.body, body...)
	return len(body), nil
}

func (*recoveryTestResponse) Flush() error {
	return nil
}

func (r *recoveryTestResponse) WriteHeader(status int) {
	r.status = status
}

func (r *recoveryTestResponse) Status() int {
	return r.status
}

func TestRecoverySubServerComposesCanonicalRoutesAndLifecycle(t *testing.T) {
	database := openProductionRecoveryDatabase(t)
	subserver := newRecoverySubServer(recoveryTestDependencies(database))

	if subserver.Status() != server.StatusStopped {
		t.Fatalf("initial status = %s, want %s", subserver.Status(), server.StatusStopped)
	}
	if handlers := subserver.Handlers(); handlers != nil {
		t.Fatalf("uninitialized handlers = %+v, want nil", handlers)
	}
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if subserver.Status() != server.StatusStarting {
		t.Fatalf("initialized status = %s, want %s", subserver.Status(), server.StatusStarting)
	}
	if !database.Migrator().HasTable(&persistence.RecoveryRevisionModel{}) {
		t.Fatal("Recovery Init did not migrate the canonical recovery_revisions table")
	}

	handlers := subserver.Handlers()
	if len(handlers) != 2 {
		t.Fatalf("handler count = %d, want 2", len(handlers))
	}
	assertRecoveryHandler(
		t,
		handlers[0],
		"recovery-revision-put",
		storeRecoveryRevisionPath,
		server.POST,
		3,
	)
	assertRecoveryHandler(
		t,
		handlers[1],
		"recovery-revision-latest",
		readLatestRecoveryRevisionPath,
		server.GET,
		2,
	)

	if err := subserver.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	if subserver.Status() != server.StatusRunning {
		t.Fatalf("running status = %s, want %s", subserver.Status(), server.StatusRunning)
	}
	if err := subserver.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if subserver.Status() != server.StatusStopped {
		t.Fatalf("stopped status = %s, want %s", subserver.Status(), server.StatusStopped)
	}
	if !database.Migrator().HasTable(&persistence.RecoveryRevisionModel{}) {
		t.Fatal("Recovery Stop closed or removed the shared Station store")
	}
}

func TestRecoverySubServerRejectsStartBeforeInitialization(t *testing.T) {
	subserver := newRecoverySubServer(subServerDependencies{})

	if err := subserver.Start(context.Background()); err == nil {
		t.Fatal("Start succeeded before Recovery initialization")
	}
	if subserver.Status() != server.StatusError {
		t.Fatalf("failed start status = %s, want %s", subserver.Status(), server.StatusError)
	}
}

func TestRecoverySubServerRoutesPersistAndReadOpaqueRevision(t *testing.T) {
	database := openProductionRecoveryDatabase(t)
	seedRecoveryActorAndDevice(t, database)
	subserver := newRecoverySubServer(recoveryTestDependencies(database))
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}

	handlers := subserver.Handlers()
	storeHandler := findRecoveryHandler(t, handlers, storeRecoveryRevisionPath)
	latestHandler := findRecoveryHandler(t, handlers, readLatestRecoveryRevisionPath)
	archive := []byte{0x00, 0xff, 0x10, 0x80}
	archiveHash := sha256.Sum256(archive)
	storeBody, err := proto.Marshal(&recoverymodel.StoreRecoveryRevisionRequest{
		RevisionId:             "revision-production",
		FormatVersion:          1,
		EncryptedArchive:       archive,
		EncryptedArchiveSha256: archiveHash[:],
	})
	if err != nil {
		t.Fatal(err)
	}

	storeResponse := executeRecoveryHandler(
		t,
		storeHandler,
		recoveryTestRequest{
			headers: map[string]string{
				"Authorization": "Bearer recovery-test",
				"Content-Type":  "application/protobuf",
				"X-Device-ID":   "alice-device",
			},
			method: server.POST,
			path:   storeRecoveryRevisionPath,
			body:   storeBody,
		},
	)
	if storeResponse.status != 200 {
		t.Fatalf("store status = %d, body=%x", storeResponse.status, storeResponse.body)
	}
	stored := &recoverymodel.StoreRecoveryRevisionResponse{}
	if err := proto.Unmarshal(storeResponse.body, stored); err != nil {
		t.Fatal(err)
	}
	if stored.GetRevisionId() != "revision-production" {
		t.Fatalf("stored revision = %+v", stored)
	}

	latestResponse := executeRecoveryHandler(
		t,
		latestHandler,
		recoveryTestRequest{
			headers: map[string]string{
				"Authorization": "Bearer recovery-test",
				"Content-Type":  "application/protobuf",
			},
			method: server.GET,
			path:   readLatestRecoveryRevisionPath,
		},
	)
	if latestResponse.status != 200 {
		t.Fatalf("latest status = %d, body=%x", latestResponse.status, latestResponse.body)
	}
	latest := &recoverymodel.ReadLatestRecoveryRevisionResponse{}
	if err := proto.Unmarshal(latestResponse.body, latest); err != nil {
		t.Fatal(err)
	}
	if latest.GetRevisionId() != stored.GetRevisionId() ||
		string(latest.GetEncryptedArchive()) != string(archive) {
		t.Fatalf("latest revision = %+v", latest)
	}
}

func TestRecoveryStoreRouteRequiresAuthenticatedDeviceHeader(t *testing.T) {
	database := openProductionRecoveryDatabase(t)
	seedRecoveryActorAndDevice(t, database)
	subserver := newRecoverySubServer(recoveryTestDependencies(database))
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}

	archive := []byte("opaque")
	archiveHash := sha256.Sum256(archive)
	body, err := proto.Marshal(&recoverymodel.StoreRecoveryRevisionRequest{
		RevisionId:             "revision-without-device",
		FormatVersion:          1,
		EncryptedArchive:       archive,
		EncryptedArchiveSha256: archiveHash[:],
	})
	if err != nil {
		t.Fatal(err)
	}
	response := executeRecoveryHandler(
		t,
		findRecoveryHandler(t, subserver.Handlers(), storeRecoveryRevisionPath),
		recoveryTestRequest{
			headers: map[string]string{
				"Authorization": "Bearer recovery-test",
				"Content-Type":  "application/protobuf",
			},
			method: server.POST,
			path:   storeRecoveryRevisionPath,
			body:   body,
		},
	)
	if response.status != 401 {
		t.Fatalf("missing-device status = %d, want 401", response.status)
	}

	var revisions int64
	if err := database.Model(&persistence.RecoveryRevisionModel{}).
		Count(&revisions).Error; err != nil {
		t.Fatal(err)
	}
	if revisions != 0 {
		t.Fatalf("missing-device request persisted %d revisions", revisions)
	}
}

func TestRecoveryRoutesRequireJWTAuthentication(t *testing.T) {
	database := openProductionRecoveryDatabase(t)
	subserver := newRecoverySubServer(recoveryTestDependencies(database))
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}

	response := executeRecoveryHandler(
		t,
		findRecoveryHandler(t, subserver.Handlers(), readLatestRecoveryRevisionPath),
		recoveryTestRequest{
			headers: map[string]string{"Content-Type": "application/protobuf"},
			method:  server.GET,
			path:    readLatestRecoveryRevisionPath,
		},
	)
	if response.status != 401 {
		t.Fatalf("unauthenticated latest status = %d, want 401", response.status)
	}
}

func TestRecoveryStoreRouteRejectsRevokedDeviceBeforeMutation(t *testing.T) {
	database := openProductionRecoveryDatabase(t)
	seedRecoveryActorAndDevice(t, database)
	subserver := newRecoverySubServer(recoveryTestDependencies(database))
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where("ptid = ? AND device_id = ?", recoveryTestPTID, "alice-device").
		Update("revoked", true).Error; err != nil {
		t.Fatal(err)
	}

	archive := []byte("opaque")
	archiveHash := sha256.Sum256(archive)
	body, err := proto.Marshal(&recoverymodel.StoreRecoveryRevisionRequest{
		RevisionId:             "revision-after-revoke",
		FormatVersion:          1,
		EncryptedArchive:       archive,
		EncryptedArchiveSha256: archiveHash[:],
	})
	if err != nil {
		t.Fatal(err)
	}
	response := executeRecoveryHandler(
		t,
		findRecoveryHandler(t, subserver.Handlers(), storeRecoveryRevisionPath),
		recoveryTestRequest{
			headers: map[string]string{
				"Authorization": "Bearer recovery-test",
				"Content-Type":  "application/protobuf",
				"X-Device-ID":   "alice-device",
			},
			method: server.POST,
			path:   storeRecoveryRevisionPath,
			body:   body,
		},
	)
	if response.status != 403 {
		t.Fatalf("revoked-device status = %d, want 403", response.status)
	}

	var revisions int64
	if err := database.Model(&persistence.RecoveryRevisionModel{}).
		Count(&revisions).Error; err != nil {
		t.Fatal(err)
	}
	if revisions != 0 {
		t.Fatalf("revoked-device request persisted %d revisions", revisions)
	}
}

func recoveryTestDependencies(database *gorm.DB) subServerDependencies {
	return subServerDependencies{
		database: func(context.Context) (*gorm.DB, error) {
			return database, nil
		},
		authorizer: func(
			database *gorm.DB,
		) (ports.ActorDeviceAuthorizer, error) {
			return persistence.NewActorDeviceAuthorizer(database)
		},
		authProvider: func() coreauth.Provider {
			return recoveryTestAuthProvider{subjectID: recoveryTestPTID}
		},
		subjectResolver:          touchactor.ResolveSubjectPTID,
		clock:                    fixedClock{now: time.Unix(1_700_000_000, 0).UTC()},
		maxEncryptedArchiveBytes: 1024,
	}
}

func openProductionRecoveryDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open("file:recovery-production-"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := sqlDatabase.Close(); err != nil {
			t.Errorf("close Recovery production test database: %v", err)
		}
	})
	if err := database.AutoMigrate(
		&modeldb.Actor{},
		&actoridentitypersistence.ActorDeviceModel{},
	); err != nil {
		t.Fatal(err)
	}

	return database
}

func seedRecoveryActorAndDevice(t *testing.T, database *gorm.DB) {
	t.Helper()
	if err := database.Create(&modeldb.Actor{
		ID:                1,
		PTID:              recoveryTestPTID,
		Namespace:         "peers",
		PreferredUsername: "alice",
		Email:             "alice@example.test",
		PasswordHash:      "test-only",
		Kind:              "p",
		Origin:            touchactor.OriginLocal,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&actoridentitypersistence.ActorDeviceModel{
		PTID:               recoveryTestPTID,
		ActorAccount:       "alice@example.test",
		ActorKind:          1,
		DeviceID:           "alice-device",
		Label:              "Alice Device",
		HomeStationPeerID:  "station-local",
		SigningKeyID:       "alice-signing-key",
		PublicKey:          make([]byte, 32),
		ProfileVersion:     1,
		VerificationSource: 1,
		CreatedAt:          time.Unix(1_700_000_000, 0).UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func assertRecoveryHandler(
	t *testing.T,
	handler server.Handler,
	name string,
	path string,
	method server.Method,
	wrapperCount int,
) {
	t.Helper()
	if handler.Name() != name ||
		handler.Path() != path ||
		handler.Method() != method ||
		len(handler.Wrappers()) != wrapperCount {
		t.Fatalf(
			"handler = name:%q path:%q method:%s wrappers:%d",
			handler.Name(),
			handler.Path(),
			handler.Method(),
			len(handler.Wrappers()),
		)
	}
}

func findRecoveryHandler(
	t *testing.T,
	handlers []server.Handler,
	path string,
) server.Handler {
	t.Helper()
	for _, handler := range handlers {
		if handler.Path() == path {
			return handler
		}
	}
	t.Fatalf("Recovery handler %q was not registered", path)

	return nil
}

func executeRecoveryHandler(
	t *testing.T,
	handler server.Handler,
	request recoveryTestRequest,
) *recoveryTestResponse {
	t.Helper()
	endpoint := handler.Handler()
	for _, wrapper := range handler.Wrappers() {
		endpoint = wrapper(endpoint)
	}
	response := &recoveryTestResponse{headers: map[string]string{}}
	if err := endpoint(context.Background(), request, response); err != nil {
		t.Fatalf("execute %s %s: %v", handler.Method(), handler.Path(), err)
	}

	return response
}

var _ coreauth.Provider = recoveryTestAuthProvider{}
var _ server.Request = recoveryTestRequest{}
var _ server.Response = (*recoveryTestResponse)(nil)
