package federation

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	relayserver "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay"
	relayclient "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay-client"
	relaydomain "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	corestore "github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	peerClientRequestIDSourceStation = "station-source"
	peerClientRequestIDTargetStation = "station-target"
)

type peerClientRequestIDObservation struct {
	path                 string
	requestID            string
	authorization        string
	forwardAuthorization string
}

type peerClientRequestIDResolver struct {
	baseURL string
}

func (r peerClientRequestIDResolver) ResolveActiveStationURL(
	context.Context,
	string,
) (string, error) {
	return r.baseURL, nil
}

type peerClientRequestIDRelay struct {
	baseURL string
	token   string
}

func (r peerClientRequestIDRelay) BaseURL() string {
	return r.baseURL
}

func (r peerClientRequestIDRelay) Token() string {
	return r.token
}

func TestPeerClientPreservesPeerHopRequestIDThroughDirectAndRelayTransports(
	t *testing.T,
) {
	scope.ResetForTest()
	if err := RegisterPeerScopes(); err != nil {
		t.Fatal(err)
	}

	t.Run("direct Federation HTTP transport", func(t *testing.T) {
		source, observations, _ := newPeerClientRequestIDSource(t)
		requestID := uuid.NewString()
		client := newPeerClientRequestIDClient(
			t,
			source.Client(),
			peerClientRequestIDResolver{baseURL: source.URL},
			nil,
		)

		response, err := client.Open(
			context.Background(),
			peerClientRequestIDCall(requestID),
		)
		if err != nil {
			t.Fatal(err)
		}
		assertPeerClientRequestIDResponse(t, response)
		assertPeerClientRequestIDSourceObservation(
			t,
			<-observations,
			requestID,
		)
	})

	t.Run("Relay forward transport", func(t *testing.T) {
		source, sourceObservations, sourcePort := newPeerClientRequestIDSource(t)
		relayToken := startPeerClientRequestIDRelay(
			t,
			source.URL,
			sourcePort,
		)
		relayHTTP, relayObservations := newPeerClientRequestIDRelayHTTP(
			t,
			relayToken.subserver,
		)
		relayToken.startClient(t, relayHTTP.URL)

		requestID := uuid.NewString()
		client := newPeerClientRequestIDClient(
			t,
			relayHTTP.Client(),
			nil,
			peerClientRequestIDRelay{
				baseURL: relayHTTP.URL,
				token:   relayToken.value,
			},
		)
		deadline := time.Now().Add(3 * time.Second)
		var (
			response *PeerStreamResponse
			err      error
		)
		for {
			response, err = client.Open(
				context.Background(),
				peerClientRequestIDCall(requestID),
			)
			if err == nil || time.Now().After(deadline) {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if err != nil {
			t.Fatal(err)
		}
		assertPeerClientRequestIDResponse(t, response)

		var relayObservation peerClientRequestIDObservation
		for {
			relayObservation = <-relayObservations
			if relayObservation.requestID == requestID {
				break
			}
		}
		if relayObservation.authorization != "Bearer "+relayToken.value {
			t.Fatalf(
				"Relay Authorization = %q",
				relayObservation.authorization,
			)
		}
		if !strings.HasPrefix(
			relayObservation.forwardAuthorization,
			"Bearer ",
		) {
			t.Fatalf(
				"Relay forward Authorization = %q",
				relayObservation.forwardAuthorization,
			)
		}
		assertPeerClientRequestIDSourceObservation(
			t,
			<-sourceObservations,
			requestID,
		)
	})
}

func newPeerClientRequestIDClient(
	t *testing.T,
	httpClient *http.Client,
	resolver StationURLResolver,
	relay RelayAccess,
) *peerClient {
	t.Helper()
	client, err := newPeerClient(
		httpClient,
		authfed.NewKeyCache(
			authfed.NewInMemoryKeyStore(),
			authfed.WithRecheckTTL(0),
		),
		peerClientRequestIDTargetStation,
		resolver,
		relay,
	)
	if err != nil {
		t.Fatal(err)
	}

	return client
}

func peerClientRequestIDCall(requestID string) PeerStreamCall {
	return PeerStreamCall{
		TargetStationPeerID: peerClientRequestIDSourceStation,
		Route:               PeerRouteSocialPrivateObjectRead,
		Subject:             "ptid:bob",
		Claims: map[string]string{
			ClaimFederationID:           "federation:test",
			ClaimSourceStationPeerID:    peerClientRequestIDSourceStation,
			ClaimTargetStationPeerID:    peerClientRequestIDTargetStation,
			ClaimActorPTID:              "ptid:bob",
			ClaimDeviceID:               "device-bob",
			ClaimObjectID:               "object-01",
			ClaimCanonicalRequestSHA256: strings.Repeat("a", 64),
		},
		PathParameters: map[string]string{
			"object_id": "object-01",
		},
		Headers: map[string]string{
			"Accept":       "application/octet-stream",
			"Content-Type": "application/protobuf",
			"X-Request-ID": requestID,
		},
		Body: bytes.NewReader([]byte{0x08, 0x01}),
	}
}

func newPeerClientRequestIDSource(
	t *testing.T,
) (*httptest.Server, <-chan peerClientRequestIDObservation, int) {
	t.Helper()
	observations := make(chan peerClientRequestIDObservation, 4)
	source := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		if request.URL.Path == "/sub-bootstrap/info" {
			response.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(
				response,
				`{"peer_id":"`+peerClientRequestIDSourceStation+`"}`,
			)
			return
		}
		observations <- peerClientRequestIDObservation{
			path:          request.URL.Path,
			requestID:     request.Header.Get("X-Request-ID"),
			authorization: request.Header.Get("Authorization"),
			forwardAuthorization: request.Header.Get(
				nativefed.ForwardAuthorizationHeader,
			),
		}
		response.Header().Set("Content-Type", "application/octet-stream")
		response.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(response, "ciphertext")
	}))
	t.Cleanup(source.Close)

	_, portValue, err := net.SplitHostPort(source.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}

	return source, observations, port
}

