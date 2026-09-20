package key_exchange

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	keyExchangeTestPTID     = "ptid:v1:actor:peers:p:alice:fingerprint"
	keyExchangeTestDeviceID = "alice-device"
)

type recordingCanonicalAPI struct {
	sendActorPTID string
	sendDeviceID  string
	sendRequest   *kemodel.SendDirectKeyExchangeRequest
	sendCalls     int
}

func (*recordingCanonicalAPI) UploadDirectKeyBundle(
	context.Context,
	string,
	string,
	*kemodel.UploadDirectKeyBundleRequest,
) (*kemodel.UploadDirectKeyBundleResponse, error) {
	return &kemodel.UploadDirectKeyBundleResponse{}, nil
}

func (*recordingCanonicalAPI) FetchDirectKeyBundles(
	context.Context,
	string,
	string,
	*kemodel.FetchDirectKeyBundlesRequest,
) (*kemodel.FetchDirectKeyBundlesResponse, error) {
	return &kemodel.FetchDirectKeyBundlesResponse{}, nil
}

func (*recordingCanonicalAPI) FetchDirectKeyBundlesForPeer(
	context.Context,
	*kemodel.FetchDirectKeyBundlesRequest,
) (*kemodel.FetchDirectKeyBundlesResponse, error) {
	return &kemodel.FetchDirectKeyBundlesResponse{}, nil
}

func (*recordingCanonicalAPI) ReplenishDirectOneTimePreKeys(
	context.Context,
	string,
	string,
	*kemodel.ReplenishDirectOneTimePreKeysRequest,
) (*kemodel.ReplenishDirectOneTimePreKeysResponse, error) {
	return &kemodel.ReplenishDirectOneTimePreKeysResponse{}, nil
}

func (*recordingCanonicalAPI) CountDirectOneTimePreKeys(
	context.Context,
	string,
	string,
	*kemodel.CountDirectOneTimePreKeysRequest,
) (*kemodel.CountDirectOneTimePreKeysResponse, error) {
	return &kemodel.CountDirectOneTimePreKeysResponse{}, nil
}

func (*recordingCanonicalAPI) UploadMLSKeyPackage(
	context.Context,
	string,
	string,
	*kemodel.UploadMlsKeyPackageRequest,
) (*kemodel.UploadMlsKeyPackageResponse, error) {
	return &kemodel.UploadMlsKeyPackageResponse{}, nil
}

func (*recordingCanonicalAPI) FetchMLSKeyPackage(
	context.Context,
	string,
	string,
	*kemodel.FetchMlsKeyPackageRequest,
) (*kemodel.FetchMlsKeyPackageResponse, error) {
	return &kemodel.FetchMlsKeyPackageResponse{}, nil
}

func (*recordingCanonicalAPI) FetchMLSKeyPackageForPeer(
	context.Context,
	*kemodel.FetchMlsKeyPackageRequest,
) (*kemodel.FetchMlsKeyPackageResponse, error) {
	return &kemodel.FetchMlsKeyPackageResponse{}, nil
}

func (*recordingCanonicalAPI) CountMLSKeyPackages(
	context.Context,
	string,
	string,
	*kemodel.CountMlsKeyPackagesRequest,
) (*kemodel.CountMlsKeyPackagesResponse, error) {
	return &kemodel.CountMlsKeyPackagesResponse{}, nil
}

func (*recordingCanonicalAPI) ClaimMLSKeyPackage(
	context.Context,
	string,
	*kemodel.ClaimMlsKeyPackageRequest,
) (*kemodel.ClaimMlsKeyPackageResponse, error) {
	return &kemodel.ClaimMlsKeyPackageResponse{}, nil
}

func (a *recordingCanonicalAPI) SendDirectKeyExchange(
	_ context.Context,
	actorPTID string,
	deviceID string,
	request *kemodel.SendDirectKeyExchangeRequest,
) (*kemodel.SendDirectKeyExchangeResponse, error) {
	a.sendActorPTID = actorPTID
	a.sendDeviceID = deviceID
	a.sendRequest = proto.Clone(request).(*kemodel.SendDirectKeyExchangeRequest)
	a.sendCalls++

	return &kemodel.SendDirectKeyExchangeResponse{
		EnvelopeId: "envelope-1",
	}, nil
}

