package actor_identity

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentityhttp "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/interface/http"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	testActorPTID = "ptid:v1:actor:peers:p:alice:fingerprint"
	testDeviceID  = "alice-desktop"
	testToken     = "actor-identity-test-token"
)

var testLifecycleTime = time.Date(2026, time.September, 7, 8, 0, 0, 0, time.UTC)

type testAuthProvider struct {
	subject *coreauth.Subject
}

func (p *testAuthProvider) Method() coreauth.Method {
	return coreauth.MethodJWT
}

func (p *testAuthProvider) Authenticate(
	ctx context.Context,
	credentials coreauth.Credentials,
) (*coreauth.Subject, *coreauth.Token, error) {
	return nil, nil, errors.New("test auth provider does not issue tokens")
}

func (p *testAuthProvider) Validate(
	ctx context.Context,
	token string,
) (*coreauth.Subject, error) {
	if token != testToken {
		return nil, errors.New("invalid test token")
	}
	subject := *p.subject

	return &subject, nil
}

func (p *testAuthProvider) Revoke(ctx context.Context, token string) error {
	return nil
}

type testRequest struct {
	ctx     context.Context
	headers map[string]string
	method  server.Method
	path    string
	body    []byte
}

func (r *testRequest) Context() context.Context {
	return r.ctx
}

func (r *testRequest) Header() map[string]string {
	return r.headers
}

func (r *testRequest) Method() server.Method {
	return r.method
}

func (r *testRequest) Path() string {
	return r.path
}

func (r *testRequest) Body() []byte {
	return append([]byte(nil), r.body...)
}

type testResponse struct {
	headers map[string]string
	status  int
	body    bytes.Buffer
}

func newTestResponse() *testResponse {
	return &testResponse{headers: make(map[string]string)}
}

func (r *testResponse) Header() map[string]string {
	return r.headers
}

func (r *testResponse) SetHeader(key string, value string) {
	r.headers[key] = value
}

func (r *testResponse) Write(body []byte) (int, error) {
	return r.body.Write(body)
}

func (r *testResponse) Flush() error {
	return nil
}

func (r *testResponse) WriteHeader(status int) {
	r.status = status
}

func (r *testResponse) Status() int {
	return r.status
}

func TestActorIdentitySubServerLifecycleAndCanonicalRoutes(t *testing.T) {
	if actorDeviceEnrollPath != actoridentityhttp.EnrollPath ||
		actorDeviceListPath != actoridentityhttp.ListPath ||
		actorDeviceRevokePath != actoridentityhttp.RevokePath {
		t.Fatal("subserver routes diverge from the Actor Identity HTTP adapter")
	}

	subserver, database := newTestActorIdentitySubServer(t)
	if subserver.Status() != server.StatusStopped {
		t.Fatalf("initial status = %s, want %s", subserver.Status(), server.StatusStopped)
	}
	if handlers := subserver.Handlers(); handlers != nil {
		t.Fatalf("handlers before initialization = %v, want nil", handlers)
	}

	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	if subserver.Status() != server.StatusStarting {
		t.Fatalf("initialized status = %s, want %s", subserver.Status(), server.StatusStarting)
	}
	if subserver.Name() != "actor_identity" {
		t.Fatalf("name = %q, want actor_identity", subserver.Name())
	}
	if subserver.Type() != server.SubserverTypeHTTP {
		t.Fatalf("type = %q, want %q", subserver.Type(), server.SubserverTypeHTTP)
	}
	if len(subserver.Address().Address) != 0 {
		t.Fatalf("address = %+v, want parent-listener mount", subserver.Address())
	}
	if !database.Migrator().HasTable("actor_devices") ||
		!database.Migrator().HasTable("actor_identity_keys") ||
		!database.Migrator().HasTable("actor_endpoint_directory_versions") {
		t.Fatal("Init did not migrate the canonical Actor Identity tables")
	}

	expected := []struct {
		name         string
		path         string
		method       server.Method
		wrapperCount int
	}{
		{
			name:         "actor-device-enroll",
			path:         actorDeviceEnrollPath,
			method:       server.POST,
			wrapperCount: 3,
		},
		{
			name:         "actor-device-list",
			path:         actorDeviceListPath,
			method:       server.GET,
			wrapperCount: 2,
		},
		{
			name:         "actor-device-revoke",
			path:         actorDeviceRevokePath,
			method:       server.POST,
			wrapperCount: 3,
		},
	}
	handlers := subserver.Handlers()
	if len(handlers) != len(expected) {
		t.Fatalf("handler count = %d, want %d", len(handlers), len(expected))
	}
	for index, want := range expected {
		got := handlers[index]
		if got.Name() != want.name ||
			got.Path() != want.path ||
			got.Method() != want.method ||
			len(got.Wrappers()) != want.wrapperCount {
			t.Fatalf(
				"handler[%d] = name=%q path=%q method=%s wrappers=%d, want %+v",
				index,
				got.Name(),
				got.Path(),
				got.Method(),
				len(got.Wrappers()),
				want,
			)
		}
	}

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
}

