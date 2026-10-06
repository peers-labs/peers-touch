package key_exchange

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	sharedfederation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

type federatedContentPreKeyMembership struct {
	err   error
	calls int
}

func (m *federatedContentPreKeyMembership) ValidateActiveStationPair(
	context.Context,
	string,
	string,
	string,
) error {
	m.calls++
	return m.err
}

func TestFederatedContentPreKeyExactReplayAndPlanIsolation(t *testing.T) {
	fixture := newContentPreKeyOperationalFixture(t)
	ctx := context.Background()
	fixture.publish(
		t,
		ctx,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("federated-endpoint-1", 7),
		contentEndpointPreKey("federated-endpoint-2", 7),
	)
	fixture.publish(
		t,
		ctx,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentRecoveryPreKey("federated-recovery-1", 1),
		contentRecoveryPreKey("federated-recovery-2", 1),
	)
	service := fixture.capability.(*subServer).composition.contentPreKeyService
	membership := &federatedContentPreKeyMembership{}
	firstRequest := contentPreKeyClaimRequest(
		"source-plan-one",
		contentPreKeyEndpointTarget(),
		contentPreKeyRecoveryTarget(),
	)
	firstWire := federatedContentPreKeyRequest(t, firstRequest)
	first, err := claimFederatedContentPreKeys(
		ctx,
		service,
		membership,
		"station-source",
		contentPreKeyTestStation,
		firstWire,
	)
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := claimFederatedContentPreKeys(
		ctx,
		service,
		membership,
		"station-source",
		contentPreKeyTestStation,
		proto.Clone(firstWire).(*kemodel.ClaimFederatedContentPreKeysRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.GetResponse().GetExactReplay() {
		t.Fatal("exact federated replay was not reported")
	}
	assertSameContentPreKeyClaims(t, first.GetResponse(), replayed.GetResponse())

	conflict := proto.Clone(firstWire).(*kemodel.ClaimFederatedContentPreKeysRequest)
	conflict.Request.PlanRequestSha256 = bytes.Repeat([]byte{0x7a}, sha256.Size)
	conflict.CanonicalRequestSha256 = canonicalClaimRequestDigest(
		t,
		conflict.GetRequest(),
	)
	_, err = claimFederatedContentPreKeys(
		ctx,
		service,
		membership,
		"station-source",
		contentPreKeyTestStation,
		conflict,
	)
	if domain.CodeOf(err) != domain.ErrorCodeConflict {
		t.Fatalf("changed federated request hash error = %v", err)
	}

	secondRequest := contentPreKeyClaimRequest(
		"source-plan-two",
		contentPreKeyEndpointTarget(),
		contentPreKeyRecoveryTarget(),
	)
	second, err := claimFederatedContentPreKeys(
		ctx,
		service,
		membership,
		"station-source",
		contentPreKeyTestStation,
		federatedContentPreKeyRequest(t, secondRequest),
	)
	if err != nil {
		t.Fatal(err)
	}
	for index := range first.GetResponse().GetClaims() {
		if first.GetResponse().GetClaims()[index].GetPrekey().GetKeyId() ==
			second.GetResponse().GetClaims()[index].GetPrekey().GetKeyId() {
			t.Fatal("distinct federated plans reused a consumed Content PreKey")
		}
	}
	if membership.calls != 4 {
		t.Fatalf("Federation membership checks = %d, want 4", membership.calls)
	}
}

func TestFederatedContentPreKeyPeerClaimsBindRequest(t *testing.T) {
	request := federatedContentPreKeyRequest(
		t,
		contentPreKeyClaimRequest(
			"peer-claim-plan",
			contentPreKeyEndpointTarget(),
		),
	)
	claims := &authfed.VerifiedClaims{
		Scope:    sharedfederation.KeyExchangeContentPreKeyClaimScope,
		Issuer:   "station-source",
		Audience: contentPreKeyTestStation,
		Subject:  "station-source",
		Custom: map[string]string{
			sharedfederation.ClaimFederationID: "federation-one",
			sharedfederation.ClaimAuthorityPlanID: request.
				GetRequest().
				GetPlanId(),
			sharedfederation.ClaimPlanRequestSHA256: hex.EncodeToString(
				request.GetRequest().GetPlanRequestSha256(),
			),
			sharedfederation.ClaimCanonicalRequestSHA256: hex.EncodeToString(
				request.GetCanonicalRequestSha256(),
			),
			sharedfederation.ClaimSourceStationPeerID: "station-source",
			sharedfederation.ClaimTargetStationPeerID: contentPreKeyTestStation,
		},
	}
	if err := ValidateFederatedContentPreKeyPeerClaims(
		claims,
		request,
	); err != nil {
		t.Fatal(err)
	}
	changed := *claims
	changed.Custom = make(map[string]string, len(claims.Custom))
	for key, value := range claims.Custom {
		changed.Custom[key] = value
	}
	changed.Custom[sharedfederation.ClaimAuthorityPlanID] = "other-plan"
	if err := ValidateFederatedContentPreKeyPeerClaims(
		&changed,
		request,
	); err == nil {
		t.Fatal("changed authenticated plan identity was accepted")
	}
}

func TestRemoteContentPreKeyValidationBindsExactClaimAndPreservesReplay(
	t *testing.T,
) {
	fixture := newContentPreKeyOperationalFixture(t)
	ctx := context.Background()
	fixture.publish(
		t,
		ctx,
		contentPreKeyEndpointRef(),
		contentPreKeyTestSigningKey,
		7,
		0,
		fixture.privateKey,
		contentEndpointPreKey("federated-validate-endpoint", 7),
	)
	request := contentPreKeyClaimRequest(
		"federated-validate-plan",
		contentPreKeyEndpointTarget(),
	)
	membership := &federatedContentPreKeyMembership{}
	claimed, err := claimFederatedContentPreKeys(
		ctx,
		fixture.capability.(*subServer).composition.contentPreKeyService,
		membership,
		"station-source",
		contentPreKeyTestStation,
		federatedContentPreKeyRequest(t, request),
	)
	if err != nil {
		t.Fatal(err)
	}
	validation := federatedContentPreKeyValidationRequest(
		t,
		request,
		claimed.GetResponse(),
	)
	normalized, err := normalizeFederatedContentPreKeyValidationRequest(
		"test.remote_content_prekey_validation",
		"station-source",
		contentPreKeyTestStation,
		validation,
	)
	if err != nil {
		t.Fatal(err)
	}
	claims := federatedContentPreKeyValidationClaims(normalized)
	if err := ValidateFederatedContentPreKeyValidationPeerClaims(
		claims,
		normalized,
	); err != nil {
		t.Fatal(err)
	}
	localRequest := proto.Clone(
		normalized.GetRequest(),
	).(*securecontentpb.ClaimContentPreKeysRequest)
	localRequest.PlanId = federatedContentPreKeyPlanID(
		"station-source",
		contentPreKeyTestStation,
		localRequest.GetPlanId(),
	)
	service := fixture.capability.(*subServer).composition.contentPreKeyService
	if err := service.ValidateContentPreKeyClaimsStandalone(
		ctx,
		localRequest,
		normalized.GetResponse(),
	); err != nil {
		t.Fatal(err)
	}

	updateContentPreKeyPublisher(
		t,
		fixture.db,
		map[string]any{"profile_version": int64(8)},
	)
	err = service.ValidateContentPreKeyClaimsStandalone(
		ctx,
		localRequest,
		normalized.GetResponse(),
	)
	assertContentPreKeyError(t, err, domain.ErrorCodeStaleMaterial)

	replayed, err := claimFederatedContentPreKeys(
		ctx,
		service,
		membership,
		"station-source",
		contentPreKeyTestStation,
		federatedContentPreKeyRequest(t, request),
	)
	if err != nil {
		t.Fatalf("claim replay after stale validation: %v", err)
	}
	if !replayed.GetResponse().GetExactReplay() {
		t.Fatal("stale validation changed exact claim replay")
	}
}

func TestRemoteContentPreKeyValidationRejectsResponseDigestTamper(t *testing.T) {
	_, request, response := claimedEndpointForValidation(t)
	wire := federatedContentPreKeyValidationRequest(t, request, response)
	wire.CanonicalResponseSha256[0] ^= 0xff
	if _, err := normalizeFederatedContentPreKeyValidationRequest(
		"test.remote_content_prekey_validation",
		"station-source",
		contentPreKeyTestStation,
		wire,
	); domain.CodeOf(err) != domain.ErrorCodeInvalidMaterial {
		t.Fatalf("response digest tamper error = %v", err)
	}

	validWire := federatedContentPreKeyValidationRequest(t, request, response)
	claims := federatedContentPreKeyValidationClaims(validWire)
	claims.Custom[sharedfederation.ClaimCanonicalResponseSHA256] = strings.Repeat(
		"0",
		sha256.Size*2,
	)
	if err := ValidateFederatedContentPreKeyValidationPeerClaims(
		claims,
		validWire,
	); err == nil {
		t.Fatal("changed authenticated response digest was accepted")
	}
}

func TestFederatedContentPreKeyPeerErrorPreservesTerminalConflict(t *testing.T) {
	body, err := proto.Marshal(&actormodel.ErrorResponse{
		Code: actormodel.
			ErrorCode_ERROR_CODE_CONTENT_PREKEY_REPLAY_CONFLICT,
	})
	if err != nil {
		t.Fatal(err)
	}
	peerError := federationdelivery.NewError(
		federationdelivery.FailureDomainRejected,
		"call Federation peer",
		&sharedfederation.PeerResponseError{
			StatusCode: 409,
			Body:       body,
		},
	)
	mapped := mapFederatedContentPreKeyPeerError(
		"test.federated_content_prekey",
		peerError,
	)
	if domain.CodeOf(mapped) != domain.ErrorCodeConflict {
		t.Fatalf("mapped peer error = %v", mapped)
	}
}

func TestFederatedContentPreKeyRouteErrorWritesCanonicalProtobuf(t *testing.T) {
	handler := server.NewSimpleHandler(
		"test-federated-content-prekey-error",
		"/test/federated-content-prekey-error",
		server.POST,
		func(
			ctx context.Context,
			_ server.Request,
			_ server.Response,
		) error {
			return FederatedContentPreKeyRouteError(
				ctx,
				domain.NewError(
					domain.ErrorCodeConflict,
					"test.federated_content_prekey",
					"plan_request_sha256",
					"does not match the persisted claim",
				),
			)
		},
	)

	response := executeKeyExchangeHandler(
		t,
		handler,
		keyExchangeTestRequest{
			method: server.POST,
			path:   "/test/federated-content-prekey-error",
		},
	)
	if response.status != http.StatusConflict {
		t.Fatalf("route status = %d, want %d", response.status, http.StatusConflict)
	}
	if response.headers["Content-Type"] != server.CanonicalProtobufContentType {
		t.Fatalf("route Content-Type = %q", response.headers["Content-Type"])
	}
	var body actormodel.ErrorResponse
	if err := proto.Unmarshal(response.body, &body); err != nil {
		t.Fatal(err)
	}
	if body.GetCode() != actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_REPLAY_CONFLICT {
		t.Fatalf("route error code = %s", body.GetCode())
	}
}

func TestFederatedContentPreKeyRouteErrorProjectsSimpleHandlerFailures(
	t *testing.T,
) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   actormodel.ErrorCode
	}{
		{
			name:       "invalid request",
			err:        server.BadRequest("invalid protobuf"),
			wantStatus: http.StatusBadRequest,
			wantCode: actormodel.
				ErrorCode_ERROR_CODE_CONTENT_PREKEY_INVALID_MATERIAL,
		},
		{
			name:       "forbidden",
			err:        server.Forbidden("invalid peer claims"),
			wantStatus: http.StatusForbidden,
			wantCode: actormodel.
				ErrorCode_ERROR_CODE_CONTENT_PREKEY_FORBIDDEN,
		},
		{
			name: "dependency unavailable",
			err: server.NewHandlerError(
				http.StatusServiceUnavailable,
				"provider unavailable",
			),
			wantStatus: http.StatusServiceUnavailable,
			wantCode: actormodel.
				ErrorCode_ERROR_CODE_CONTENT_PREKEY_DEPENDENCY_UNAVAILABLE,
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			handler := server.NewSimpleHandler(
				"test-federated-content-prekey-handler-error",
				"/test/federated-content-prekey-handler-error",
				server.POST,
				func(
					ctx context.Context,
					_ server.Request,
					_ server.Response,
				) error {
					return FederatedContentPreKeyRouteError(ctx, testCase.err)
				},
			)
			response := executeKeyExchangeHandler(
				t,
				handler,
				keyExchangeTestRequest{
					method: server.POST,
					path:   "/test/federated-content-prekey-handler-error",
				},
			)
			if response.status != testCase.wantStatus {
				t.Fatalf(
					"route status = %d, want %d",
					response.status,
					testCase.wantStatus,
				)
			}
			if response.headers["Content-Type"] !=
				server.CanonicalProtobufContentType {
				t.Fatalf(
					"route Content-Type = %q",
					response.headers["Content-Type"],
				)
			}
			var body actormodel.ErrorResponse
			if err := proto.Unmarshal(response.body, &body); err != nil {
				t.Fatal(err)
			}
			if body.GetCode() != testCase.wantCode {
				t.Fatalf(
					"route error code = %s, want %s",
					body.GetCode(),
					testCase.wantCode,
				)
			}
		})
	}
}

