package key_exchange

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	deliveryapplication "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	deliveryinfrastructure "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/delivery"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestHandlersExposeOnlyCanonicalClientRoutes(t *testing.T) {
	subserver := &subServer{}
	handlers := subserver.Handlers()
	expected := map[string]server.Method{
		uploadDirectKeyBundlePath:        server.POST,
		fetchDirectKeyBundlesPath:        server.POST,
		replenishDirectOneTimePreKeyPath: server.POST,
		countDirectOneTimePreKeyPath:     server.GET,
		uploadMLSKeyPackagePath:          server.POST,
		fetchMLSKeyPackagePath:           server.POST,
		countMLSKeyPackagesPath:          server.GET,
		sendDirectKeyExchangePath:        server.POST,
	}
	if len(handlers) != len(expected) {
		t.Fatalf("handler count = %d, want %d", len(handlers), len(expected))
	}
	for _, handler := range handlers {
		method, ok := expected[handler.Path()]
		if !ok {
			t.Fatalf("unexpected Key Exchange route %s %s", handler.Method(), handler.Path())
		}
		if handler.Method() != method {
			t.Fatalf(
				"route %s method = %s, want %s",
				handler.Path(),
				handler.Method(),
				method,
			)
		}
		delete(expected, handler.Path())
	}
	if len(expected) != 0 {
		t.Fatalf("missing canonical routes: %+v", expected)
	}
}

func TestComposeBuildsCanonicalStoresAndAdapters(t *testing.T) {
	database, err := gorm.Open(
		sqlite.Open(
			"file:key-exchange-composition-"+uuid.NewString()+
				"?mode=memory&cache=shared",
		),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open key exchange composition database: %v", err)
	}
	if err := database.AutoMigrate(
		&actoridentitypersistence.ActorDeviceModel{},
	); err != nil {
		t.Fatalf("migrate Actor Device owner schema: %v", err)
	}
	inboxRepository, err := deliveryinfrastructure.NewRepository(
		database,
		deliveryapplication.QueueLimits{
			MaxUnackedItems: defaultDeviceInboxMaxUnackedItems,
			MaxUnackedBytes: defaultDeviceInboxMaxUnackedBytes,
		},
	)
	if err != nil {
		t.Fatalf("create Device Inbox owner repository: %v", err)
	}
	if err := inboxRepository.AutoMigrate(); err != nil {
		t.Fatalf("migrate Device Inbox owner schema: %v", err)
	}
	for _, device := range []actoridentitypersistence.ActorDeviceModel{
		activeDevice("ptid:alice", "alice-1", "station-local"),
		activeDevice("ptid:bob", "bob-1", "station-local"),
	} {
		if err := database.Create(&device).Error; err != nil {
			t.Fatalf("seed active device: %v", err)
		}
	}
	api, err := compose(
		context.Background(),
		database,
		"station-local",
		unavailableTestFederation{},
	)
	if err != nil {
		t.Fatalf("compose canonical Key Exchange: %v", err)
	}
	if api == nil {
		t.Fatal("canonical API was not composed")
	}
	for _, table := range []string{
		"key_exchange_identity_keys",
		"key_exchange_signed_pre_keys",
		"key_exchange_one_time_pre_keys",
		"mls_key_packages",
		"federated_mls_key_package_claims",
	} {
		if !database.Migrator().HasTable(table) {
			t.Fatalf("canonical table %q was not migrated", table)
		}
	}

	response, err := api.SendDirectKeyExchange(
		context.Background(),
		"ptid:alice",
		"alice-1",
		&kemodel.SendDirectKeyExchangeRequest{
			Recipient: &actormodel.ActorDeviceRef{
				Actor:    &actormodel.ActorRef{Ptid: "ptid:bob"},
				DeviceId: "bob-1",
			},
			RecipientHomeStationPeerId: "station-local",
			SessionId:                   "direct-session",
			Kind: kemodel.DirectKeyExchangePayloadKind_DIRECT_KEY_EXCHANGE_PAYLOAD_KIND_PREKEY_BUNDLE,
			OpaqueKeyMaterial: []byte("opaque-key-material"),
			ConversationId:    "conversation-1",
		},
	)
	if err != nil {
		t.Fatalf("send local canonical DKX: %v", err)
	}
	var queued deliveryinfrastructure.DeviceQueueItemModel
	if err := database.Where(
		"item_id = ?",
		response.GetEnvelopeId(),
	).Take(&queued).Error; err != nil {
		t.Fatalf("read canonical Device Inbox item: %v", err)
	}
	if queued.RecipientPTID != "ptid:bob" ||
		queued.RecipientDeviceID != "bob-1" ||
		!bytes.Equal(
			queued.PayloadSHA256,
			domainHash(queued.OpaquePayload),
		) {
		t.Fatalf("unexpected canonical Device Inbox item: %+v", queued)
	}
}

