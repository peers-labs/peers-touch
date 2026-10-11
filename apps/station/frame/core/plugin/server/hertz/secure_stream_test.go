package hertz

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	relayclient "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/client"
	"github.com/multiformats/go-multiaddr"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/transport/securehttp"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

const secureHTTPTestCapability = "station.http.v1"

func TestSecureHTTPDirectAndCircuitUseCanonicalHertzRouter(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	fixture := newSecureHTTPHandlerFixture()
	backendURL := startSecureHTTPTestRouter(t, fixture.handlers())
	rootKey := generateSecureHTTPNodeKey(t)
	directKey := generateSecureHTTPNodeKey(t)
	circuitKey := generateSecureHTTPNodeKey(t)
	directHost := newSecureHTTPHost(t, directKey)
	circuitHost := newSecureHTTPHost(t, circuitKey)
	clientHost := newSecureHTTPHost(t, nil)
	relayHost := newSecureHTTPRelay(t)
	t.Cleanup(func() {
		_ = clientHost.Close()
		_ = circuitHost.Close()
		_ = directHost.Close()
		_ = relayHost.Close()
	})

	directIdentity := newSecureHTTPIdentity(t, directKey)
	circuitIdentity := newSecureHTTPIdentity(t, circuitKey)
	directIngress := attachSecureHTTPIngress(
		t,
		directHost,
		directIdentity,
		backendURL,
	)
	circuitIngress := attachSecureHTTPIngress(
		t,
		circuitHost,
		circuitIdentity,
		backendURL,
	)
	t.Cleanup(func() {
		_ = circuitIngress.Close()
		_ = directIngress.Close()
	})

	directAddress := hostDialAddress(t, directHost)
	directRoute := signSecureHTTPRoute(
		t,
		rootKey,
		directKey,
		directIdentity,
		peerpb.StationRouteKind_STATION_ROUTE_KIND_DIRECT,
		"",
		directAddress,
	)
	directClient := connectSecureHTTPRoute(
		t,
		ctx,
		clientHost,
		directRoute,
		"",
	)
	t.Cleanup(directClient.CloseIdleConnections)
	assertCanonicalRouteProbe(t, ctx, directClient, "direct")

	relayInfo := peer.AddrInfo{
		ID:    relayHost.ID(),
		Addrs: relayHost.Addrs(),
	}
	if _, err := relayclient.Reserve(ctx, circuitHost, relayInfo); err != nil {
		t.Fatalf("reserve Circuit Relay route: %v", err)
	}
	circuitAddress := circuitDialAddress(t, relayHost, circuitHost.ID())
	circuitRoute := signSecureHTTPRoute(
		t,
		rootKey,
		circuitKey,
		circuitIdentity,
		peerpb.StationRouteKind_STATION_ROUTE_KIND_CIRCUIT,
		relayHost.ID().String(),
		circuitAddress,
	)
	circuitClient := connectSecureHTTPRoute(
		t,
		ctx,
		clientHost,
		circuitRoute,
		relayHost.ID().String(),
	)
	t.Cleanup(circuitClient.CloseIdleConnections)
	assertCanonicalRouteProbe(t, ctx, circuitClient, "circuit")
	if !hasLimitedConnection(clientHost, circuitHost.ID()) {
		t.Fatal("Circuit HTTP/2 route did not use a limited Relay connection")
	}

	assertCanonicalProtobufError(t, ctx, circuitClient)
	assertStreamingUpload(t, ctx, directClient, fixture)
	assertStreamingDownload(t, ctx, directClient, fixture)
	assertSSEFlush(t, ctx, circuitClient, fixture)
	assertCancellation(t, directClient, fixture)

	if fixture.wrapperCalls.Load() < 2 {
		t.Fatalf(
			"canonical Hertz wrapper calls = %d, want at least 2",
			fixture.wrapperCalls.Load(),
		)
	}
	if directHost.ID() == circuitHost.ID() {
		t.Fatal("independent Station nodes reused one PeerID")
	}
	if directIdentity.PeerID() != directHost.ID() ||
		circuitIdentity.PeerID() != circuitHost.ID() {
		t.Fatal("node TLS identity is not bound to its libp2p Host key")
	}
}