type keyExchangeTestRequest struct {
	headers map[string]string
	method  server.Method
	path    string
	body    []byte
}

func (r keyExchangeTestRequest) Context() context.Context  { return context.Background() }
func (r keyExchangeTestRequest) Header() map[string]string { return r.headers }
func (r keyExchangeTestRequest) Method() server.Method     { return r.method }
func (r keyExchangeTestRequest) Path() string              { return r.path }
func (r keyExchangeTestRequest) Body() []byte              { return r.body }

type keyExchangeTestResponse struct {
	headers map[string]string
	status  int
	body    []byte
}

func (r *keyExchangeTestResponse) Header() map[string]string {
	return r.headers
}

func (r *keyExchangeTestResponse) SetHeader(key string, value string) {
	r.headers[key] = value
}

func (r *keyExchangeTestResponse) Write(body []byte) (int, error) {
	r.body = append(r.body, body...)
	return len(body), nil
}

func (*keyExchangeTestResponse) Flush() error {
	return nil
}

func (r *keyExchangeTestResponse) WriteHeader(status int) {
	r.status = status
}

func (r *keyExchangeTestResponse) Status() int {
	return r.status
}

func TestKeyExchangeHandlersRegisterOnlyCanonicalOwnerRoutes(t *testing.T) {
	jwtWrapper := keyExchangeTestJWTWrapper()
	subserver := &subServer{
		api:        &recordingCanonicalAPI{},
		jwtWrapper: jwtWrapper,
	}

	expected := []struct {
		name   string
		path   string
		method server.Method
	}{
		{"key-exchange-direct-bundle-upload", uploadDirectKeyBundlePath, server.POST},
		{"key-exchange-direct-bundle-fetch", fetchDirectKeyBundlesPath, server.POST},
		{"key-exchange-direct-prekeys-replenish", replenishDirectOneTimePreKeysPath, server.POST},
		{"key-exchange-direct-prekeys-count", countDirectOneTimePreKeysPath, server.GET},
		{"key-exchange-mls-key-package-upload", uploadMLSKeyPackagePath, server.POST},
		{"key-exchange-mls-key-package-fetch", fetchMLSKeyPackagePath, server.POST},
		{"key-exchange-mls-key-package-count", countMLSKeyPackagesPath, server.GET},
		{"key-exchange-dkx-send", sendDirectKeyExchangePath, server.POST},
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
			len(got.Wrappers()) != 3 {
			t.Fatalf(
				"handler[%d] = name:%q path:%q method:%s wrappers:%d, want %+v",
				index,
				got.Name(),
				got.Path(),
				got.Method(),
				len(got.Wrappers()),
				want,
			)
		}
	}

	forbiddenPath := "/key-exchange/keys/bundle/" + "federated-" + "fetch"
	for _, handler := range handlers {
		if handler.Path() == forbiddenPath {
			t.Fatalf("legacy federated Direct bundle route remains registered")
		}
	}
}

