package bootstrapblob

import (
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

type Retriever interface {
	RetrieveBootstrapBlob(context.Context, *peerpb.RetrieveBootstrapBlobRequest) (*peerpb.RetrieveBootstrapBlobResponse, error)
}

func RetrievalHandler(provider Retriever, wrappers ...server.Wrapper) server.Handler {
	return server.NewCanonicalProtobufHandler(
		"network-bootstrap-retrieve", RetrievalPath, server.POST,
		func() *peerpb.RetrieveBootstrapBlobRequest { return &peerpb.RetrieveBootstrapBlobRequest{} },
		func(ctx context.Context, request *peerpb.RetrieveBootstrapBlobRequest) (*peerpb.RetrieveBootstrapBlobResponse, error) {
			bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			return provider.RetrieveBootstrapBlob(bounded, request)
		},
		options(), wrappers...,
	)
}

func PublicationHandler(
	publish func(context.Context, *peerpb.PublishBootstrapBlobRequest) (*peerpb.PublishBootstrapBlobResponse, error),
	wrappers ...server.Wrapper,
) server.Handler {
	return server.NewCanonicalProtobufHandler(
		"relay-bootstrap-publish", PublishPath, server.POST,
		func() *peerpb.PublishBootstrapBlobRequest { return &peerpb.PublishBootstrapBlobRequest{} },
		func(ctx context.Context, request *peerpb.PublishBootstrapBlobRequest) (*peerpb.PublishBootstrapBlobResponse, error) {
			bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			return publish(bounded, request)
		}, options(), wrappers...,
	)
}

func options() server.CanonicalProtobufHandlerOptions {
	return server.CanonicalProtobufHandlerOptions{
		MaxBodyBytes: peerpb.MaxBootstrapBlobBytes + 4096,
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
				&model.ErrorResponse{Code: model.ErrorCode(failure.StableCode), Message: failure.Message},
			)
		},
	}
}