func TestActorIdentitySubServerRoutesEnforceAuthAndDeviceBinding(t *testing.T) {
	subserver, database := newTestActorIdentitySubServer(t)
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}

	handlers := handlersByPath(subserver.Handlers())
	enrollment := signedActorDeviceEnrollment(t, testActorPTID, testDeviceID)
	enrollmentBody, err := proto.Marshal(enrollment)
	if err != nil {
		t.Fatal(err)
	}

	unauthorized := executeActorIdentityHandler(
		t,
		handlers[actorDeviceEnrollPath],
		server.POST,
		enrollmentBody,
		map[string]string{
			"Content-Type": "application/protobuf",
			"X-Device-ID":  testDeviceID,
		},
	)
	if unauthorized.status != http.StatusUnauthorized {
		t.Fatalf(
			"unauthenticated enrollment status = %d, want %d",
			unauthorized.status,
			http.StatusUnauthorized,
		)
	}
	var deviceCount int64
	if err := database.Table("actor_devices").Count(&deviceCount).Error; err != nil {
		t.Fatal(err)
	}
	if deviceCount != 0 {
		t.Fatalf("unauthenticated enrollment persisted %d devices", deviceCount)
	}

	enrolled := executeActorIdentityHandler(
		t,
		handlers[actorDeviceEnrollPath],
		server.POST,
		enrollmentBody,
		authenticatedHeaders(true),
	)
	if enrolled.status != http.StatusOK {
		t.Fatalf("enrollment status = %d, body=%q", enrolled.status, enrolled.body.String())
	}
	var enrollResponse actormodel.EnrollActorDeviceResponse
	if err := proto.Unmarshal(enrolled.body.Bytes(), &enrollResponse); err != nil {
		t.Fatal(err)
	}
	if enrollResponse.GetDevice().GetRef().GetActor().GetPtid() != testActorPTID ||
		enrollResponse.GetDevice().GetRef().GetDeviceId() != testDeviceID {
		t.Fatalf("unexpected enrolled device: %+v", enrollResponse.GetDevice())
	}

	listed := executeActorIdentityHandler(
		t,
		handlers[actorDeviceListPath],
		server.GET,
		nil,
		authenticatedHeaders(false),
	)
	if listed.status != http.StatusOK {
		t.Fatalf("list status = %d, body=%q", listed.status, listed.body.String())
	}
	var listResponse actormodel.ListActorDevicesResponse
	if err := proto.Unmarshal(listed.body.Bytes(), &listResponse); err != nil {
		t.Fatal(err)
	}
	if len(listResponse.GetDevices()) != 1 {
		t.Fatalf("listed devices = %d, want 1", len(listResponse.GetDevices()))
	}

	revokeRequest := &actormodel.RevokeActorDeviceRequest{
		DeviceId:               testDeviceID,
		ObservedProfileVersion: 1,
	}
	revokeBody, err := proto.Marshal(revokeRequest)
	if err != nil {
		t.Fatal(err)
	}
	missingDevice := executeActorIdentityHandler(
		t,
		handlers[actorDeviceRevokePath],
		server.POST,
		revokeBody,
		authenticatedHeaders(false),
	)
	if missingDevice.status != http.StatusUnauthorized {
		t.Fatalf(
			"device-unbound revoke status = %d, want %d",
			missingDevice.status,
			http.StatusUnauthorized,
		)
	}

	revoked := executeActorIdentityHandler(
		t,
		handlers[actorDeviceRevokePath],
		server.POST,
		revokeBody,
		authenticatedHeaders(true),
	)
	if revoked.status != http.StatusOK {
		t.Fatalf("revoke status = %d, body=%q", revoked.status, revoked.body.String())
	}
	var revokeResponse actormodel.RevokeActorDeviceResponse
	if err := proto.Unmarshal(revoked.body.Bytes(), &revokeResponse); err != nil {
		t.Fatal(err)
	}
	if revokeResponse.GetDevice().GetStatus() !=
		actormodel.ActorDeviceStatus_ACTOR_DEVICE_STATUS_REVOKED {
		t.Fatalf("revoked device = %+v", revokeResponse.GetDevice())
	}
}