func assertPeerClientRequestIDResponse(
	t *testing.T,
	response *PeerStreamResponse,
) {
	t.Helper()
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK ||
		!bytes.Equal(body, []byte("ciphertext")) {
		t.Fatalf(
			"peer response status=%d body=%q",
			response.StatusCode,
			body,
		)
	}
}

func assertPeerClientRequestIDSourceObservation(
	t *testing.T,
	observation peerClientRequestIDObservation,
	requestID string,
) {
	t.Helper()
	if observation.path !=
		"/federation/social/private/objects/object-01/read" {
		t.Fatalf("source path = %q", observation.path)
	}
	if observation.requestID != requestID {
		t.Fatalf(
			"source X-Request-ID = %q, want %q",
			observation.requestID,
			requestID,
		)
	}
	if !strings.HasPrefix(observation.authorization, "Bearer ") {
		t.Fatalf("source Authorization = %q", observation.authorization)
	}
	if observation.forwardAuthorization != "" {
		t.Fatalf(
			"source forward Authorization = %q",
			observation.forwardAuthorization,
		)
	}
}

type peerClientRequestIDRelayRuntime struct {
	subserver  server.Subserver
	value      string
	stream     string
	sourceURL  string
	sourcePort int
}

func startPeerClientRequestIDRelay(
	t *testing.T,
	sourceURL string,
	sourcePort int,
) *peerClientRequestIDRelayRuntime {
	t.Helper()
	ensurePeerClientRequestIDRelayStore(t)
	coreauth.Init(coreauth.Config{
		Secret:    "peer-client-request-id-test-secret",
		AccessTTL: time.Hour,
	})
	provider := coreauth.NewJWTProvider(
		coreauth.Get().Secret,
		coreauth.Get().AccessTTL,
	)
	_, token, err := provider.Authenticate(
		context.Background(),
		coreauth.Credentials{
			SubjectID: relaydomain.SubjectRelayAccess +
				peerClientRequestIDSourceStation,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	streamAddress := reservePeerClientRequestIDAddress(t)
	subserver := relayserver.NewRelaySubServer(
		option.WithRootCtx(context.Background()),
		relayserver.WithMaxStations(4),
		relayserver.WithForwardTimeout(2),
		relayserver.WithMaxBodySize(4*1024),
		relayserver.WithMaxConcurrentPerStation(4),
		relayserver.WithStreamListenAddr(streamAddress),
		relayserver.WithStreamPingInterval(3600),
	)
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	runContext, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := subserver.Start(runContext); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := subserver.Stop(context.Background()); err != nil {
			t.Errorf("stop Relay: %v", err)
		}
	})

	return &peerClientRequestIDRelayRuntime{
		subserver:  subserver,
		value:      token.Value,
		stream:     streamAddress,
		sourceURL:  sourceURL,
		sourcePort: sourcePort,
	}
}

func (r *peerClientRequestIDRelayRuntime) startClient(
	t *testing.T,
	relayURL string,
) {
	t.Helper()
	tokenPath := filepath.Join(t.TempDir(), "relay-token")
	if err := os.WriteFile(tokenPath, []byte(r.value), 0o600); err != nil {
		t.Fatal(err)
	}
	subserver := relayclient.NewRelayClientSubServer(
		relayclient.WithEnabled(true),
		relayclient.WithRelayURL(relayURL),
		relayclient.WithRelayStreamAddr(r.stream),
		relayclient.WithLocalHTTPPort(r.sourcePort),
		relayclient.WithLocalHTTPTimeoutSec(2),
		relayclient.WithBootstrapInfoURL(r.sourceURL+"/sub-bootstrap/info"),
		relayclient.WithTokenStorePath(tokenPath),
		relayclient.WithHeartbeatIntervalSec(3600),
	)
	if err := subserver.Init(context.Background()); err != nil {
		t.Fatal(err)
	}
	runContext, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := subserver.Start(runContext); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := subserver.Stop(context.Background()); err != nil {
			t.Errorf("stop Relay client: %v", err)
		}
	})
}

