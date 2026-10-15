package key_exchange

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

const (
	keyExchangeSourceStation   = "station:source"
	keyExchangeTargetStation   = "station:target"
	keyExchangeRequesterActor  = "ptid:v1:actor:peers:p:alice:fingerprint"
	keyExchangeRequesterDevice = "alice-device"
	keyExchangeRemoteActor     = "ptid:v1:actor:peers:p:bob:fingerprint"
	keyExchangeRemoteDevice    = "bob-device"
	keyExchangeRequestID       = "request-1"
)

type keyExchangeRelayFixture struct {
	baseURL string
	client  *http.Client
}

func (r keyExchangeRelayFixture) Available() bool { return r.baseURL != "" }

func (r keyExchangeRelayFixture) RoundTrip(
	ctx context.Context,
	targetStationPeerID string,
	request *http.Request,
) (*http.Response, error) {
	if targetStationPeerID != keyExchangeTargetStation {
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

func TestCanonicalFederationPortFetchesDirectBundlesThroughCanonicalRoute(t *testing.T) {
	sourceKeys := newKeyExchangeFederationKeyCache(t)
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		assertKeyExchangeRelayRequest(
			t,
			request,
			FederationDirectKeyBundlesFetchRoute,
			FederationDirectKeyBundlesFetchScope,
			peerKeys,
			map[string]string{
				keyExchangeClaimActorPTID:       keyExchangeRemoteActor,
				keyExchangeClaimDeviceID:        keyExchangeRemoteDevice,
				keyExchangeClaimRequestID:       keyExchangeRequestID,
				keyExchangeClaimRequesterPTID:   keyExchangeRequesterActor,
				keyExchangeClaimRequesterDevice: keyExchangeRequesterDevice,
				keyExchangeClaimSourceStationID: keyExchangeSourceStation,
				keyExchangeClaimTargetStationID: keyExchangeTargetStation,
			},
		)
		var decoded kemodel.FetchFederatedDirectKeyBundlesRequest
		decodeKeyExchangeRequest(t, request, &decoded)
		nested := decoded.GetRequest()
		if decoded.GetSourceHomeStationPeerId() != keyExchangeSourceStation ||
			nested.GetActor().GetPtid() != keyExchangeRemoteActor ||
			nested.GetTargetDeviceId() != keyExchangeRemoteDevice ||
			nested.GetHomeStationPeerId() != keyExchangeTargetStation ||
			nested.GetRequestId() != keyExchangeRequestID ||
			nested.GetRequester().GetActor().GetPtid() !=
				keyExchangeRequesterActor ||
			nested.GetRequester().GetDeviceId() !=
				keyExchangeRequesterDevice {
			t.Errorf("unexpected Direct fetch request: %+v", &decoded)
		}

		writeKeyExchangeResponse(
			t,
			writer,
			&kemodel.FetchFederatedDirectKeyBundlesResponse{
				Response: &kemodel.FetchDirectKeyBundlesResponse{
					Bundles: []*kemodel.DirectKeyBundle{
						canonicalRemoteDirectBundle(),
					},
				},
			},
		)
	}))
	defer server.Close()

	port := newFederationQueryPort(
		server.Client(),
		sourceKeys,
		keyExchangeRelayFixture{baseURL: server.URL},
	)
	bundles, err := port.FetchDirectKeyBundles(
		context.Background(),
		keyExchangeTargetStation,
		federationTestIdentity(keyExchangeRequestID),
		keyExchangeRemoteActor,
		keyExchangeRemoteDevice,
	)
	if err != nil {
		t.Fatalf("fetch Direct bundles: %v", err)
	}
	if len(bundles) != 1 ||
		bundles[0].Device.ActorPTID != keyExchangeRemoteActor ||
		bundles[0].Device.DeviceID != keyExchangeRemoteDevice ||
		len(bundles[0].OneTimePreKeys) != 1 {
		t.Fatalf("unexpected Direct bundles: %+v", bundles)
	}
}