func TestSecureHTTPRejectsWrongRouteSPKIBeforeRequestBody(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var backendCalls atomic.Int32
	backendURL := startSecureHTTPTestRouter(t, []server.Handler{
		server.NewHTTPHandler(
			"credential-probe",
			"/credential-probe",
			server.POST,
			func(
				_ context.Context,
				request server.Request,
				response server.Response,
			) error {
				backendCalls.Add(1)
				_, _ = io.ReadAll(request.(server.StreamingRequest).BodyStream())
				response.WriteHeader(http.StatusNoContent)
				return nil
			},
		),
	})
	nodeKey := generateSecureHTTPNodeKey(t)
	nodeHost := newSecureHTTPHost(t, nodeKey)
	clientHost := newSecureHTTPHost(t, nil)
	t.Cleanup(func() {
		_ = clientHost.Close()
		_ = nodeHost.Close()
	})
	identity := newSecureHTTPIdentity(t, nodeKey)
	ingress := attachSecureHTTPIngress(t, nodeHost, identity, backendURL)
	t.Cleanup(func() { _ = ingress.Close() })
	if err := clientHost.Connect(ctx, peer.AddrInfo{
		ID:    nodeHost.ID(),
		Addrs: nodeHost.Addrs(),
	}); err != nil {
		t.Fatal(err)
	}

	wrongSPKI := sha256.Sum256([]byte("substituted-route-spki"))
	client, err := securehttp.NewClient(securehttp.ClientConfig{
		Host:         clientHost,
		TargetPeerID: nodeHost.ID(),
		ExpectedSPKI: wrongSPKI,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	body := &countingBody{Reader: strings.NewReader("station-credential")}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://station.test/credential-probe",
		body,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.RoundTrip(request); err == nil {
		t.Fatal("substituted route SPKI reached HTTP/2")
	}
	if backendCalls.Load() != 0 {
		t.Fatal("substituted route SPKI reached the canonical router")
	}
	if body.reads.Load() != 0 {
		t.Fatal("request credentials were read before route authentication")
	}
}

func TestSecureHTTPIngressCloseDoesNotCloseBorrowedHost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	nodeKey := generateSecureHTTPNodeKey(t)
	nodeHost := newSecureHTTPHost(t, nodeKey)
	defer nodeHost.Close()
	identity := newSecureHTTPIdentity(t, nodeKey)
	backendURL, err := url.Parse("http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	ingress := attachSecureHTTPIngress(t, nodeHost, identity, backendURL)
	if err := ingress.Close(); err != nil {
		t.Fatal(err)
	}
	probeHost := newSecureHTTPHost(t, nil)
	defer probeHost.Close()
	if err := probeHost.Connect(ctx, peer.AddrInfo{
		ID:    nodeHost.ID(),
		Addrs: nodeHost.Addrs(),
	}); err != nil {
		t.Fatalf("closing secure HTTP ingress closed its borrowed Host: %v", err)
	}
}

type secureHTTPHandlerFixture struct {
	wrapperCalls   atomic.Int32
	uploadFirst    chan string
	uploadContinue chan struct{}
	downloadClosed chan struct{}
	sseFirst       chan struct{}
	sseContinue    chan struct{}
	cancelStarted  chan struct{}
	cancelObserved chan struct{}
}

func newSecureHTTPHandlerFixture() *secureHTTPHandlerFixture {
	return &secureHTTPHandlerFixture{
		uploadFirst:    make(chan string, 1),
		uploadContinue: make(chan struct{}),
		downloadClosed: make(chan struct{}),
		sseFirst:       make(chan struct{}),
		sseContinue:    make(chan struct{}),
		cancelStarted:  make(chan struct{}),
		cancelObserved: make(chan struct{}),
	}
}

func (f *secureHTTPHandlerFixture) handlers() []server.Handler {
	wrapper := func(next server.EndpointHandler) server.EndpointHandler {
		return func(
			ctx context.Context,
			request server.Request,
			response server.Response,
		) error {
			f.wrapperCalls.Add(1)
			response.SetHeader("X-Canonical-Wrapper", "applied")
			return next(ctx, request, response)
		}
	}
	return []server.Handler{
		server.NewHTTPHandler(
			"route-probe",
			"/route/:kind",
			server.GET,
			func(
				_ context.Context,
				request server.Request,
				response server.Response,
			) error {
				contextGetter, ok := request.(interface {
					GetHertzContext() interface{}
				})
				if !ok {
					return fmt.Errorf("Hertz context is unavailable")
				}
				nativeContext, ok := contextGetter.GetHertzContext().(interface {
					Param(string) string
				})
				if !ok {
					return fmt.Errorf("Hertz route parameters are unavailable")
				}
				for name := range request.Header() {
					canonical := http.CanonicalHeaderKey(name)
					if strings.HasPrefix(canonical, "X-Peers-") ||
						strings.HasPrefix(canonical, "X-Forwarded-") {
						response.WriteHeader(http.StatusBadRequest)
						return nil
					}
				}
				_, err := response.Write(
					[]byte(nativeContext.Param("kind")),
				)
				return err
			},
			wrapper,
		),
		newSecureHTTPCanonicalProtobufHandler(),
		server.NewHTTPHandler(
			"stream-upload",
			"/attachment/upload",
			server.POST,
			f.handleUpload,
		),
		server.NewHTTPHandler(
			"stream-download",
			"/attachment/download",
			server.GET,
			f.handleDownload,
		),
		server.NewHTTPHandler(
			"sse",
			"/events/stream",
			server.GET,
			f.handleSSE,
		),
		server.NewHTTPHandler(
			"cancel",
			"/cancel",
			server.POST,
			f.handleCancellation,
		),
	}
}

func (f *secureHTTPHandlerFixture) handleUpload(
	_ context.Context,
	request server.Request,
	response server.Response,
) error {
	streaming, ok := request.(server.StreamingRequest)
	if !ok {
		return fmt.Errorf("upload body is not streaming")
	}
	first := make([]byte, 5)
	if _, err := io.ReadFull(streaming.BodyStream(), first); err != nil {
		return err
	}
	f.uploadFirst <- string(first)
	<-f.uploadContinue
	rest, err := io.ReadAll(streaming.BodyStream())
	if err != nil {
		return err
	}
	_, err = response.Write(append(first, rest...))
	return err
}

func (f *secureHTTPHandlerFixture) handleDownload(
	_ context.Context,
	_ server.Request,
	response server.Response,
) error {
	streaming, ok := response.(server.StreamingResponse)
	if !ok {
		return fmt.Errorf("download response is not streaming")
	}
	payload := []byte("streamed-attachment-body")
	response.SetHeader("Content-Type", "application/octet-stream")
	return streaming.SetBodyStream(
		&closeSignalReader{
			Reader: bytes.NewReader(payload),
			closed: f.downloadClosed,
		},
		int64(len(payload)),
	)
}

func (f *secureHTTPHandlerFixture) handleSSE(
	ctx context.Context,
	_ server.Request,
	response server.Response,
) error {
	response.SetHeader("Content-Type", "text/event-stream")
	if _, err := response.Write([]byte("data: first\n\n")); err != nil {
		return err
	}
	if err := response.Flush(); err != nil {
		return err
	}
	close(f.sseFirst)
	select {
	case <-f.sseContinue:
	case <-ctx.Done():
		return ctx.Err()
	}
	_, err := response.Write([]byte("data: second\n\n"))
	return err
}

func (f *secureHTTPHandlerFixture) handleCancellation(
	_ context.Context,
	request server.Request,
	_ server.Response,
) error {
	close(f.cancelStarted)
	streaming, ok := request.(server.StreamingRequest)
	if !ok {
		return fmt.Errorf("cancellation body is not streaming")
	}
	_, err := io.Copy(io.Discard, streaming.BodyStream())
	close(f.cancelObserved)
	return err
}

func newSecureHTTPCanonicalProtobufHandler() server.Handler {
	return server.NewCanonicalProtobufHandler(
		"canonical-protobuf",
		"/canonical/protobuf",
		server.POST,
		func() *wrapperspb.StringValue { return &wrapperspb.StringValue{} },
		func(
			_ context.Context,
			request *wrapperspb.StringValue,
		) (*wrapperspb.StringValue, error) {
			return &wrapperspb.StringValue{
				Value: "echo:" + request.GetValue(),
			}, nil
		},
		server.CanonicalProtobufHandlerOptions{
			MaxBodyBytes: 1024,
			ErrorCodes: server.CanonicalProtobufErrorCodes{
				Unauthorized:           20001,
				InvalidQueryParameters: 20003,
				InvalidRequestBody:     20004,
				InvalidProtobuf:        20005,
				FailedToReadBody:       20006,
				PayloadTooLarge:        20007,
				InternalServer:         20008,
			},
			ProjectError: func(
				failure server.RouteError,
			) ([]byte, error) {
				return proto.MarshalOptions{Deterministic: true}.Marshal(
					&wrapperspb.Int32Value{Value: failure.StableCode},
				)
			},
		},
	)
}

func startSecureHTTPTestRouter(
	t *testing.T,
	handlers []server.Handler,
) *url.URL {
	t.Helper()
	address := reserveTCPAddress(t)
	option.GetOptions(option.WithRootCtx(context.Background()))
	option.GetOptions(server.WithAddress(address))
	router := NewServer()
	if err := router.Init(); err != nil {
		t.Fatal(err)
	}
	for _, handler := range handlers {
		if err := router.Handle(handler); err != nil {
			t.Fatal(err)
		}
	}
	done := make(chan struct{})
	go func() {
		router.hertz.Spin()
		close(done)
	}()
	waitForTCP(t, address)
	t.Cleanup(func() {
		_ = router.hertz.Engine.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Error("Hertz router did not stop")
		}
	})
	target, err := url.Parse("http://" + address)
	if err != nil {
		t.Fatal(err)
	}
	return target
}

func attachSecureHTTPIngress(
	t *testing.T,
	valueHost host.Host,
	identity *securehttp.NodeTLSIdentity,
	backendURL *url.URL,
) *securehttp.Ingress {
	t.Helper()
	ingress, err := securehttp.NewIngress(securehttp.IngressConfig{
		BackendURL: backendURL,
		Identity:   identity,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ingress.AttachHost(valueHost); err != nil {
		t.Fatal(err)
	}
	return ingress
}

func connectSecureHTTPRoute(
	t *testing.T,
	ctx context.Context,
	clientHost host.Host,
	attestation *peerpb.StationRouteAttestation,
	expectedRelayPeerID string,
) *securehttp.Client {
	t.Helper()
	verified, err := peerpb.VerifyStationRouteAttestation(
		attestation,
		expectedRelayPeerID,
		time.Now(),
	)
	if err != nil {
		t.Fatal(err)
	}
	nodePeerID, err := peer.Decode(verified.Statement.GetNodePeerId())
	if err != nil {
		t.Fatal(err)
	}
	address, err := multiaddr.NewMultiaddr(
		verified.Statement.GetAddresses()[0],
	)
	if err != nil {
		t.Fatal(err)
	}
	info, err := peer.AddrInfoFromP2pAddr(address)
	if err != nil {
		t.Fatal(err)
	}
	if info.ID != nodePeerID {
		t.Fatal("signed route terminates at another PeerID")
	}
	if connectErr := clientHost.Connect(ctx, *info); connectErr != nil {
		t.Fatalf("connect signed Station route: %v", connectErr)
	}
	var expectedSPKI [sha256.Size]byte
	copy(expectedSPKI[:], verified.Statement.GetInnerTlsSpkiSha256())
	client, err := securehttp.NewClient(securehttp.ClientConfig{
		Host:         clientHost,
		TargetPeerID: nodePeerID,
		ExpectedSPKI: expectedSPKI,
	})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func signSecureHTTPRoute(
	t *testing.T,
	rootKey libp2pcrypto.PrivKey,
	nodeKey libp2pcrypto.PrivKey,
	identity *securehttp.NodeTLSIdentity,
	kind peerpb.StationRouteKind,
	relayPeerID string,
	address string,
) *peerpb.StationRouteAttestation {
	t.Helper()
	now := time.Now().UTC()
	capabilities := []string{secureHTTPTestCapability}
	authorization, err := peerpb.SignStationNodeAuthorization(
		rootKey,
		nodeKey.GetPublic(),
		1,
		capabilities,
		now,
		now.Add(time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	verifiedAuthorization, err := peerpb.VerifyStationNodeAuthorization(
		authorization,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	capabilitiesDigest, err := peerpb.StationCapabilitiesDigest(capabilities)
	if err != nil {
		t.Fatal(err)
	}
	spki := identity.SPKISHA256()
	statement := &peerpb.StationRouteStatement{
		StationPeerId:           verifiedAuthorization.Statement.GetStationPeerId(),
		NodePeerId:              verifiedAuthorization.Statement.GetNodePeerId(),
		RelayPeerId:             relayPeerID,
		RouteId:                 "route-" + kind.String(),
		RouteGeneration:         1,
		InnerTlsSpkiSha256:      spki[:],
		CapabilitiesDigest:      capabilitiesDigest[:],
		NodeAuthorizationDigest: verifiedAuthorization.Digest[:],
		Visibility:              peerpb.StationRouteVisibility_STATION_ROUTE_VISIBILITY_PUBLIC,
		Kind:                    kind,
		Addresses:               []string{address},
		IssuedAtUnixMs:          now.UnixMilli(),
		ExpiresAtUnixMs:         now.Add(time.Minute).UnixMilli(),
	}
	attestation, err := peerpb.SignStationRouteAttestation(
		nodeKey,
		authorization,
		statement,
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	return attestation
}

func assertCanonicalRouteProbe(
	t *testing.T,
	ctx context.Context,
	client *securehttp.Client,
	routeKind string,
) {
	t.Helper()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://station.test/route/"+routeKind,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer opaque")
	request.Header.Set("X-Peers-Remote-Peer", "forged")
	request.Header.Set("X-Forwarded-For", "203.0.113.9")
	response, err := client.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK ||
		string(body) != routeKind ||
		response.Header.Get("X-Canonical-Wrapper") != "applied" {
		t.Fatalf(
			"canonical route response status=%d body=%q wrapper=%q",
			response.StatusCode,
			body,
			response.Header.Get("X-Canonical-Wrapper"),
		)
	}
}

func assertCanonicalProtobufError(
	t *testing.T,
	ctx context.Context,
	client *securehttp.Client,
) {
	t.Helper()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://station.test/canonical/protobuf",
		bytes.NewReader([]byte{0x0a, 0x00}),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", server.CanonicalProtobufContentType)
	response, err := client.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	projected := &wrapperspb.Int32Value{}
	if err := proto.Unmarshal(body, projected); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusBadRequest ||
		response.Header.Get("Content-Type") !=
			server.CanonicalProtobufContentType ||
		projected.GetValue() != 20005 {
		t.Fatalf(
			"protobuf error status=%d content-type=%q code=%d",
			response.StatusCode,
			response.Header.Get("Content-Type"),
			projected.GetValue(),
		)
	}
}

func assertStreamingUpload(
	t *testing.T,
	ctx context.Context,
	client *securehttp.Client,
	fixture *secureHTTPHandlerFixture,
) {
	t.Helper()
	reader, writer := io.Pipe()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://station.test/attachment/upload",
		reader,
	)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		response, requestErr := client.RoundTrip(request)
		if requestErr != nil {
			result <- requestErr
			return
		}
		defer response.Body.Close()
		body, readErr := io.ReadAll(response.Body)
		if readErr != nil {
			result <- readErr
			return
		}
		if string(body) != "first-second" {
			result <- fmt.Errorf("upload response = %q", body)
			return
		}
		result <- nil
	}()
	if _, err := writer.Write([]byte("first")); err != nil {
		t.Fatal(err)
	}
	select {
	case first := <-fixture.uploadFirst:
		if first != "first" {
			t.Fatalf("first upload chunk = %q", first)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Hertz handler did not observe the first streaming chunk")
	}
	close(fixture.uploadContinue)
	if _, err := writer.Write([]byte("-second")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func assertStreamingDownload(
	t *testing.T,
	ctx context.Context,
	client *securehttp.Client,
	fixture *secureHTTPHandlerFixture,
) {
	t.Helper()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://station.test/attachment/download",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "streamed-attachment-body" {
		t.Fatalf("download body = %q", body)
	}
	select {
	case <-fixture.downloadClosed:
	case <-time.After(3 * time.Second):
		t.Fatal("streamed download reader was not closed")
	}
}

func assertSSEFlush(
	t *testing.T,
	ctx context.Context,
	client *securehttp.Client,
	fixture *secureHTTPHandlerFixture,
) {
	t.Helper()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://station.test/events/stream",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	<-fixture.sseFirst
	reader := bufio.NewReader(response.Body)
	first, err := reader.ReadString('\n')
	if err != nil || first != "data: first\n" {
		t.Fatalf("first SSE frame = %q, error=%v", first, err)
	}
	if _, separatorErr := reader.ReadString('\n'); separatorErr != nil {
		t.Fatal(separatorErr)
	}
	close(fixture.sseContinue)
	second, err := reader.ReadString('\n')
	if err != nil || second != "data: second\n" {
		t.Fatalf("second SSE frame = %q, error=%v", second, err)
	}
}

func assertCancellation(
	t *testing.T,
	client *securehttp.Client,
	fixture *secureHTTPHandlerFixture,
) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	reader, writer := io.Pipe()
	defer writer.Close()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://station.test/cancel",
		reader,
	)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		response, requestErr := client.RoundTrip(request)
		if response != nil {
			response.Body.Close()
		}
		result <- requestErr
	}()
	select {
	case <-fixture.cancelStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation handler did not start")
	}
	if _, err := writer.Write([]byte("partial")); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case <-fixture.cancelObserved:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP/2 cancellation did not reach the Hertz handler")
	}
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancelled HTTP/2 request returned no error")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled HTTP/2 request did not return")
	}
}

func generateSecureHTTPNodeKey(t *testing.T) libp2pcrypto.PrivKey {
	t.Helper()
	privateKey, _, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return privateKey
}

func newSecureHTTPIdentity(
	t *testing.T,
	privateKey libp2pcrypto.PrivKey,
) *securehttp.NodeTLSIdentity {
	t.Helper()
	identity, err := securehttp.NewNodeTLSIdentity(privateKey, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

func newSecureHTTPHost(
	t *testing.T,
	privateKey libp2pcrypto.PrivKey,
) host.Host {
	t.Helper()
	options := []libp2p.Option{
		libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"),
		libp2p.EnableRelay(),
	}
	if privateKey != nil {
		options = append(options, libp2p.Identity(privateKey))
	}
	valueHost, err := libp2p.New(options...)
	if err != nil {
		t.Fatal(err)
	}
	return valueHost
}

func newSecureHTTPRelay(t *testing.T) host.Host {
	t.Helper()
	valueHost, err := libp2p.New(
		libp2p.ListenAddrStrings("/ip4/127.0.0.1/tcp/0"),
		libp2p.ForceReachabilityPublic(),
		libp2p.EnableRelayService(),
	)
	if err != nil {
		t.Fatal(err)
	}
	return valueHost
}

func hostDialAddress(t *testing.T, valueHost host.Host) string {
	t.Helper()
	info := peer.AddrInfo{ID: valueHost.ID(), Addrs: valueHost.Addrs()}
	addresses, err := peer.AddrInfoToP2pAddrs(&info)
	if err != nil || len(addresses) == 0 {
		t.Fatalf("build Host address: %v", err)
	}
	return addresses[0].String()
}

func circuitDialAddress(
	t *testing.T,
	relayHost host.Host,
	destination peer.ID,
) string {
	t.Helper()
	relayInfo := peer.AddrInfo{
		ID:    relayHost.ID(),
		Addrs: relayHost.Addrs(),
	}
	addresses, err := peer.AddrInfoToP2pAddrs(&relayInfo)
	if err != nil || len(addresses) == 0 {
		t.Fatalf("build Relay address: %v", err)
	}
	suffix, err := multiaddr.NewMultiaddr(
		"/p2p-circuit/p2p/" + destination.String(),
	)
	if err != nil {
		t.Fatal(err)
	}
	return addresses[0].Encapsulate(suffix).String()
}

func hasLimitedConnection(valueHost host.Host, destination peer.ID) bool {
	for _, connection := range valueHost.Network().ConnsToPeer(destination) {
		if connection.Stat().Limited {
			return true
		}
	}
	return false
}

func reserveTCPAddress(t *testing.T) string {
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

func waitForTCP(t *testing.T, address string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if err == nil {
			connection.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("Hertz router did not listen on %s", address)
}

type closeSignalReader struct {
	io.Reader
	closed chan struct{}
}

func (r *closeSignalReader) Close() error {
	close(r.closed)
	return nil
}

type countingBody struct {
	io.Reader
	reads atomic.Int32
}

func (b *countingBody) Read(buffer []byte) (int, error) {
	b.reads.Add(1)
	return b.Reader.Read(buffer)
}

func (b *countingBody) Close() error {
	return nil
}