func TestKeyExchangeFederationRoutesAndClaimsAreOperationSpecific(t *testing.T) {
	if FederationDirectKeyBundlesFetchRoute !=
		"/federation/key-exchange/keys/bundle/fetch" ||
		FederationMLSKeyPackageFetchRoute !=
			"/federation/key-exchange/mls/key-package/fetch" ||
		FederationMLSKeyPackageClaimRoute !=
			"/federation/key-exchange/mls-key-package/claim" {
		t.Fatal("Key Exchange peer route constants do not match the ownership registry")
	}

	requester := &actormodel.ActorDeviceRef{
		Actor:    &actormodel.ActorRef{Ptid: keyExchangeTestPTID},
		DeviceId: keyExchangeTestDeviceID,
	}
	directRequest := &kemodel.FetchDirectKeyBundlesRequest{
		Actor:             &actormodel.ActorRef{Ptid: "ptid:bob"},
		TargetDeviceId:    "bob-device",
		HomeStationPeerId: "station-target",
		RequestId:         "direct-peer-request",
		Requester:         requester,
	}
	directClaims := &authfed.VerifiedClaims{
		Scope:    FederationDirectKeyBundlesFetchScope,
		Issuer:   "station-source",
		Audience: "station-target",
		Subject:  "station-source",
		Custom: map[string]string{
			keyExchangeClaimActorPTID:       "ptid:bob",
			keyExchangeClaimDeviceID:        "bob-device",
			keyExchangeClaimRequestID:       "direct-peer-request",
			keyExchangeClaimRequesterPTID:   keyExchangeTestPTID,
			keyExchangeClaimRequesterDevice: keyExchangeTestDeviceID,
			keyExchangeClaimSourceStationID: "station-source",
			keyExchangeClaimTargetStationID: "station-target",
		},
	}
	if err := ValidateDirectFetchPeerClaims(
		directClaims,
		directRequest,
	); err != nil {
		t.Fatalf("validate Direct fetch claims: %v", err)
	}
	wrongDirectScope := *directClaims
	wrongDirectScope.Scope = FederationMLSKeyPackageFetchScope
	if err := ValidateDirectFetchPeerClaims(
		&wrongDirectScope,
		directRequest,
	); err == nil {
		t.Fatal("Direct fetch accepted the MLS fetch scope")
	}

	mlsRequest := &kemodel.FetchMlsKeyPackageRequest{
		Actor:             &actormodel.ActorRef{Ptid: "ptid:bob"},
		HomeStationPeerId: "station-target",
		RequestId:         "mls-peer-request",
		Requester:         requester,
	}
	mlsClaims := &authfed.VerifiedClaims{
		Scope:    FederationMLSKeyPackageFetchScope,
		Issuer:   "station-source",
		Audience: "station-target",
		Subject:  "station-source",
		Custom: map[string]string{
			keyExchangeClaimActorPTID:       "ptid:bob",
			keyExchangeClaimRequestID:       "mls-peer-request",
			keyExchangeClaimRequesterPTID:   keyExchangeTestPTID,
			keyExchangeClaimRequesterDevice: keyExchangeTestDeviceID,
			keyExchangeClaimSourceStationID: "station-source",
			keyExchangeClaimTargetStationID: "station-target",
		},
	}
	if err := ValidateMLSFetchPeerClaims(mlsClaims, mlsRequest); err != nil {
		t.Fatalf("validate MLS fetch claims: %v", err)
	}
	wrongRequester := *mlsClaims
	wrongRequester.Custom = make(map[string]string, len(mlsClaims.Custom))
	for key, value := range mlsClaims.Custom {
		wrongRequester.Custom[key] = value
	}
	wrongRequester.Custom[keyExchangeClaimRequesterDevice] = "other-device"
	if err := ValidateMLSFetchPeerClaims(
		&wrongRequester,
		mlsRequest,
	); err == nil {
		t.Fatal("MLS fetch accepted claims for a different requester")
	}

	expiresAt := time.Unix(1_800_000_000, 0).UTC()
	claimRequest := &kemodel.ClaimMlsKeyPackageRequest{
		AuthorityPlanId:        "authority-plan",
		AuthorityStationPeerId: "station-source",
		Target: &actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: "ptid:bob"},
			DeviceId: "bob-device",
		},
		PlanExpiresAt: timestamppb.New(expiresAt),
		RequestId:     "claim-peer-request",
	}
	claimClaims := &authfed.VerifiedClaims{
		Scope:    FederationMLSKeyPackageClaimScope,
		Issuer:   "station-source",
		Audience: "station-target",
		Subject:  "station-source",
		Custom: map[string]string{
			keyExchangeClaimAuthorityPlan:   "authority-plan",
			keyExchangeClaimActorPTID:       "ptid:bob",
			keyExchangeClaimDeviceID:        "bob-device",
			keyExchangeClaimRequestID:       "claim-peer-request",
			keyExchangeClaimPlanExpiresAt:   expiresAt.Format(time.RFC3339Nano),
			keyExchangeClaimSourceStationID: "station-source",
			keyExchangeClaimTargetStationID: "station-target",
		},
	}
	if err := ValidateMLSClaimPeerClaims(claimClaims, claimRequest); err != nil {
		t.Fatalf("validate MLS claim claims: %v", err)
	}
	wrongClaimScope := *claimClaims
	wrongClaimScope.Scope = FederationMLSKeyPackageFetchScope
	if err := ValidateMLSClaimPeerClaims(
		&wrongClaimScope,
		claimRequest,
	); err == nil {
		t.Fatal("MLS claim accepted the MLS fetch scope")
	}
}

