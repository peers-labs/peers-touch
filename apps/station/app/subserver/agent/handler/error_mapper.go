package handler

import (
	"errors"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func toHandlerError(err error) error {
	if err == nil {
		return nil
	}
	var biz *errcode.BizError
	if errors.As(err, &biz) {
		handlerErr := server.NewHandlerErrorWithCause(
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
		}
		return handlerErr
	}
	return server.InternalErrorWithCause(fmt.Sprintf("[%s] internal error", errcode.AgentInternal), err)
}
