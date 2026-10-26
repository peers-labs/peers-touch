package social

import (
	"context"
	"errors"
	"net/http"
	"time"

	searchpb "github.com/peers-labs/peers-touch/station/app/model/search"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

const (
	routeSocialSearchQuery   = "/api/v1/social/search/query"
	routeSocialSearchHydrate = "/api/v1/social/search/hydrate"
	routeSocialSearchResolve = "/api/v1/social/search/resolve"
)

func socialSearchReadWrapper(next server.EndpointHandler) server.EndpointHandler {
	return func(ctx context.Context, req server.Request, resp server.Response) error {
		resp.SetHeader("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return next(ctx, req, resp)
	}
}

func publicSearchHandlerError(err error) error {
	var readError *application.PublicSearchError
	if !errors.As(err, &readError) {
		readError = &application.PublicSearchError{Code: searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_UNAVAILABLE}
	}
	status := http.StatusBadRequest
	switch readError.Code {
	case searchpb.SearchErrorCode_SEARCH_ERROR_CODE_RESOURCE_UNAVAILABLE:
		status = http.StatusNotFound
	case searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_CHANGED:
		status = http.StatusConflict
	case searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CURSOR_EXPIRED:
		status = http.StatusGone
	case searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_UNAVAILABLE:
		status = http.StatusServiceUnavailable
	case searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_TIMEOUT:
		status = http.StatusGatewayTimeout
	case searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CANCELLED:
		status = http.StatusRequestTimeout
	}
	code := model.ErrorCode_ERROR_CODE_INVALID_REQUEST
	if status >= 500 {
		code = model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR
	}
	if status == http.StatusNotFound {
		code = model.ErrorCode_ERROR_CODE_POST_NOT_FOUND
	}
	body, marshalErr := proto.Marshal(&model.ErrorResponse{
		Code: code, Message: readError.Code.String(),
		Details: map[string]string{"search_code": readError.Code.String()},
	})
	if marshalErr != nil {
		return server.InternalError("failed to encode search error")
	}
	return server.NewHandlerErrorWithResponse(status, readError.Code.String(),
		server.CanonicalProtobufContentType, body, map[string]string{"Cache-Control": "no-store"})
}

func (s *subServer) publicSearchActor(ctx context.Context) (string, error) {
	viewer, ok := getActorPTID(ctx)
	if !ok {
		return "", server.Unauthorized("authentication required")
	}
	if s.publicSearchSvc == nil {
		return "", publicSearchHandlerError(nil)
	}
	return viewer, nil
}

func (s *subServer) handlePublicSearchQuery(ctx context.Context, request *searchpb.QueryIntent) (*searchpb.SourcePage, error) {
	viewer, err := s.publicSearchActor(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.publicSearchSvc.Query(ctx, viewer, request)
	if err != nil {
		return nil, publicSearchHandlerError(err)
	}
	return page, nil
}

func (s *subServer) handlePublicSearchHydrate(ctx context.Context, request *searchpb.HydrationRequest) (*searchpb.HydrationReply, error) {
	viewer, err := s.publicSearchActor(ctx)
	if err != nil {
		return nil, err
	}
	reply, err := s.publicSearchSvc.Hydrate(ctx, viewer, request)
	if err != nil {
		return nil, publicSearchHandlerError(err)
	}
	return reply, nil
}

func (s *subServer) handlePublicSearchResolve(ctx context.Context, request *searchpb.ResolveRequest) (*searchpb.ResolvedResource, error) {
	viewer, err := s.publicSearchActor(ctx)
	if err != nil {
		return nil, err
	}
	resolved, err := s.publicSearchSvc.Resolve(ctx, viewer, request)
	if err != nil {
		return nil, publicSearchHandlerError(err)
	}
	return resolved, nil
}