func TestCanonicalFederationPortFetchesAllDirectBundlesThroughCanonicalRoute(t *testing.T) {
	sourceKeys := newKeyExchangeFederationKeyCache(t)
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		assertKeyExchangeRelayRequest(
			t,
			request,
			FederationDirectKeyBundlesFetchRoute,
			FederationDirectKeyBundlesFetchScope,
			peerKeys,
			map[string]string{
				keyExchangeClaimActorPTID:       keyExchangeRemoteActor,
				keyExchangeClaimDeviceID:        "",
				keyExchangeClaimRequestID:       keyExchangeRequestID,
				keyExchangeClaimRequesterPTID:   keyExchangeRequesterActor,
				keyExchangeClaimRequesterDevice: keyExchangeRequesterDevice,
				keyExchangeClaimSourceStationID: keyExchangeSourceStation,
				keyExchangeClaimTargetStationID: keyExchangeTargetStation,
			},
		)
		var decoded kemodel.FetchFederatedDirectKeyBundlesRequest
		decodeKeyExchangeRequest(t, request, &decoded)
		if decoded.GetRequest().GetTargetDeviceId() != "" {
			t.Errorf("unexpected targeted Direct fetch: %+v", &decoded)
		}
		first := canonicalRemoteDirectBundle()
		second := proto.Clone(first).(*kemodel.DirectKeyBundle)
		second.Device.DeviceId = "bob-device-2"
		writeKeyExchangeResponse(
			t,
			writer,
			&kemodel.FetchFederatedDirectKeyBundlesResponse{
				Response: &kemodel.FetchDirectKeyBundlesResponse{
					Bundles: []*kemodel.DirectKeyBundle{first, second},
				},
			},
		)
	}))
	defer server.Close()

	port := newFederationQueryPort(
		server.Client(),
		sourceKeys,
		keyExchangeRelayFixture{baseURL: server.URL},
	)
	bundles, err := port.FetchDirectKeyBundles(
		context.Background(),
		keyExchangeTargetStation,
		federationTestIdentity(keyExchangeRequestID),
		keyExchangeRemoteActor,
		"",
	)
	if err != nil {
		t.Fatalf("fetch all Direct bundles: %v", err)
	}
	if len(bundles) != 2 ||
		bundles[0].Device.DeviceID != keyExchangeRemoteDevice ||
		bundles[1].Device.DeviceID != "bob-device-2" {
		t.Fatalf("unexpected Direct bundles: %+v", bundles)
	}
}

func TestCanonicalFederationPortFetchesMLSKeyPackageThroughCanonicalRoute(t *testing.T) {
	sourceKeys := newKeyExchangeFederationKeyCache(t)
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	keyPackage := []byte("remote-mls-key-package")
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		assertKeyExchangeRelayRequest(
			t,
			request,
			FederationMLSKeyPackageFetchRoute,
			FederationMLSKeyPackageFetchScope,
			peerKeys,
			map[string]string{
				keyExchangeClaimActorPTID:       keyExchangeRemoteActor,
				keyExchangeClaimRequestID:       keyExchangeRequestID,
				keyExchangeClaimRequesterPTID:   keyExchangeRequesterActor,
				keyExchangeClaimRequesterDevice: keyExchangeRequesterDevice,
				keyExchangeClaimSourceStationID: keyExchangeSourceStation,
				keyExchangeClaimTargetStationID: keyExchangeTargetStation,
			},
		)
		var decoded kemodel.FetchFederatedMlsKeyPackageRequest
		decodeKeyExchangeRequest(t, request, &decoded)
		nested := decoded.GetRequest()
		if decoded.GetSourceHomeStationPeerId() != keyExchangeSourceStation ||
			nested.GetActor().GetPtid() != keyExchangeRemoteActor ||
			nested.GetHomeStationPeerId() != keyExchangeTargetStation ||
			nested.GetRequestId() != keyExchangeRequestID ||
			nested.GetRequester().GetActor().GetPtid() !=
				keyExchangeRequesterActor ||
			nested.GetRequester().GetDeviceId() !=
				keyExchangeRequesterDevice {
			t.Errorf("unexpected MLS fetch request: %+v", &decoded)
		}

		writeKeyExchangeResponse(
			t,
			writer,
			&kemodel.FetchFederatedMlsKeyPackageResponse{
				Response: &kemodel.FetchMlsKeyPackageResponse{
					Reservation:       canonicalRemoteReservation(keyPackage),
					Available:         true,
					HomeStationPeerId: keyExchangeTargetStation,
				},
			},
		)
	}))
	defer server.Close()

	port := newFederationQueryPort(
		server.Client(),
		sourceKeys,
		keyExchangeRelayFixture{baseURL: server.URL},
	)
	reservation, err := port.FetchMLSKeyPackage(
		context.Background(),
		keyExchangeTargetStation,
		federationTestIdentity(keyExchangeRequestID),
		keyExchangeRemoteActor,
	)
	if err != nil {
		t.Fatalf("fetch MLS KeyPackage: %v", err)
	}
	if reservation == nil ||
		reservation.Target != (domain.Endpoint{
			ActorPTID: keyExchangeRemoteActor,
			DeviceID:  keyExchangeRemoteDevice,
		}) ||
		reservation.HomeStation != keyExchangeTargetStation ||
		!reservation.IrreversiblyConsumed {
		t.Fatalf("unexpected MLS reservation: %+v", reservation)
	}
}