func federatedContentPreKeyRequest(
	t *testing.T,
	request *securecontentpb.ClaimContentPreKeysRequest,
) *kemodel.ClaimFederatedContentPreKeysRequest {
	t.Helper()
	return &kemodel.ClaimFederatedContentPreKeysRequest{
		FormatVersion:           federatedContentPreKeyFormatVersion,
		SourceHomeStationPeerId: "station-source",
		TargetHomeStationPeerId: contentPreKeyTestStation,
		FederationId:            "federation-one",
		Request: proto.Clone(
			request,
		).(*securecontentpb.ClaimContentPreKeysRequest),
		CanonicalRequestSha256: canonicalClaimRequestDigest(t, request),
	}
}

func canonicalClaimRequestDigest(
	t *testing.T,
	request *securecontentpb.ClaimContentPreKeysRequest,
) []byte {
	t.Helper()
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(canonical)
	return digest[:]
}

func federatedContentPreKeyValidationRequest(
	t *testing.T,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
) *kemodel.ValidateFederatedContentPreKeyClaimsRequest {
	t.Helper()
	canonicalResponse := proto.Clone(
		response,
	).(*securecontentpb.ClaimContentPreKeysResponse)
	canonicalResponse.ExactReplay = false
	responseBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		canonicalResponse,
	)
	if err != nil {
		t.Fatal(err)
	}
	responseDigest := sha256.Sum256(responseBytes)
	return &kemodel.ValidateFederatedContentPreKeyClaimsRequest{
		FormatVersion:           federatedContentPreKeyFormatVersion,
		SourceHomeStationPeerId: "station-source",
		TargetHomeStationPeerId: contentPreKeyTestStation,
		FederationId:            "federation-one",
		Request: proto.Clone(
			request,
		).(*securecontentpb.ClaimContentPreKeysRequest),
		Response:                canonicalResponse,
		CanonicalRequestSha256:  canonicalClaimRequestDigest(t, request),
		CanonicalResponseSha256: responseDigest[:],
	}
}

