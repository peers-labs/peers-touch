package key_exchange

import (
	"context"
	"errors"
	nethttp "net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/interface/http"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

const (
	uploadDirectKeyBundlePath         = "/key-exchange/keys/bundle"
	fetchDirectKeyBundlesPath         = "/key-exchange/keys/bundle/fetch"
	replenishDirectOneTimePreKeysPath = "/key-exchange/keys/replenish"
	countDirectOneTimePreKeysPath     = "/key-exchange/keys/count"
	uploadMLSKeyPackagePath           = "/key-exchange/mls/key-package/upload"
	fetchMLSKeyPackagePath            = "/key-exchange/mls/key-package/fetch"
	countMLSKeyPackagesPath           = "/key-exchange/mls/key-package/count"
	sendDirectKeyExchangePath         = "/key-exchange/dkx/send"
	publishContentPreKeysPath         = "/key-exchange/content-prekeys/publish"
	inventoryContentPreKeysPath       = "/key-exchange/content-prekeys/inventory"
	publishContentPreKeysBodyLimit    = int64(128 << 10)
	inventoryContentPreKeysBodyLimit  = int64(4 << 10)
)

type canonicalAPI interface {
	UploadDirectKeyBundle(
		context.Context,
		string,
		string,
		*kemodel.UploadDirectKeyBundleRequest,
	) (*kemodel.UploadDirectKeyBundleResponse, error)
	FetchDirectKeyBundles(
		context.Context,
		string,
		string,
		*kemodel.FetchDirectKeyBundlesRequest,
	) (*kemodel.FetchDirectKeyBundlesResponse, error)
	FetchDirectKeyBundlesForPeer(
		context.Context,
		*kemodel.FetchDirectKeyBundlesRequest,
	) (*kemodel.FetchDirectKeyBundlesResponse, error)
	ReplenishDirectOneTimePreKeys(
		context.Context,
		string,
		string,
		*kemodel.ReplenishDirectOneTimePreKeysRequest,
	) (*kemodel.ReplenishDirectOneTimePreKeysResponse, error)
	CountDirectOneTimePreKeys(
		context.Context,
		string,
		string,
		*kemodel.CountDirectOneTimePreKeysRequest,
	) (*kemodel.CountDirectOneTimePreKeysResponse, error)
	UploadMLSKeyPackage(
		context.Context,
		string,
		string,
		*kemodel.UploadMlsKeyPackageRequest,
	) (*kemodel.UploadMlsKeyPackageResponse, error)
	FetchMLSKeyPackage(
		context.Context,
		string,
		string,
		*kemodel.FetchMlsKeyPackageRequest,
	) (*kemodel.FetchMlsKeyPackageResponse, error)
	FetchMLSKeyPackageForPeer(
		context.Context,
		*kemodel.FetchMlsKeyPackageRequest,
	) (*kemodel.FetchMlsKeyPackageResponse, error)
	CountMLSKeyPackages(
		context.Context,
		string,
		string,
		*kemodel.CountMlsKeyPackagesRequest,
	) (*kemodel.CountMlsKeyPackagesResponse, error)
	ClaimMLSKeyPackage(
		context.Context,
		string,
		*kemodel.ClaimMlsKeyPackageRequest,
	) (*kemodel.ClaimMlsKeyPackageResponse, error)
	SendDirectKeyExchange(
		context.Context,
		string,
		string,
		*kemodel.SendDirectKeyExchangeRequest,
	) (*kemodel.SendDirectKeyExchangeResponse, error)
}

// PeerCapabilities are the Key Exchange operations delegated by
// Federation-owned peer routes after route-specific claim validation.
type PeerCapabilities interface {
	FetchDirectKeyBundlesForPeer(
		context.Context,
		*kemodel.FetchDirectKeyBundlesRequest,
	) (*kemodel.FetchDirectKeyBundlesResponse, error)
	FetchMLSKeyPackageForPeer(
		context.Context,
		*kemodel.FetchMlsKeyPackageRequest,
	) (*kemodel.FetchMlsKeyPackageResponse, error)
	ClaimMLSKeyPackage(
		context.Context,
		string,
		*kemodel.ClaimMlsKeyPackageRequest,
	) (*kemodel.ClaimMlsKeyPackageResponse, error)
}

// Handlers registers only Key Exchange-owned client routes. Federation-owned
// peer routes are registered by the Federation subserver.
func (s *subServer) Handlers() []server.Handler {
	if s.api == nil || s.jwtWrapper == nil {
		return nil
	}

	logIDWrapper := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()

	handlers := []server.Handler{
		server.NewTypedHandler(
			"key-exchange-direct-bundle-upload",
			uploadDirectKeyBundlePath,
			server.POST,
			s.handleUploadDirectKeyBundle,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-direct-bundle-fetch",
			fetchDirectKeyBundlesPath,
			server.POST,
			s.handleFetchDirectKeyBundles,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-direct-prekeys-replenish",
			replenishDirectOneTimePreKeysPath,
			server.POST,
			s.handleReplenishDirectOneTimePreKeys,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-direct-prekeys-count",
			countDirectOneTimePreKeysPath,
			server.GET,
			s.handleCountDirectOneTimePreKeys,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-mls-key-package-upload",
			uploadMLSKeyPackagePath,
			server.POST,
			s.handleUploadMLSKeyPackage,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-mls-key-package-fetch",
			fetchMLSKeyPackagePath,
			server.POST,
			s.handleFetchMLSKeyPackage,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-mls-key-package-count",
			countMLSKeyPackagesPath,
			server.GET,
			s.handleCountMLSKeyPackages,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-dkx-send",
			sendDirectKeyExchangePath,
			server.POST,
			s.handleSendDirectKeyExchange,
			logIDWrapper,
			deviceIDWrapper,
			s.jwtWrapper,
		),
	}
	if s.composition == nil ||
		s.composition.contentPreKeyService == nil ||
		s.contentPreKeyJWTWrapper == nil {
		return handlers
	}
	contentPreKeyErrorOptions := server.CanonicalProtobufHandlerOptions{
		ErrorCodes: server.CanonicalProtobufErrorCodes{
			Unauthorized: int32(
				actormodel.ErrorCode_ERROR_CODE_UNAUTHORIZED,
			),
			InvalidQueryParameters: int32(
				actormodel.ErrorCode_ERROR_CODE_INVALID_QUERY_PARAMETERS,
			),
			InvalidRequestBody: int32(
				actormodel.ErrorCode_ERROR_CODE_INVALID_REQUEST_BODY,
			),
			InvalidProtobuf: int32(
				actormodel.ErrorCode_ERROR_CODE_INVALID_PROTOBUF,
			),
			FailedToReadBody: int32(
				actormodel.ErrorCode_ERROR_CODE_FAILED_TO_READ_BODY,
			),
			PayloadTooLarge: int32(
				actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_PAYLOAD_TOO_LARGE,
			),
			InternalServer: int32(
				actormodel.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR,
			),
		},
		ProjectError: projectContentPreKeyRouteError,
	}
	contentDeviceWrapper := serverwrapper.RequireStructuredDeviceID(
		int32(actormodel.ErrorCode_ERROR_CODE_UNAUTHORIZED),
	)
	publishOptions := contentPreKeyErrorOptions
	publishOptions.MaxBodyBytes = publishContentPreKeysBodyLimit
	inventoryOptions := contentPreKeyErrorOptions
	inventoryOptions.MaxBodyBytes = inventoryContentPreKeysBodyLimit
	handlers = append(
		handlers,
		server.NewCanonicalProtobufHandler(
			"key-exchange-content-prekey-publish",
			publishContentPreKeysPath,
			server.POST,
			func() *securecontentpb.PublishContentPreKeysRequest {
				return &securecontentpb.PublishContentPreKeysRequest{}
			},
			s.handlePublishContentPreKeysClient,
			publishOptions,
			logIDWrapper,
			contentDeviceWrapper,
			s.contentPreKeyJWTWrapper,
		),
		server.NewCanonicalProtobufHandler(
			"key-exchange-content-prekey-inventory",
			inventoryContentPreKeysPath,
			server.POST,
			func() *securecontentpb.GetContentPreKeyInventoryRequest {
				return &securecontentpb.GetContentPreKeyInventoryRequest{}
			},
			s.handleGetContentPreKeyInventoryClient,
			inventoryOptions,
			logIDWrapper,
			contentDeviceWrapper,
			s.contentPreKeyJWTWrapper,
		),
	)
	return handlers
}

func (s *subServer) handlePublishContentPreKeysClient(
	ctx context.Context,
	request *securecontentpb.PublishContentPreKeysRequest,
) (*securecontentpb.PublishContentPreKeysResponse, error) {
	publisher, sessionID, service, err := s.authenticatedContentPreKeyClient(ctx)
	if err != nil {
		return nil, err
	}
	response, err := service.PublishContentPreKeysClient(
		ctx,
		publisher,
		s.localStationID,
		sessionID,
		request,
	)
	return response, mapContentPreKeyRouteError(
		ctx,
		"publish Content PreKeys",
		err,
	)
}

func (s *subServer) handleGetContentPreKeyInventoryClient(
	ctx context.Context,
	request *securecontentpb.GetContentPreKeyInventoryRequest,
) (*securecontentpb.GetContentPreKeyInventoryResponse, error) {
	publisher, sessionID, service, err := s.authenticatedContentPreKeyClient(ctx)
	if err != nil {
		return nil, err
	}
	response, err := service.ContentPreKeyInventoryClient(
		ctx,
		publisher,
		s.localStationID,
		sessionID,
		request,
	)
	return response, mapContentPreKeyRouteError(
		ctx,
		"get Content PreKey inventory",
		err,
	)
}

func (s *subServer) authenticatedContentPreKeyClient(
	ctx context.Context,
) (
	domain.Endpoint,
	string,
	*application.ContentPreKeyService,
	error,
) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil ||
		strings.TrimSpace(subject.ID) == "" ||
		strings.TrimSpace(subject.SessionID) == "" {
		return domain.Endpoint{}, "", nil, server.NewRouteError(
			nethttp.StatusUnauthorized,
			int32(actormodel.ErrorCode_ERROR_CODE_UNAUTHORIZED),
			"unauthorized",
			nil,
		)
	}
	actorPTID, err := resolveKeyExchangeSubjectPTID(ctx, subject.ID)
	if err != nil {
		return domain.Endpoint{}, "", nil, server.NewRouteError(
			nethttp.StatusInternalServerError,
			int32(actormodel.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR),
			"internal server error",
			err,
		)
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return domain.Endpoint{}, "", nil, server.NewRouteError(
			nethttp.StatusUnauthorized,
			int32(actormodel.ErrorCode_ERROR_CODE_UNAUTHORIZED),
			"unauthorized",
			nil,
		)
	}
	service, err := s.requireContentPreKeyService()
	if err != nil {
		return domain.Endpoint{}, "", nil, mapContentPreKeyRouteError(
			ctx,
			"resolve Content PreKey service",
			err,
		)
	}
	return domain.Endpoint{
		ActorPTID: strings.TrimSpace(actorPTID),
		DeviceID:  deviceID,
	}, strings.TrimSpace(subject.SessionID), service, nil
}

