package handler

import (
	"errors"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/errcode"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func toHandlerError(err error) error {
	if err == nil {
		return nil
	}
	var biz *errcode.BizError
	if errors.As(err, &biz) {
		return server.NewHandlerErrorWithCause(biz.HTTPStatus, fmt.Sprintf("[%s] %s", biz.Code, biz.Message), err)
	}
	return server.InternalErrorWithCause(fmt.Sprintf("[%s] internal error", errcode.AIChatInternal), err)
}