func TestKeyExchangeHandlerBindsCanonicalActorAndDevice(t *testing.T) {
	api := &recordingCanonicalAPI{}
	jwtWrapper := keyExchangeTestJWTWrapper()
	subserver := &subServer{
		api:        api,
		jwtWrapper: jwtWrapper,
	}
	request := &kemodel.SendDirectKeyExchangeRequest{
		SessionId: "session-1",
	}
	body, err := proto.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}

	response := executeKeyExchangeHandler(
		t,
		findKeyExchangeHandler(t, subserver.Handlers(), sendDirectKeyExchangePath),
		keyExchangeTestRequest{
			headers: map[string]string{
				"Authorization": "Bearer test",
				"Content-Type":  "application/protobuf",
				"X-Device-ID":   keyExchangeTestDeviceID,
			},
			method: server.POST,
			path:   sendDirectKeyExchangePath,
			body:   body,
		},
	)
	if response.status != http.StatusOK {
		t.Fatalf("send status = %d, body=%x", response.status, response.body)
	}
	if api.sendCalls != 1 ||
		api.sendActorPTID != keyExchangeTestPTID ||
		api.sendDeviceID != keyExchangeTestDeviceID ||
		api.sendRequest.GetSessionId() != request.GetSessionId() {
		t.Fatalf(
			"canonical API call = actor:%q device:%q request:%+v calls:%d",
			api.sendActorPTID,
			api.sendDeviceID,
			api.sendRequest,
			api.sendCalls,
		)
	}
}

func TestKeyExchangeHandlerRejectsMissingAuthenticatedDevice(t *testing.T) {
	api := &recordingCanonicalAPI{}
	jwtWrapper := keyExchangeTestJWTWrapper()
	subserver := &subServer{
		api:        api,
		jwtWrapper: jwtWrapper,
	}
	body, err := proto.Marshal(&kemodel.SendDirectKeyExchangeRequest{})
	if err != nil {
		t.Fatal(err)
	}

	response := executeKeyExchangeHandler(
		t,
		findKeyExchangeHandler(t, subserver.Handlers(), sendDirectKeyExchangePath),
		keyExchangeTestRequest{
			headers: map[string]string{
				"Authorization": "Bearer test",
				"Content-Type":  "application/protobuf",
			},
			method: server.POST,
			path:   sendDirectKeyExchangePath,
			body:   body,
		},
	)
	if response.status != http.StatusUnauthorized {
		t.Fatalf(
			"missing-device status = %d, want %d",
			response.status,
			http.StatusUnauthorized,
		)
	}
	if api.sendCalls != 0 {
		t.Fatalf("missing-device request reached canonical API %d times", api.sendCalls)
	}
}

func TestMapCanonicalErrorPreservesFailureClass(t *testing.T) {
	tests := []struct {
		code   domain.ErrorCode
		status int
	}{
		{domain.ErrorCodeInvalidArgument, http.StatusBadRequest},
		{domain.ErrorCodeUnauthorized, http.StatusForbidden},
		{domain.ErrorCodeNotFound, http.StatusNotFound},
		{domain.ErrorCodeConflict, http.StatusConflict},
		{domain.ErrorCodeStaleMaterial, http.StatusConflict},
		{domain.ErrorCodePlanExpired, http.StatusConflict},
		{domain.ErrorCodePoolDepleted, http.StatusConflict},
		{domain.ErrorCodeQuotaExceeded, http.StatusTooManyRequests},
		{domain.ErrorCodePayloadTooLarge, http.StatusRequestEntityTooLarge},
		{domain.ErrorCodeDependency, http.StatusServiceUnavailable},
		{domain.ErrorCodeInternal, http.StatusInternalServerError},
	}
	for _, test := range tests {
		t.Run(string(test.code), func(t *testing.T) {
			mapped := mapCanonicalError(
				context.Background(),
				"test Key Exchange operation",
				domain.NewError(test.code, "test", "field", "failed"),
			)
			var handlerError *server.HandlerError
			if !errors.As(mapped, &handlerError) {
				t.Fatalf("mapped error = %T, want *server.HandlerError", mapped)
			}
			if handlerError.Code != test.status {
				t.Fatalf(
					"mapped status = %d, want %d",
					handlerError.Code,
					test.status,
				)
			}
		})
	}
}