func TestCanonicalFederationPortClaimsMLSKeyPackageWithExactPlanBinding(t *testing.T) {
	sourceKeys := newKeyExchangeFederationKeyCache(t)
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	expiresAt := time.Now().UTC().Add(2 * time.Minute).Truncate(time.Microsecond)
	keyPackage := []byte("claimed-remote-mls-key-package")
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		request *http.Request,
	) {
		assertKeyExchangeRelayRequest(
			t,
			request,
			FederationMLSKeyPackageClaimRoute,
			FederationMLSKeyPackageClaimScope,
			peerKeys,
			map[string]string{
				keyExchangeClaimAuthorityPlan:   "plan-1",
				keyExchangeClaimActorPTID:       keyExchangeRemoteActor,
				keyExchangeClaimDeviceID:        keyExchangeRemoteDevice,
				keyExchangeClaimRequestID:       "claim-request-1",
				keyExchangeClaimPlanExpiresAt:   expiresAt.Format(time.RFC3339Nano),
				keyExchangeClaimSourceStationID: keyExchangeSourceStation,
				keyExchangeClaimTargetStationID: keyExchangeTargetStation,
			},
		)
		var decoded kemodel.ClaimMlsKeyPackageRequest
		decodeKeyExchangeRequest(t, request, &decoded)
		if decoded.GetAuthorityPlanId() != "plan-1" ||
			decoded.GetAuthorityStationPeerId() != keyExchangeSourceStation ||
			decoded.GetTarget().GetActor().GetPtid() != keyExchangeRemoteActor ||
			decoded.GetTarget().GetDeviceId() != keyExchangeRemoteDevice ||
			decoded.GetRequestId() != "claim-request-1" ||
			!decoded.GetPlanExpiresAt().AsTime().Equal(expiresAt) {
			t.Errorf("unexpected MLS claim request: %+v", &decoded)
		}

		writeKeyExchangeResponse(t, writer, &kemodel.ClaimMlsKeyPackageResponse{
			Reservation:          canonicalRemoteReservation(keyPackage),
			HomeStationPeerId:    keyExchangeTargetStation,
			IrreversiblyConsumed: true,
		})
	}))
	defer server.Close()

	port := newFederationQueryPort(
		server.Client(),
		sourceKeys,
		keyExchangeRelayFixture{baseURL: server.URL},
	)
	claim := domain.MLSKeyPackageClaim{
		AuthenticatedAuthorityStation: keyExchangeSourceStation,
		RequestID:                     "claim-request-1",
		RequestSHA256:                 sha256.Sum256([]byte("claim-request-1")),
		AuthorityPlanID:               "plan-1",
		AuthorityStationID:            keyExchangeSourceStation,
		Target: domain.Endpoint{
			ActorPTID: keyExchangeRemoteActor,
			DeviceID:  keyExchangeRemoteDevice,
		},
		PlanExpiresAt: expiresAt,
	}
	reservation, err := port.ClaimMLSKeyPackage(
		context.Background(),
		keyExchangeTargetStation,
		claim,
	)
	if err != nil {
		t.Fatalf("claim MLS KeyPackage: %v", err)
	}
	if reservation.PlanID != claim.AuthorityPlanID ||
		reservation.Target != claim.Target ||
		!reservation.PlanExpiresAt.Equal(claim.PlanExpiresAt) ||
		reservation.HomeStation != keyExchangeTargetStation ||
		!reservation.IrreversiblyConsumed {
		t.Fatalf("unexpected claimed reservation: %+v", reservation)
	}
}

func TestCanonicalFederationPortRejectsMismatchedRemoteDevice(t *testing.T) {
	sourceKeys := newKeyExchangeFederationKeyCache(t)
	server := httptest.NewServer(http.HandlerFunc(func(
		writer http.ResponseWriter,
		_ *http.Request,
	) {
		bundle := canonicalRemoteDirectBundle()
		bundle.Device.DeviceId = "other-device"
		writeKeyExchangeResponse(
			t,
			writer,
			&kemodel.FetchFederatedDirectKeyBundlesResponse{
				Response: &kemodel.FetchDirectKeyBundlesResponse{
					Bundles: []*kemodel.DirectKeyBundle{bundle},
				},
			},
		)
	}))
	defer server.Close()

	port := newFederationQueryPort(
		server.Client(),
		sourceKeys,
		keyExchangeRelayFixture{baseURL: server.URL},
	)
	_, err := port.FetchDirectKeyBundles(
		context.Background(),
		keyExchangeTargetStation,
		federationTestIdentity(keyExchangeRequestID),
		keyExchangeRemoteActor,
		keyExchangeRemoteDevice,
	)
	if !domain.IsCode(err, domain.ErrorCodeConflict) {
		t.Fatalf("mismatched remote device error = %v", err)
	}
}