func newPeerClientRequestIDRelayHTTP(
	t *testing.T,
	relaySubserver server.Subserver,
) (*httptest.Server, <-chan peerClientRequestIDObservation) {
	t.Helper()
	var forward server.Handler
	for _, handler := range relaySubserver.Handlers() {
		if handler.Name() == "relay-forward" {
			forward = handler
			break
		}
	}
	if forward == nil {
		t.Fatal("Relay forward handler is unavailable")
	}
	endpoint := forward.Handler()
	observations := make(chan peerClientRequestIDObservation, 16)
	relayHTTP := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		if request.URL.Path == "/api/v1/relay/heartbeat" {
			response.WriteHeader(http.StatusOK)
			return
		}
		observations <- peerClientRequestIDObservation{
			path:          request.URL.Path,
			requestID:     request.Header.Get("X-Request-ID"),
			authorization: request.Header.Get("Authorization"),
			forwardAuthorization: request.Header.Get(
				nativefed.ForwardAuthorizationHeader,
			),
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, err.Error(), http.StatusBadRequest)
			return
		}
		ctx := coreauth.WithSubject(
			request.Context(),
			&coreauth.Subject{
				ID: relaydomain.SubjectRelayAccess +
					peerClientRequestIDTargetStation,
			},
		)
		if err := endpoint(
			ctx,
			&peerClientRequestIDServerRequest{
				request: request,
				body:    body,
			},
			&peerClientRequestIDServerResponse{writer: response},
		); err != nil {
			http.Error(response, err.Error(), http.StatusBadGateway)
		}
	}))
	t.Cleanup(relayHTTP.Close)

	return relayHTTP, observations
}

type peerClientRequestIDServerRequest struct {
	request *http.Request
	body    []byte
}

func (r *peerClientRequestIDServerRequest) Context() context.Context {
	return r.request.Context()
}

func (r *peerClientRequestIDServerRequest) Header() map[string]string {
	headers := make(map[string]string, len(r.request.Header))
	for name, values := range r.request.Header {
		if len(values) > 0 {
			headers[name] = values[0]
		}
	}

	return headers
}

func (r *peerClientRequestIDServerRequest) Method() server.Method {
	return server.Method(r.request.Method)
}

func (r *peerClientRequestIDServerRequest) Path() string {
	if r.request.URL.RawQuery == "" {
		return r.request.URL.Path
	}

	return r.request.URL.Path + "?" + r.request.URL.RawQuery
}

func (r *peerClientRequestIDServerRequest) Body() []byte {
	return r.body
}

type peerClientRequestIDServerResponse struct {
	writer http.ResponseWriter
	status int
}

func (r *peerClientRequestIDServerResponse) Header() map[string]string {
	headers := make(map[string]string, len(r.writer.Header()))
	for name, values := range r.writer.Header() {
		if len(values) > 0 {
			headers[name] = values[0]
		}
	}

	return headers
}

func (r *peerClientRequestIDServerResponse) SetHeader(name string, value string) {
	r.writer.Header().Set(name, value)
}

func (r *peerClientRequestIDServerResponse) Write(body []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.writer.Write(body)
}

func (r *peerClientRequestIDServerResponse) Flush() error {
	if flusher, ok := r.writer.(http.Flusher); ok {
		flusher.Flush()
	}
	return nil
}

func (r *peerClientRequestIDServerResponse) WriteHeader(status int) {
	r.status = status
	r.writer.WriteHeader(status)
}

func (r *peerClientRequestIDServerResponse) Status() int {
	return r.status
}

func reservePeerClientRequestIDAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}

	return address
}

type peerClientRequestIDStore struct {
	database *gorm.DB
}

func (*peerClientRequestIDStore) Init(
	context.Context,
	...option.Option,
) error {
	return nil
}

func (s *peerClientRequestIDStore) RDS(
	context.Context,
	...corestore.RDSDMLOption,
) (*gorm.DB, error) {
	return s.database, nil
}

func (*peerClientRequestIDStore) Name() string {
	return "peer-client-request-id-test"
}

var (
	peerClientRequestIDStoreOnce sync.Once
	peerClientRequestIDStoreErr  error
)

func ensurePeerClientRequestIDRelayStore(t *testing.T) {
	t.Helper()
	peerClientRequestIDStoreOnce.Do(func() {
		database, err := gorm.Open(
			sqlite.Open(
				fmt.Sprintf(
					"file:peer_client_request_id_%s?mode=memory&cache=shared",
					uuid.NewString(),
				),
			),
			&gorm.Config{},
		)
		if err != nil {
			peerClientRequestIDStoreErr = err
			return
		}
		peerClientRequestIDStoreErr = corestore.InjectStore(
			context.Background(),
			&peerClientRequestIDStore{database: database},
		)
	})
	if peerClientRequestIDStoreErr != nil {
		t.Fatal(peerClientRequestIDStoreErr)
	}
}
