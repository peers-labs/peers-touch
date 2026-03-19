package util

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

func ReqBind[T proto.Message](c context.Context, ctx *app.RequestContext, param T) (T, error) {
	method := string(ctx.Method())
	contentType := string(ctx.GetHeader("Content-Type"))

	switch method {
	case http.MethodGet:
		if err := ctx.BindQuery(param); err != nil {
			logger.Error(c, "failed to bind query parameters", "error", err)
			RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_QUERY_PARAMETERS))
			return param, err
		}
		return param, nil

	case http.MethodPost, http.MethodPut, http.MethodPatch:
		if strings.Contains(contentType, model.ContentTypeProtobuf) {
			body, err := ctx.Body()
			if err != nil {
				logger.Error(c, "failed to read body", "error", err)
				RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_FAILED_TO_READ_BODY))
				return param, err
			}
			if err := proto.Unmarshal(body, param); err != nil {
				logger.Error(c, "failed to unmarshal proto", "error", err)
				RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_PROTOBUF))
				return param, err
			}
			return param, nil
		}

		if err := ctx.Bind(param); err != nil {
			logger.Error(c, "failed to bind request body", "error", err)
			RspError(c, ctx, http.StatusBadRequest, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INVALID_REQUEST_BODY))
			return param, err
		}
		return param, nil

	default:
		err := fmt.Errorf("unsupported HTTP method: %s", method)
		logger.Error(c, "unsupported HTTP method", "method", method)
		RspError(c, ctx, http.StatusMethodNotAllowed, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_METHOD_NOT_ALLOWED))
		return param, err
	}
}

func RspBack(c context.Context, ctx *app.RequestContext, statusCode int, msg proto.Message) {
	accept := string(ctx.GetHeader("Accept"))
	contentType := string(ctx.GetHeader("Content-Type"))

	shouldUseProto := strings.Contains(accept, model.AcceptProtobuf) ||
		strings.Contains(contentType, model.ContentTypeProtobuf)

	if shouldUseProto {
		data, err := proto.Marshal(msg)
		if err != nil {
			logger.Error(c, "failed to marshal protobuf", "error", err)
			RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR))
			return
		}
		ctx.Data(statusCode, model.ContentTypeProtobuf, data)
		return
	}

	data, err := json.Marshal(msg)
	if err != nil {
		logger.Error(c, "failed to marshal json", "error", err)
		RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR))
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		logger.Error(c, "failed to unmarshal json to map", "error", err)
		RspError(c, ctx, http.StatusInternalServerError, model.NewErrorResponse(model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR))
		return
	}

	ctx.JSON(statusCode, result)
}

func RspError(c context.Context, ctx *app.RequestContext, statusCode int, errResp *model.ErrorResponse) {
	accept := string(ctx.GetHeader("Accept"))
	contentType := string(ctx.GetHeader("Content-Type"))

	shouldUseProto := strings.Contains(accept, model.AcceptProtobuf) ||
		strings.Contains(contentType, model.ContentTypeProtobuf)

	if shouldUseProto {
		data, err := proto.Marshal(errResp)
		if err != nil {
			logger.Error(c, "failed to marshal error response", "error", err)
			ctx.Data(statusCode, model.ContentTypeProtobuf, []byte(errResp.Message))
			return
		}
		ctx.Data(statusCode, model.ContentTypeProtobuf, data)
		return
	}

	ctx.JSON(statusCode, map[string]interface{}{
		"code":    int32(errResp.Code),
		"message": errResp.Message,
	})
}
