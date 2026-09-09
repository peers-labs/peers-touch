package key_exchange

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const (
	uploadDirectKeyBundlePath        = "/key-exchange/keys/bundle"
	fetchDirectKeyBundlesPath        = "/key-exchange/keys/bundle/fetch"
	replenishDirectOneTimePreKeyPath = "/key-exchange/keys/replenish"
	countDirectOneTimePreKeyPath     = "/key-exchange/keys/count"
	uploadMLSKeyPackagePath          = "/key-exchange/mls/key-package/upload"
	fetchMLSKeyPackagePath           = "/key-exchange/mls/key-package/fetch"
	countMLSKeyPackagesPath          = "/key-exchange/mls/key-package/count"
	sendDirectKeyExchangePath        = "/key-exchange/dkx/send"
)

// Handlers registers the sole client-facing Key Exchange route family.
func (s *subServer) Handlers() []server.Handler {
	logID := serverwrapper.LogID()
	deviceID := serverwrapper.DeviceID()
	return []server.Handler{
		server.NewTypedHandler(
			"key-exchange-direct-bundle-upload",
			uploadDirectKeyBundlePath,
			server.POST,
			s.handleUploadDirectKeyBundle,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-direct-bundle-fetch",
			fetchDirectKeyBundlesPath,
			server.POST,
			s.handleFetchDirectKeyBundles,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-direct-one-time-pre-key-replenish",
			replenishDirectOneTimePreKeyPath,
			server.POST,
			s.handleReplenishDirectOneTimePreKeys,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-direct-one-time-pre-key-count",
			countDirectOneTimePreKeyPath,
			server.GET,
			s.handleCountDirectOneTimePreKeys,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-mls-key-package-upload",
			uploadMLSKeyPackagePath,
			server.POST,
			s.handleUploadMLSKeyPackage,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-mls-key-package-fetch",
			fetchMLSKeyPackagePath,
			server.POST,
			s.handleFetchMLSKeyPackage,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-mls-key-package-count",
			countMLSKeyPackagesPath,
			server.GET,
			s.handleCountMLSKeyPackages,
			logID,
			deviceID,
			s.jwtWrapper,
		),
		server.NewTypedHandler(
			"key-exchange-dkx-send",
			sendDirectKeyExchangePath,
			server.POST,
			s.handleSendDirectKeyExchange,
			logID,
			deviceID,
			s.jwtWrapper,
		),
	}
}

func (s *subServer) handleUploadDirectKeyBundle(
	ctx context.Context,
	request *kemodel.UploadDirectKeyBundleRequest,
) (*kemodel.UploadDirectKeyBundleResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.UploadDirectKeyBundle(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func (s *subServer) handleFetchDirectKeyBundles(
	ctx context.Context,
	request *kemodel.FetchDirectKeyBundlesRequest,
) (*kemodel.FetchDirectKeyBundlesResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.FetchDirectKeyBundles(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func (s *subServer) handleReplenishDirectOneTimePreKeys(
	ctx context.Context,
	request *kemodel.ReplenishDirectOneTimePreKeysRequest,
) (*kemodel.ReplenishDirectOneTimePreKeysResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.ReplenishDirectOneTimePreKeys(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func (s *subServer) handleCountDirectOneTimePreKeys(
	ctx context.Context,
	request *kemodel.CountDirectOneTimePreKeysRequest,
) (*kemodel.CountDirectOneTimePreKeysResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.CountDirectOneTimePreKeys(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func (s *subServer) handleUploadMLSKeyPackage(
	ctx context.Context,
	request *kemodel.UploadMlsKeyPackageRequest,
) (*kemodel.UploadMlsKeyPackageResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.UploadMLSKeyPackage(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func (s *subServer) handleFetchMLSKeyPackage(
	ctx context.Context,
	request *kemodel.FetchMlsKeyPackageRequest,
) (*kemodel.FetchMlsKeyPackageResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.FetchMLSKeyPackage(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func (s *subServer) handleCountMLSKeyPackages(
	ctx context.Context,
	request *kemodel.CountMlsKeyPackagesRequest,
) (*kemodel.CountMlsKeyPackagesResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.CountMLSKeyPackages(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func (s *subServer) handleSendDirectKeyExchange(
	ctx context.Context,
	request *kemodel.SendDirectKeyExchangeRequest,
) (*kemodel.SendDirectKeyExchangeResponse, error) {
	actorPTID, deviceID, err := authenticatedKeyExchangeEndpoint(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.api.SendDirectKeyExchange(
		ctx,
		actorPTID,
		deviceID,
		request,
	)
	return response, mapKeyExchangeError(err)
}

func authenticatedKeyExchangeEndpoint(
	ctx context.Context,
) (string, string, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return "", "", server.Unauthorized("authentication required")
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return "", "", server.BadRequest("X-Device-ID is required")
	}
	return strings.TrimSpace(subject.ID), deviceID, nil
}

func mapKeyExchangeError(err error) error {
	if err == nil {
		return nil
	}
	var typed *domain.Error
	if !errors.As(err, &typed) {
		return server.InternalErrorWithCause("key exchange operation failed", err)
	}
	message := fmt.Sprintf("[%s] key exchange operation failed", typed.Code)
	switch typed.Code {
	case domain.ErrorCodeInvalidArgument:
		return server.NewHandlerErrorWithCause(
			http.StatusBadRequest,
			message,
			err,
		)
	case domain.ErrorCodeUnauthorized:
		return server.NewHandlerErrorWithCause(
			http.StatusForbidden,
			message,
			err,
		)
	case domain.ErrorCodeNotFound:
		return server.NewHandlerErrorWithCause(
			http.StatusNotFound,
			message,
			err,
		)
	case domain.ErrorCodeConflict,
		domain.ErrorCodeStaleMaterial,
		domain.ErrorCodePlanExpired:
		return server.NewHandlerErrorWithCause(
			http.StatusConflict,
			message,
			err,
		)
	case domain.ErrorCodePayloadTooLarge:
		return server.NewHandlerErrorWithCause(
			http.StatusRequestEntityTooLarge,
			message,
			err,
		)
	case domain.ErrorCodeDependency:
		return server.NewHandlerErrorWithCause(
			http.StatusServiceUnavailable,
			message,
			err,
		)
	default:
		return server.NewHandlerErrorWithCause(
			http.StatusInternalServerError,
			message,
			err,
		)
	}
}