func TestKeyExchangeErrorsMapToStableHTTPStatuses(t *testing.T) {
	for _, testCase := range []struct {
		name string
		code domain.ErrorCode
		want int
	}{
		{
			name: "invalid argument",
			code: domain.ErrorCodeInvalidArgument,
			want: http.StatusBadRequest,
		},
		{
			name: "unauthorized",
			code: domain.ErrorCodeUnauthorized,
			want: http.StatusForbidden,
		},
		{
			name: "not found",
			code: domain.ErrorCodeNotFound,
			want: http.StatusNotFound,
		},
		{
			name: "conflict",
			code: domain.ErrorCodeConflict,
			want: http.StatusConflict,
		},
		{
			name: "stale material",
			code: domain.ErrorCodeStaleMaterial,
			want: http.StatusConflict,
		},
		{
			name: "expired plan",
			code: domain.ErrorCodePlanExpired,
			want: http.StatusConflict,
		},
		{
			name: "payload too large",
			code: domain.ErrorCodePayloadTooLarge,
			want: http.StatusRequestEntityTooLarge,
		},
		{
			name: "dependency",
			code: domain.ErrorCodeDependency,
			want: http.StatusServiceUnavailable,
		},
		{
			name: "internal",
			code: domain.ErrorCodeInternal,
			want: http.StatusInternalServerError,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			mapped := mapKeyExchangeError(domain.NewError(
				testCase.code,
				"test",
				"field",
				"failure",
			))
			var handlerError *server.HandlerError
			if !errors.As(mapped, &handlerError) {
				t.Fatalf("mapped error type = %T, want *server.HandlerError", mapped)
			}
			if handlerError.Code != testCase.want {
				t.Fatalf(
					"HTTP status = %d, want %d",
					handlerError.Code,
					testCase.want,
				)
			}
		})
	}
}

func TestFederationCapabilityIsNarrowAndNotAnHTTPRoute(t *testing.T) {
	subserver := NewKeyExchangeSubServerWithDependencies(Dependencies{
		Federation: unavailableTestFederation{},
	})
	if _, ok := subserver.(FederationCapability); !ok {
		t.Fatal("Key Exchange subserver does not expose FederationCapability")
	}
	if len(subserver.Handlers()) != 8 {
		t.Fatalf(
			"Key Exchange exposed %d routes, want exactly eight client routes",
			len(subserver.Handlers()),
		)
	}
}

func TestDefaultConstructorFailsClosedWithoutFederationPort(t *testing.T) {
	subserver := NewKeyExchangeSubServer()
	err := subserver.Init(context.Background())
	if err == nil {
		t.Fatal("default construction accepted a missing FederationPort")
	}
	if subserver.Status() != server.StatusError {
		t.Fatalf("status = %s, want %s", subserver.Status(), server.StatusError)
	}
}

func activeDevice(
	actorPTID string,
	deviceID string,
	homeStationID string,
) actoridentitypersistence.ActorDeviceModel {
	return actoridentitypersistence.ActorDeviceModel{
		PTID:               actorPTID,
		ActorAccount:       actorPTID + "@example.test",
		ActorKind:          1,
		DeviceID:           deviceID,
		Label:              deviceID,
		HomeStationPeerID:  homeStationID,
		SigningKeyID:       deviceID + "-signing",
		PublicKey:          make([]byte, 32),
		ProfileVersion:     1,
		VerificationSource: 1,
		CreatedAt:          time.Unix(1_800_000_000, 0).UTC(),
	}
}

func domainHash(value []byte) []byte {
	hash := sha256.Sum256(value)
	return hash[:]
}

type unavailableTestFederation struct{}

func (unavailableTestFederation) FetchDirectKeyBundles(
	context.Context,
	string,
	string,
	string,
) ([]domain.DirectKeyBundle, error) {
	return nil, errors.New("not exercised")
}

func (unavailableTestFederation) FetchMLSKeyPackage(
	context.Context,
	string,
	string,
) (*domain.MLSKeyPackageReservation, error) {
	return nil, errors.New("not exercised")
}

func (unavailableTestFederation) ClaimMLSKeyPackage(
	context.Context,
	string,
	domain.MLSKeyPackageClaim,
) (domain.MLSKeyPackageReservation, error) {
	return domain.MLSKeyPackageReservation{}, errors.New("not exercised")
}

func (unavailableTestFederation) EnqueueDirectKeyExchange(
	context.Context,
	string,
	domain.DirectKeyExchangeEnvelope,
) (string, error) {
	return "", errors.New("not exercised")
}