func newKeyExchangeFederationKeyCache(t *testing.T) *authfed.KeyCache {
	t.Helper()
	if err := registerKeyExchangeFederationScopes(); err != nil {
		t.Fatalf("register Key Exchange Federation scopes: %v", err)
	}
	cache := authfed.NewKeyCache(
		authfed.NewInMemoryKeyStore(),
		authfed.WithRecheckTTL(0),
	)
	if _, err := cache.Get(context.Background()); err != nil {
		t.Fatalf("initialize Federation key cache: %v", err)
	}

	return cache
}

func federationTestIdentity(requestID string) domain.DestructiveReadIdentity {
	return domain.DestructiveReadIdentity{
		RequestID: requestID,
		Requester: domain.Endpoint{
			ActorPTID: keyExchangeRequesterActor,
			DeviceID:  keyExchangeRequesterDevice,
		},
		RequestSHA256: sha256.Sum256([]byte(requestID)),
	}
}

func newFederationQueryPort(
	client *http.Client,
	keys *authfed.KeyCache,
	relay keyExchangeRelayFixture,
) *canonicalFederationPort {
	relay.client = client
	return &canonicalFederationPort{
		keys:           keys,
		client:         client,
		relay:          relay,
		clock:          systemClock{},
		localStationID: keyExchangeSourceStation,
	}
}

func assertKeyExchangeRelayRequest(
	t *testing.T,
	request *http.Request,
	route string,
	scopeName string,
	peerKeys authfed.PeerKeyStore,
	expectedClaims map[string]string,
) {
	t.Helper()
	if request.URL.Path != route {
		t.Errorf("request path = %q, want %q", request.URL.Path, route)
	}
	innerAuthorization := strings.TrimPrefix(
		request.Header.Get("Authorization"),
		"Bearer ",
	)
	claims, err := authfed.Verify(
		request.Context(),
		peerKeys,
		innerAuthorization,
		scopeName,
		keyExchangeTargetStation,
	)
	if err != nil {
		t.Errorf("verify inner Federation token: %v", err)
		return
	}
	if claims.Issuer != keyExchangeSourceStation ||
		claims.Subject != keyExchangeSourceStation ||
		claims.Audience != keyExchangeTargetStation ||
		!reflect.DeepEqual(claims.Custom, expectedClaims) {
		t.Errorf("unexpected Federation claims: %+v", claims)
	}
}

func decodeKeyExchangeRequest(
	t *testing.T,
	request *http.Request,
	message proto.Message,
) {
	t.Helper()
	body, err := io.ReadAll(request.Body)
	if err != nil {
		t.Errorf("read request: %v", err)
		return
	}
	if err := proto.Unmarshal(body, message); err != nil {
		t.Errorf("decode request: %v", err)
	}
}

func writeKeyExchangeResponse(
	t *testing.T,
	writer http.ResponseWriter,
	message proto.Message,
) {
	t.Helper()
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		t.Errorf("encode response: %v", err)
		writer.WriteHeader(http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/protobuf")
	writer.WriteHeader(http.StatusOK)
	if _, err := writer.Write(body); err != nil {
		t.Errorf("write response: %v", err)
	}
}

func canonicalRemoteDirectBundle() *kemodel.DirectKeyBundle {
	return &kemodel.DirectKeyBundle{
		Device: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: keyExchangeRemoteActor},
			DeviceId: keyExchangeRemoteDevice,
		},
		IdentityKeyPublic: base64.StdEncoding.EncodeToString(
			bytesOfLength(domain.DirectIdentityPublicKeyBytes, 1),
		),
		SignedPreKeyId: 1,
		SignedPreKeyPublic: base64.StdEncoding.EncodeToString(
			bytesOfLength(domain.DirectSignedPreKeyPublicBytes, 2),
		),
		SignedPreKeySignature: base64.StdEncoding.EncodeToString(
			bytesOfLength(domain.DirectSignedPreKeySignatureLen, 3),
		),
		OneTimePreKeys: []*kemodel.DirectOneTimePreKey{{
			KeyId: 1,
			PublicKey: base64.StdEncoding.EncodeToString(
				bytesOfLength(domain.DirectOneTimePreKeyPublicBytes, 4),
			),
		}},
		PublishedAtUnixMs:     time.Now().UTC().UnixMilli(),
		SupportedWireVersions: []uint32{0, 1},
	}
}

func canonicalRemoteReservation(
	keyPackage []byte,
) *kemodel.MlsKeyPackageReservation {
	hash := domain.HashMLSKeyPackage(keyPackage)
	return &kemodel.MlsKeyPackageReservation{
		Target: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: keyExchangeRemoteActor},
			DeviceId: keyExchangeRemoteDevice,
		},
		PackageId:        "package-1",
		KeyPackage:       append([]byte(nil), keyPackage...),
		KeyPackageSha256: append([]byte(nil), hash[:]...),
	}
}

func bytesOfLength(length int, value byte) []byte {
	result := make([]byte, length)
	for index := range result {
		result[index] = value
	}
	return result
}
