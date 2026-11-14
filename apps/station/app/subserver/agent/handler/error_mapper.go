package handler

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const (
	errorDetailsHeader         = "X-Peers-Error-Details"
	maxErrorDetailsHeaderBytes = 4096
)

func toHandlerError(err error) error {
	if err == nil {
		return nil
	}
	var biz *errcode.BizError
	var handlerErr *server.HandlerError
	if errors.As(err, &biz) {
		handlerErr = server.NewHandlerErrorWithCause(
			biz.HTTPStatus,
			fmt.Sprintf("[%s] %s", biz.Code, biz.Message),
			err,
		)
		if biz.Payload != nil {
			handlerErr.Headers = map[string]string{
				"X-Peers-Error-Code":       biz.Payload.GetErrorType(),
				"X-Peers-Error-Locale-Key": biz.Payload.GetLocaleKey(),
				"X-Peers-Error-Retryable":  fmt.Sprintf("%t", biz.Payload.GetRetryable()),
				"X-Peers-Error-Terminal":   fmt.Sprintf("%t", biz.Payload.GetTerminal()),
				"X-Peers-Required-Gate":    biz.Payload.GetDetails()["required_gate"],
			}
			if details := boundedErrorDetailsHeader(biz.Payload.GetDetails()); details != "" {
				handlerErr.Headers[errorDetailsHeader] = details
			}
		}
	} else {
		handlerErr = server.InternalErrorWithCause(fmt.Sprintf("[%s] internal error", errcode.AgentInternal), err)
	}
	// Error envelopes are JSON even when the successful response is protobuf.
	// A protobuf serializer cannot marshal an untyped map.
	handlerErr.ContentType = "application/json"
	handlerErr.Body, _ = json.Marshal(map[string]any{
		"error": handlerErr.Message,
		"code":  handlerErr.Code,
	})
	return handlerErr
}

func boundedErrorDetailsHeader(details map[string]string) string {
	if len(details) == 0 {
		return ""
	}
	encoded, err := json.Marshal(details)
	if err != nil || len(encoded) > maxErrorDetailsHeaderBytes {
		return ""
	}
	return string(encoded)
}