func projectContentPreKeyRouteError(
	failure server.RouteError,
) ([]byte, error) {
	return proto.MarshalOptions{Deterministic: true}.Marshal(
		&actormodel.ErrorResponse{
			Code:    actormodel.ErrorCode(failure.StableCode),
			Message: failure.Message,
		},
	)
}

func mapContentPreKeyRouteError(
	ctx context.Context,
	operation string,
	err error,
) error {
	if err == nil {
		return nil
	}
	logger.Warnf(ctx, "%s failed: %v", operation, err)
	status := nethttp.StatusInternalServerError
	code := actormodel.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR
	message := "internal server error"
	retryAfter := time.Duration(0)
	switch domain.CodeOf(err) {
	case domain.ErrorCodeInvalidArgument, domain.ErrorCodeInvalidMaterial:
		status = nethttp.StatusBadRequest
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_INVALID_MATERIAL
		message = "invalid Content PreKey material"
	case domain.ErrorCodeUnauthorized:
		status = nethttp.StatusForbidden
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_FORBIDDEN
		message = "Content PreKey endpoint is forbidden"
	case domain.ErrorCodeNotFound:
		status = nethttp.StatusNotFound
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_POOL_NOT_FOUND
		message = "Content PreKey pool not found"
	case domain.ErrorCodeStaleMaterial:
		status = nethttp.StatusConflict
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_STALE_EPOCH
		message = "Content PreKey epoch is stale"
	case domain.ErrorCodeConflict:
		status = nethttp.StatusConflict
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_REPLAY_CONFLICT
		message = "Content PreKey command conflicts with persisted state"
	case domain.ErrorCodePoolDepleted:
		status = nethttp.StatusConflict
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_POOL_DEPLETED
		message = "Content PreKey pool is depleted"
	case domain.ErrorCodePayloadTooLarge:
		status = nethttp.StatusRequestEntityTooLarge
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_PAYLOAD_TOO_LARGE
		message = "Content PreKey payload is too large"
	case domain.ErrorCodeQuotaExceeded:
		status = nethttp.StatusTooManyRequests
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_QUOTA_EXCEEDED
		message = "Content PreKey quota exceeded"
		retryAfter = time.Second
	case domain.ErrorCodeDependency:
		status = nethttp.StatusServiceUnavailable
		code = actormodel.ErrorCode_ERROR_CODE_CONTENT_PREKEY_DEPENDENCY_UNAVAILABLE
		message = "Content PreKey dependency unavailable"
		retryAfter = time.Second
	}
	return &server.RouteError{
		Status:     status,
		StableCode: int32(code),
		Message:    message,
		RetryAfter: retryAfter,
		Cause:      err,
	}
}