func federatedContentPreKeyValidationClaims(
	request *kemodel.ValidateFederatedContentPreKeyClaimsRequest,
) *authfed.VerifiedClaims {
	return &authfed.VerifiedClaims{
		Scope:    sharedfederation.KeyExchangeContentPreKeyValidateScope,
		Issuer:   request.GetSourceHomeStationPeerId(),
		Audience: request.GetTargetHomeStationPeerId(),
		Subject:  request.GetSourceHomeStationPeerId(),
		Custom: map[string]string{
			sharedfederation.ClaimFederationID: request.GetFederationId(),
			sharedfederation.ClaimAuthorityPlanID: request.
				GetRequest().
				GetPlanId(),
			sharedfederation.ClaimPlanRequestSHA256: hex.EncodeToString(
				request.GetRequest().GetPlanRequestSha256(),
			),
			sharedfederation.ClaimCanonicalRequestSHA256: hex.EncodeToString(
				request.GetCanonicalRequestSha256(),
			),
			sharedfederation.ClaimCanonicalResponseSHA256: hex.EncodeToString(
				request.GetCanonicalResponseSha256(),
			),
			sharedfederation.ClaimSourceStationPeerID: request.
				GetSourceHomeStationPeerId(),
			sharedfederation.ClaimTargetStationPeerID: request.
				GetTargetHomeStationPeerId(),
		},
	}
}
