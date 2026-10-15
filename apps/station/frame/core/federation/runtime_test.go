package federation

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	federationmodel "github.com/peers-labs/peers-touch/station/frame/core/federation/model"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

type runtimeTestRecord struct {
	ID string `gorm:"column:id;size:255;primaryKey"`
}

func (*runtimeTestRecord) TableName() string {
	return "federation_runtime_test_records"
}

type runtimeTestRelay struct {
	baseURL        string
	client         *http.Client
	expectedTarget string
}

func (r runtimeTestRelay) Available() bool {
	return r.baseURL != ""
}

func (r runtimeTestRelay) RoundTrip(
	ctx context.Context,
	targetStationPeerID string,
	request *http.Request,
) (*http.Response, error) {
	if targetStationPeerID != r.expectedTarget {
		return nil, errors.New("unexpected Relay tunnel target")
	}
	base, err := url.Parse(r.baseURL)
	if err != nil {
		return nil, err
	}
	outbound := request.Clone(ctx)
	target := *request.URL
	target.Scheme = base.Scheme
	target.Host = base.Host
	outbound.URL = &target
	outbound.RequestURI = ""
	return r.client.Do(outbound)
}

func TestRuntimeComposesSharedLocalDeliveryAndCanonicalRoutes(t *testing.T) {
	scope.ResetForTest()
	database := openRuntimeTestDatabase(t)
	if err := database.AutoMigrate(&runtimeTestRecord{}); err != nil {
		t.Fatal(err)
	}
	keyCache := authfed.NewKeyCache(
		authfed.NewInMemoryKeyStore(),
		authfed.WithRecheckTTL(0),
	)
	runtime, err := NewRuntime(
		context.Background(),
		RuntimeConfig{
			Database:           database,
			LocalStationPeerID: "station-local",
			KeyCache:           keyCache,
			PeerKeys:           authfed.NewInMemoryPeerKeyStore(),
			Clock:              delivery.SystemClock{},
			HTTPClient:         &http.Client{},
			Relay:              runtimeTestRelay{},
			Dispatcher: delivery.DispatcherConfig{
				WorkerID:      "runtime-test",
				BatchSize:     10,
				LeaseDuration: time.Minute,
				IdleDelay:     time.Millisecond,
				RetryBackoff: delivery.RetryBackoff{
					Initial: time.Second,
					Maximum: time.Minute,
				},
			},
			PeerEndpointResolver: func(PeerRoute) (
				server.EndpointHandler,
				error,
			) {
				return func(
					context.Context,
					server.Request,
					server.Response,
				) error {
					return nil
				}, nil
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtime.RegisterReceivers(func(registry *delivery.Registry) error {
		return delivery.RegisterProtoReceiver(
			registry,
			delivery.PayloadKindSocialFriendRequestCommand,
			func() *wrapperspb.StringValue {
				return &wrapperspb.StringValue{}
			},
			func(
				ctx context.Context,
				transaction delivery.Transaction,
				payload *wrapperspb.StringValue,
				frame *delivery.Frame,
			) (delivery.Result, error) {
				result := transaction.DB().WithContext(ctx).
					Clauses(clause.OnConflict{DoNothing: true}).
					Create(&runtimeTestRecord{ID: payload.GetValue()})
				if result.Error != nil {
					return delivery.Result{}, result.Error
				}

				return delivery.AcceptedResult(), nil
			},
		)
	}); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		wrapperspb.String("domain-write"),
	)
	if err != nil {
		t.Fatal(err)
	}
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             "frame-local",
		SourceStationPeerId: "station-local",
		TargetStationPeerId: "station-local",
		IdempotencyKey:      "idempotency-local",
		PayloadKind:         delivery.PayloadKindSocialFriendRequestCommand,
		PayloadId:           "domain-write",
		OrderingKey:         "social:domain-write",
		OrderingSequence:    1,
		OpaquePayload:       payload,
		IssuedAt:            timestamppb.New(now),
		ExpiresAt:           timestamppb.New(now.Add(time.Hour)),
	}
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		delivery.DefaultFramePolicy("station-local"),
		runtime.Signer(),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.DeliverConversationTyping(
		context.Background(),
		frame,
	); !errors.Is(err, delivery.ErrInvalidFrame) {
		t.Fatalf("durable payload ephemeral delivery error = %v", err)
	}
	if _, err := runtime.repository.Enqueue(
		context.Background(),
		frame,
		now,
	); err != nil {
		t.Fatal(err)
	}
	report, err := runtime.dispatcher.DispatchOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report.Delivered != 1 {
		t.Fatalf("dispatch report = %+v", report)
	}

	var domainCount int64
	if err := database.Model(&runtimeTestRecord{}).Count(&domainCount).Error; err != nil {
		t.Fatal(err)
	}
	if domainCount != 1 {
		t.Fatalf("domain rows = %d, want 1", domainCount)
	}

	handlers := runtime.Handlers()
	expectedRoutes := map[string]server.Method{
		DeliveryRoute: server.POST,
	}
	for _, spec := range peerRouteSpecs {
		expectedRoutes[spec.path] = spec.method
	}
	if len(handlers) != len(expectedRoutes) {
		t.Fatalf("handlers = %d, want %d", len(handlers), len(expectedRoutes))
	}
	for _, handler := range handlers {
		expectedMethod, ok := expectedRoutes[handler.Path()]
		if !ok {
			t.Fatalf("unexpected Federation route %s %s", handler.Method(), handler.Path())
		}
		if handler.Method() != expectedMethod {
			t.Fatalf(
				"Federation route %s method = %s, want %s",
				handler.Path(),
				handler.Method(),
				expectedMethod,
			)
		}
		delete(expectedRoutes, handler.Path())
	}
	if len(expectedRoutes) != 0 {
		t.Fatalf("canonical Federation routes are missing: %+v", expectedRoutes)
	}
}

func TestRuntimeSealsReceiverRegistry(t *testing.T) {
	scope.ResetForTest()
	var retainedRegistry *delivery.Registry
	runtime, err := NewRuntime(
		context.Background(),
		RuntimeConfig{
			Database:           openRuntimeTestDatabase(t),
			LocalStationPeerID: "station-local",
			KeyCache: authfed.NewKeyCache(
				authfed.NewInMemoryKeyStore(),
				authfed.WithRecheckTTL(0),
			),
			PeerKeys:   authfed.NewInMemoryPeerKeyStore(),
			Clock:      delivery.SystemClock{},
			HTTPClient: &http.Client{},
			Relay:      runtimeTestRelay{},
			Dispatcher: delivery.DispatcherConfig{
				WorkerID:      "runtime-test",
				BatchSize:     1,
				LeaseDuration: time.Minute,
				IdleDelay:     time.Millisecond,
				RetryBackoff: delivery.RetryBackoff{
					Initial: time.Second,
					Maximum: time.Minute,
				},
			},
			PeerEndpointResolver: func(PeerRoute) (
				server.EndpointHandler,
				error,
			) {
				return func(
					context.Context,
					server.Request,
					server.Response,
				) error {
					return nil
				}, nil
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtime.RegisterReceivers(func(registry *delivery.Registry) error {
		retainedRegistry = registry

		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := runtime.Seal(); err != nil {
		t.Fatal(err)
	}
	err = runtime.RegisterReceivers(func(*delivery.Registry) error {
		return nil
	})
	if !errors.Is(err, delivery.ErrInvalidArgument) {
		t.Fatalf("late registration error = %v", err)
	}
	err = retainedRegistry.Register(
		delivery.PayloadKindSocialFriendRequestCommand,
		delivery.ReceiverFunc(func(
			context.Context,
			delivery.Transaction,
			*delivery.Frame,
		) (delivery.Result, error) {
			return delivery.AcceptedResult(), nil
		}),
	)
	if !errors.Is(err, delivery.ErrInvalidArgument) {
		t.Fatalf("retained registry registration error = %v", err)
	}
}

func TestHTTPTransportUsesOpaqueRelayTunnelAndTypedResult(t *testing.T) {
	scope.ResetForTest()
	if err := RegisterPeerScopes(); err != nil {
		t.Fatal(err)
	}
	keyCache := authfed.NewKeyCache(
		authfed.NewInMemoryKeyStore(),
		authfed.WithRecheckTTL(0),
	)
	signer, err := newStationSigner(context.Background(), keyCache)
	if err != nil {
		t.Fatal(err)
	}

	peerServer := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		if request.URL.Path != DeliveryRoute {
			t.Errorf("path = %q", request.URL.Path)
		}
		if !strings.HasPrefix(
			request.Header.Get("Authorization"),
			"Bearer ",
		) {
			t.Errorf("inner Federation authorization is missing")
		}
		body, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Error(readErr)
		}
		var decoded federationmodel.DeliverFederatedDomainFrameRequest
		if err := proto.Unmarshal(body, &decoded); err != nil {
			t.Error(err)
		}
		if decoded.GetFrame().GetFrameId() != "frame-remote" {
			t.Errorf("frame id = %q", decoded.GetFrame().GetFrameId())
		}
		payload, marshalErr := proto.Marshal(
			&federationmodel.DeliverFederatedDomainFrameResponse{
				Disposition: delivery.DispositionAccepted,
			},
		)
		if marshalErr != nil {
			t.Error(marshalErr)
		}
		response.Header().Set("Content-Type", "application/protobuf")
		response.WriteHeader(http.StatusOK)
		if _, err := response.Write(payload); err != nil {
			t.Error(err)
		}
	}))
	defer peerServer.Close()

	transport, err := NewHTTPTransport(
		peerServer.Client(),
		keyCache,
		"station-source",
		nil,
		runtimeTestRelay{
			baseURL:        peerServer.URL,
			client:         peerServer.Client(),
			expectedTarget: "station-target",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             "frame-remote",
		SourceStationPeerId: "station-source",
		TargetStationPeerId: "station-target",
		IdempotencyKey:      "idempotency-remote",
		PayloadKind:         delivery.PayloadKindSocialFriendRequestCommand,
		PayloadId:           "payload-remote",
		OrderingKey:         "social:payload-remote",
		OrderingSequence:    1,
		OpaquePayload:       []byte("opaque"),
		IssuedAt:            timestamppb.New(now),
		ExpiresAt:           timestamppb.New(now.Add(time.Hour)),
	}
	if err := delivery.SignFrame(
		context.Background(),
		frame,
		delivery.DefaultFramePolicy("station-target"),
		signer,
	); err != nil {
		t.Fatal(err)
	}

	result, err := transport.Deliver(context.Background(), frame)
	if err != nil {
		t.Fatal(err)
	}
	if result != delivery.AcceptedResult() {
		t.Fatalf("result = %+v", result)
	}
}

func openRuntimeTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(
			"file:"+uuid.NewString()+"?mode=memory&cache=shared&_busy_timeout=5000",
		),
		&gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)},
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
			t.Errorf("close runtime test database: %v", err)
		}
	})

	return database
}

var _ delivery.Signer = (*stationSigner)(nil)
var _ RelayAccess = runtimeTestRelay{}
