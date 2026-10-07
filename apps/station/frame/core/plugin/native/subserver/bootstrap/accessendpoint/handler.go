package accessendpoint

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const Path = "/.well-known/peers-touch/access"
const maxRequestBytes = 64 * 1024

type Provider interface {
	AccessEndpoint(
		context.Context,
		*peerpb.AccessEndpointRequest,
	) (*peerpb.AccessEndpointResponse, error)
}

func Handler(provider Provider, wrappers ...server.Wrapper) server.Handler {
	return server.NewCanonicalProtobufHandler(
		"access-endpoint-discovery",
		Path,
		server.POST,
		func() *peerpb.AccessEndpointRequest {
			return &peerpb.AccessEndpointRequest{}
		},
		provider.AccessEndpoint,
		server.CanonicalProtobufHandlerOptions{
			MaxBodyBytes: maxRequestBytes,
			ErrorCodes: server.CanonicalProtobufErrorCodes{
				Unauthorized:           int32(model.ErrorCode_ERROR_CODE_UNAUTHORIZED),
				InvalidQueryParameters: int32(model.ErrorCode_ERROR_CODE_INVALID_QUERY_PARAMETERS),
				InvalidRequestBody:     int32(model.ErrorCode_ERROR_CODE_INVALID_REQUEST_BODY),
				InvalidProtobuf:        int32(model.ErrorCode_ERROR_CODE_INVALID_PROTOBUF),
				FailedToReadBody:       int32(model.ErrorCode_ERROR_CODE_FAILED_TO_READ_BODY),
				PayloadTooLarge:        int32(model.ErrorCode_ERROR_CODE_INVALID_REQUEST_BODY),
				InternalServer:         int32(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR),
			},
			ProjectError: func(failure server.RouteError) ([]byte, error) {
				return proto.MarshalOptions{Deterministic: true}.Marshal(
					&model.ErrorResponse{
						Code:    model.ErrorCode(failure.StableCode),
						Message: failure.Message,
					},
				)
			},
		},
		wrappers...,
	)
}