func TestMapContentPreKeyRouteErrorUsesStableTypedCodes(t *testing.T) {
	tests := []struct {
		domainCode domain.ErrorCode
		status     int
		wireCode   actormodel.ErrorCode
	}{
		{domain.ErrorCodeInvalidArgument, http.StatusBadRequest, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_INVALID_MATERIAL},
		{domain.ErrorCodeUnauthorized, http.StatusForbidden, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_FORBIDDEN},
		{domain.ErrorCodeNotFound, http.StatusNotFound, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_POOL_NOT_FOUND},
		{domain.ErrorCodeStaleMaterial, http.StatusConflict, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_STALE_EPOCH},
		{domain.ErrorCodeConflict, http.StatusConflict, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_REPLAY_CONFLICT},
		{domain.ErrorCodePoolDepleted, http.StatusConflict, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_POOL_DEPLETED},
		{domain.ErrorCodePayloadTooLarge, http.StatusRequestEntityTooLarge, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_PAYLOAD_TOO_LARGE},
		{domain.ErrorCodeQuotaExceeded, http.StatusTooManyRequests, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_QUOTA_EXCEEDED},
		{domain.ErrorCodeDependency, http.StatusServiceUnavailable, actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_DEPENDENCY_UNAVAILABLE},
		{domain.ErrorCodeInternal, http.StatusInternalServerError, actormodel.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR},
	}
	for _, testCase := range tests {
		t.Run(string(testCase.domainCode), func(t *testing.T) {
			mapped := mapContentPreKeyRouteError(
				context.Background(),
				"test Content PreKey operation",
				domain.NewError(testCase.domainCode, "test", "field", "cause"),
			)
			var routeError *server.RouteError
			if !errors.As(mapped, &routeError) {
				t.Fatalf("mapped error = %T, want *server.RouteError", mapped)
			}
			if routeError.Status != testCase.status ||
				routeError.StableCode != int32(testCase.wireCode) {
				t.Fatalf(
					"mapped status/code = %d/%d, want %d/%d",
					routeError.Status,
					routeError.StableCode,
					testCase.status,
					testCase.wireCode,
				)
			}
			body, err := projectContentPreKeyRouteError(*routeError)
			if err != nil {
				t.Fatalf("project error: %v", err)
			}
			var projected actormodel.ErrorResponse
			if err := proto.Unmarshal(body, &projected); err != nil {
				t.Fatalf("decode projected error: %v", err)
			}
			if projected.GetCode() != testCase.wireCode {
				t.Fatalf(
					"projected code = %s, want %s",
					projected.GetCode(),
					testCase.wireCode,
				)
			}
		})
	}
}

func keyExchangeTestJWTWrapper() server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(
			ctx context.Context,
			request server.Request,
			response server.Response,
		) error {
			return next(
				coreauth.WithSubject(ctx, &coreauth.Subject{
					ID: keyExchangeTestPTID,
				}),
				request,
				response,
			)
		}
	}
}

func findKeyExchangeHandler(
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
	t.Fatalf("Key Exchange handler %q was not registered", path)

	return nil
}

func executeKeyExchangeHandler(
	t *testing.T,
	handler server.Handler,
	request keyExchangeTestRequest,
) *keyExchangeTestResponse {
	t.Helper()
	endpoint := handler.Handler()
	for _, wrapper := range handler.Wrappers() {
		endpoint = wrapper(endpoint)
	}
	response := &keyExchangeTestResponse{headers: map[string]string{}}
	if err := endpoint(context.Background(), request, response); err != nil {
		t.Fatalf("execute %s %s: %v", handler.Method(), handler.Path(), err)
	}

	return response
}

var _ canonicalAPI = (*recordingCanonicalAPI)(nil)
var _ server.Request = keyExchangeTestRequest{}
var _ server.Response = (*keyExchangeTestResponse)(nil)