func (s *subServer) handleUploadDirectKeyBundle(
	ctx context.Context,
	request *kemodel.UploadDirectKeyBundleRequest,
) (*kemodel.UploadDirectKeyBundleResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.UploadDirectKeyBundle(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(ctx, "upload Direct key bundle", err)
}

func (s *subServer) handleFetchDirectKeyBundles(
	ctx context.Context,
	request *kemodel.FetchDirectKeyBundlesRequest,
) (*kemodel.FetchDirectKeyBundlesResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.FetchDirectKeyBundles(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(ctx, "fetch Direct key bundles", err)
}

func (s *subServer) handleReplenishDirectOneTimePreKeys(
	ctx context.Context,
	request *kemodel.ReplenishDirectOneTimePreKeysRequest,
) (*kemodel.ReplenishDirectOneTimePreKeysResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.ReplenishDirectOneTimePreKeys(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(
		ctx,
		"replenish Direct one-time pre-keys",
		err,
	)
}

func (s *subServer) handleCountDirectOneTimePreKeys(
	ctx context.Context,
	request *kemodel.CountDirectOneTimePreKeysRequest,
) (*kemodel.CountDirectOneTimePreKeysResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.CountDirectOneTimePreKeys(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(
		ctx,
		"count Direct one-time pre-keys",
		err,
	)
}

func (s *subServer) handleUploadMLSKeyPackage(
	ctx context.Context,
	request *kemodel.UploadMlsKeyPackageRequest,
) (*kemodel.UploadMlsKeyPackageResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.UploadMLSKeyPackage(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(ctx, "upload MLS KeyPackage", err)
}

func (s *subServer) handleFetchMLSKeyPackage(
	ctx context.Context,
	request *kemodel.FetchMlsKeyPackageRequest,
) (*kemodel.FetchMlsKeyPackageResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.FetchMLSKeyPackage(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(ctx, "fetch MLS KeyPackage", err)
}

func (s *subServer) handleCountMLSKeyPackages(
	ctx context.Context,
	request *kemodel.CountMlsKeyPackagesRequest,
) (*kemodel.CountMlsKeyPackagesResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.CountMLSKeyPackages(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(ctx, "count MLS KeyPackages", err)
}

func (s *subServer) handleSendDirectKeyExchange(
	ctx context.Context,
	request *kemodel.SendDirectKeyExchangeRequest,
) (*kemodel.SendDirectKeyExchangeResponse, error) {
	actorPTID, deviceID, api, err := s.authenticatedCanonicalAPI(ctx)
	if err != nil {
		return nil, err
	}
	response, err := api.SendDirectKeyExchange(
		ctx,
		actorPTID,
		deviceID,
		request,
	)

	return response, mapCanonicalError(ctx, "send Direct key exchange", err)
}

// ReserveMLSKeyPackage exposes the Key Exchange-owned local-or-remote
// reservation workflow to Conversation without transferring resource ownership.
func (s *subServer) ReserveMLSKeyPackage(
	ctx context.Context,
	requestID string,
	authorityPlanID string,
	target domain.Endpoint,
	expiresAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	if s.composition == nil || s.composition.service == nil {
		return domain.MLSKeyPackageReservation{}, server.InternalError(
			"Key Exchange subserver is not initialized",
		)
	}

	return s.composition.service.ReserveMLSKeyPackage(
		ctx,
		requestID,
		authorityPlanID,
		target,
		expiresAt,
	)
}

// ReserveMLSKeyPackageForVerifiedRoute consumes a route already verified from
// Actor Identity's signed endpoint manifest by an internal Station caller.
func (s *subServer) ReserveMLSKeyPackageForVerifiedRoute(
	ctx context.Context,
	requestID string,
	authorityPlanID string,
	target domain.Endpoint,
	homeStationID string,
	expiresAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	if s.composition == nil || s.composition.service == nil {
		return domain.MLSKeyPackageReservation{}, server.InternalError(
			"Key Exchange subserver is not initialized",
		)
	}

	return s.composition.service.ReserveMLSKeyPackageForVerifiedRoute(
		ctx,
		requestID,
		authorityPlanID,
		target,
		homeStationID,
		expiresAt,
	)
}

// ClaimMLSKeyPackage exposes the Key Exchange-owned peer capability without
// registering the Federation-owned route.
func (s *subServer) ClaimMLSKeyPackage(
	ctx context.Context,
	sourceAuthorityStationID string,
	request *kemodel.ClaimMlsKeyPackageRequest,
) (*kemodel.ClaimMlsKeyPackageResponse, error) {
	api, err := s.canonicalAPI()
	if err != nil {
		return nil, err
	}
	return api.ClaimMLSKeyPackage(
		ctx,
		sourceAuthorityStationID,
		request,
	)
}

// FetchDirectKeyBundlesForPeer exposes the Key Exchange-owned Direct fetch
// capability without registering the Federation-owned route.
func (s *subServer) FetchDirectKeyBundlesForPeer(
	ctx context.Context,
	request *kemodel.FetchDirectKeyBundlesRequest,
) (*kemodel.FetchDirectKeyBundlesResponse, error) {
	api, err := s.canonicalAPI()
	if err != nil {
		return nil, err
	}
	return api.FetchDirectKeyBundlesForPeer(ctx, request)
}

// FetchMLSKeyPackageForPeer exposes the Key Exchange-owned MLS fetch
// capability without registering the Federation-owned route.
func (s *subServer) FetchMLSKeyPackageForPeer(
	ctx context.Context,
	request *kemodel.FetchMlsKeyPackageRequest,
) (*kemodel.FetchMlsKeyPackageResponse, error) {
	api, err := s.canonicalAPI()
	if err != nil {
		return nil, err
	}
	return api.FetchMLSKeyPackageForPeer(ctx, request)
}

func (s *subServer) authenticatedCanonicalAPI(
	ctx context.Context,
) (string, string, canonicalAPI, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return "", "", nil, server.Unauthorized(
			"authenticated Key Exchange actor required",
		)
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return "", "", nil, server.Unauthorized(
			"authenticated Key Exchange device required",
		)
	}
	api, err := s.canonicalAPI()
	if err != nil {
		return "", "", nil, err
	}

	return strings.TrimSpace(subject.ID), deviceID, api, nil
}

func (s *subServer) canonicalAPI() (canonicalAPI, error) {
	if s.api == nil {
		return nil, server.InternalError(
			"Key Exchange subserver is not initialized",
		)
	}

	return s.api, nil
}

// ValidateDirectFetchPeerClaims binds the Direct fetch payload to its
// route-specific authenticated Station claims.
func ValidateDirectFetchPeerClaims(
	claims *authfed.VerifiedClaims,
	request *kemodel.FetchDirectKeyBundlesRequest,
) error {
	if claims == nil ||
		request == nil ||
		request.GetActor() == nil ||
		request.GetRequester() == nil ||
		request.GetRequester().GetActor() == nil ||
		strings.TrimSpace(request.GetActor().GetPtid()) == "" ||
		strings.TrimSpace(request.GetRequester().GetActor().GetPtid()) == "" ||
		strings.TrimSpace(request.GetRequester().GetDeviceId()) == "" ||
		strings.TrimSpace(request.GetRequestId()) == "" ||
		strings.TrimSpace(request.GetHomeStationPeerId()) == "" ||
		claims.Scope != FederationDirectKeyBundlesFetchScope ||
		claims.Issuer == "" ||
		claims.Subject != claims.Issuer ||
		claims.Audience != request.GetHomeStationPeerId() ||
		claims.Custom[keyExchangeClaimActorPTID] != request.GetActor().GetPtid() ||
		claims.Custom[keyExchangeClaimDeviceID] != request.GetTargetDeviceId() ||
		claims.Custom[keyExchangeClaimRequestID] != request.GetRequestId() ||
		claims.Custom[keyExchangeClaimRequesterPTID] !=
			request.GetRequester().GetActor().GetPtid() ||
		claims.Custom[keyExchangeClaimRequesterDevice] !=
			request.GetRequester().GetDeviceId() ||
		claims.Custom[keyExchangeClaimSourceStationID] != claims.Issuer ||
		claims.Custom[keyExchangeClaimTargetStationID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the Direct key bundle request",
		)
	}

	return nil
}

// ValidateMLSFetchPeerClaims binds the MLS fetch payload to its route-specific
// authenticated Station claims.
func ValidateMLSFetchPeerClaims(
	claims *authfed.VerifiedClaims,
	request *kemodel.FetchMlsKeyPackageRequest,
) error {
	if claims == nil ||
		request == nil ||
		request.GetActor() == nil ||
		request.GetRequester() == nil ||
		request.GetRequester().GetActor() == nil ||
		strings.TrimSpace(request.GetActor().GetPtid()) == "" ||
		strings.TrimSpace(request.GetRequester().GetActor().GetPtid()) == "" ||
		strings.TrimSpace(request.GetRequester().GetDeviceId()) == "" ||
		strings.TrimSpace(request.GetRequestId()) == "" ||
		strings.TrimSpace(request.GetHomeStationPeerId()) == "" ||
		claims.Scope != FederationMLSKeyPackageFetchScope ||
		claims.Issuer == "" ||
		claims.Subject != claims.Issuer ||
		claims.Audience != request.GetHomeStationPeerId() ||
		claims.Custom[keyExchangeClaimActorPTID] != request.GetActor().GetPtid() ||
		claims.Custom[keyExchangeClaimRequestID] != request.GetRequestId() ||
		claims.Custom[keyExchangeClaimRequesterPTID] !=
			request.GetRequester().GetActor().GetPtid() ||
		claims.Custom[keyExchangeClaimRequesterDevice] !=
			request.GetRequester().GetDeviceId() ||
		claims.Custom[keyExchangeClaimSourceStationID] != claims.Issuer ||
		claims.Custom[keyExchangeClaimTargetStationID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the MLS KeyPackage request",
		)
	}

	return nil
}

// ValidateMLSClaimPeerClaims binds an irreversible MLS claim to the
// authenticated authority Station and the exact route-specific claims.
func ValidateMLSClaimPeerClaims(
	claims *authfed.VerifiedClaims,
	request *kemodel.ClaimMlsKeyPackageRequest,
) error {
	if claims == nil ||
		request == nil ||
		request.GetTarget() == nil ||
		request.GetTarget().GetActor() == nil ||
		strings.TrimSpace(request.GetAuthorityPlanId()) == "" ||
		strings.TrimSpace(request.GetAuthorityStationPeerId()) == "" ||
		strings.TrimSpace(request.GetTarget().GetActor().GetPtid()) == "" ||
		strings.TrimSpace(request.GetTarget().GetDeviceId()) == "" ||
		strings.TrimSpace(request.GetRequestId()) == "" ||
		request.GetPlanExpiresAt() == nil ||
		!request.GetPlanExpiresAt().IsValid() ||
		claims.Scope != FederationMLSKeyPackageClaimScope ||
		claims.Issuer == "" ||
		claims.Subject != claims.Issuer ||
		request.GetAuthorityStationPeerId() != claims.Issuer ||
		claims.Custom[keyExchangeClaimAuthorityPlan] !=
			request.GetAuthorityPlanId() ||
		claims.Custom[keyExchangeClaimActorPTID] !=
			request.GetTarget().GetActor().GetPtid() ||
		claims.Custom[keyExchangeClaimDeviceID] !=
			request.GetTarget().GetDeviceId() ||
		claims.Custom[keyExchangeClaimRequestID] != request.GetRequestId() ||
		claims.Custom[keyExchangeClaimPlanExpiresAt] !=
			request.GetPlanExpiresAt().AsTime().UTC().Format(time.RFC3339Nano) ||
		claims.Custom[keyExchangeClaimSourceStationID] != claims.Issuer ||
		claims.Custom[keyExchangeClaimTargetStationID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the MLS KeyPackage claim",
		)
	}

	return nil
}

func mapCanonicalError(
	ctx context.Context,
	operation string,
	err error,
) error {
	if err == nil {
		return nil
	}

	logger.Warnf(ctx, "%s failed: %v", operation, err)

	var typed *domain.Error
	if !errors.As(err, &typed) {
		return server.InternalErrorWithCause(
			"Key Exchange operation failed",
			err,
		)
	}

	switch typed.Code {
	case domain.ErrorCodeInvalidArgument:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusBadRequest,
			"invalid Key Exchange request",
			err,
		)
	case domain.ErrorCodeUnauthorized:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusForbidden,
			"Key Exchange operation is not authorized",
			err,
		)
	case domain.ErrorCodeNotFound:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusNotFound,
			"Key Exchange material was not found",
			err,
		)
	case domain.ErrorCodeConflict,
		domain.ErrorCodeStaleMaterial,
		domain.ErrorCodePlanExpired,
		domain.ErrorCodePoolDepleted:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusConflict,
			"Key Exchange material conflicts with current state",
			err,
		)
	case domain.ErrorCodeQuotaExceeded:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusTooManyRequests,
			"Key Exchange quota was exceeded",
			err,
		)
	case domain.ErrorCodePayloadTooLarge:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusRequestEntityTooLarge,
			"Key Exchange payload exceeds the configured limit",
			err,
		)
	case domain.ErrorCodeDependency:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusServiceUnavailable,
			"Key Exchange dependency is unavailable",
			err,
		)
	default:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusInternalServerError,
			"Key Exchange operation failed",
			err,
		)
	}
}

var _ canonicalAPI = (*httpinterface.CanonicalAPI)(nil)
var _ PeerCapabilities = (*subServer)(nil)