func TestActorIdentitySubServerFailsClosedWithoutStationIdentity(t *testing.T) {
	databaseCalled := false
	subserver := newActorIdentitySubServer(subServerDependencies{
		database: func(context.Context) (*gorm.DB, error) {
			databaseCalled = true

			return nil, errors.New("database must not be opened")
		},
		localStationID: func() (string, error) {
			return "", errors.New("Station peer identity unavailable")
		},
		authProvider: func() coreauth.Provider {
			return &testAuthProvider{
				subject: &coreauth.Subject{ID: testActorPTID},
			}
		},
		subjectResolver: touchactor.ResolveSubjectPTID,
		clock: func() time.Time {
			return testLifecycleTime
		},
	})

	if err := subserver.Init(context.Background()); err == nil {
		t.Fatal("Init succeeded without a Station peer identity")
	}
	if databaseCalled {
		t.Fatal("Init opened the database before resolving Station identity")
	}
	if subserver.Status() != server.StatusError {
		t.Fatalf("failed Init status = %s, want %s", subserver.Status(), server.StatusError)
	}
	if handlers := subserver.Handlers(); handlers != nil {
		t.Fatalf("failed Init exposed handlers: %v", handlers)
	}
}

func newTestActorIdentitySubServer(t *testing.T) (*subServer, *gorm.DB) {
	t.Helper()

	dsn := fmt.Sprintf(
		"file:actor-identity-subserver-%s?mode=memory&cache=shared&_busy_timeout=5000",
		uuid.NewString(),
	)
	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
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
			t.Errorf("close Actor Identity test database: %v", err)
		}
	})

	subserver := newActorIdentitySubServer(subServerDependencies{
		database: func(context.Context) (*gorm.DB, error) {
			return database, nil
		},
		localStationID: func() (string, error) {
			return "station-a", nil
		},
		authProvider: func() coreauth.Provider {
			return &testAuthProvider{
				subject: &coreauth.Subject{ID: testActorPTID},
			}
		},
		subjectResolver: touchactor.ResolveSubjectPTID,
		clock: func() time.Time {
			return testLifecycleTime
		},
	})

	return subserver, database
}

func handlersByPath(handlers []server.Handler) map[string]server.Handler {
	indexed := make(map[string]server.Handler, len(handlers))
	for _, handler := range handlers {
		indexed[handler.Path()] = handler
	}

	return indexed
}

func executeActorIdentityHandler(
	t *testing.T,
	handler server.Handler,
	method server.Method,
	body []byte,
	headers map[string]string,
) *testResponse {
	t.Helper()

	if handler == nil {
		t.Fatal("canonical Actor Identity handler is missing")
	}
	endpoint := handler.Handler()
	for _, wrapper := range handler.Wrappers() {
		endpoint = wrapper(endpoint)
	}
	response := newTestResponse()
	request := &testRequest{
		ctx:     context.Background(),
		headers: headers,
		method:  method,
		path:    handler.Path(),
		body:    body,
	}
	if err := endpoint(context.Background(), request, response); err != nil {
		t.Fatalf("execute %s %s: %v", method, handler.Path(), err)
	}

	return response
}

func authenticatedHeaders(withDeviceID bool) map[string]string {
	headers := map[string]string{
		"Authorization": "Bearer " + testToken,
		"Content-Type":  "application/protobuf",
	}
	if withDeviceID {
		headers["X-Device-ID"] = testDeviceID
	}

	return headers
}

func signedActorDeviceEnrollment(
	t *testing.T,
	ptid string,
	deviceID string,
) *actormodel.EnrollActorDeviceRequest {
	t.Helper()

	actorPrivateKey := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x11}, ed25519.SeedSize),
	)
	actorPublicKey := actorPrivateKey.Public().(ed25519.PublicKey)
	devicePrivateKey := ed25519.NewKeyFromSeed(
		bytes.Repeat([]byte{0x22}, ed25519.SeedSize),
	)
	devicePublicKey := devicePrivateKey.Public().(ed25519.PublicKey)
	actorFingerprint := sha256.Sum256(actorPublicKey)
	deviceFingerprint := sha256.Sum256(devicePublicKey)
	certificate := &actormodel.ActorDeviceCertificate{
		FormatVersion: domain.DeviceCertificateFormatVersion,
		Device: &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: ptid,
				Acct: "alice@example.test",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: deviceID,
		},
		ActorIdentityPublicKey:      append([]byte(nil), actorPublicKey...),
		ActorIdentityKeyFingerprint: append([]byte(nil), actorFingerprint[:]...),
		DeviceSigningPublicKey:      append([]byte(nil), devicePublicKey...),
		SigningKeyId:                hex.EncodeToString(deviceFingerprint[:]),
		ObservedProfileVersion:      1,
	}
	canonicalBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(certificate)
	if err != nil {
		t.Fatal(err)
	}

	return &actormodel.EnrollActorDeviceRequest{
		Certificate:         certificate,
		Label:               "Alice Desktop",
		ActorCrossSignature: ed25519.Sign(actorPrivateKey, canonicalBytes),
	}
}
