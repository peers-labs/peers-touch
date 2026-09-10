package http

import (
	"errors"
	"fmt"
	nethttp "net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// MapError converts typed Recovery failures into stable Station HTTP failures.
func MapError(err error) error {
	if err == nil {
		return nil
	}

	var typed *domain.Error
	if !errors.As(err, &typed) {
		return server.InternalErrorWithCause("Recovery operation failed", err)
	}

	message := fmt.Sprintf("[%s] %s", typed.Code, publicErrorMessage(typed.Code))
	switch typed.Code {
	case domain.ErrorCodeInvalidArgument,
		domain.ErrorCodeArchiveIntegrity,
		domain.ErrorCodeArchiveTooLarge:
		return server.NewHandlerErrorWithCause(nethttp.StatusBadRequest, message, err)
	case domain.ErrorCodeUnauthorized:
		return server.NewHandlerErrorWithCause(nethttp.StatusForbidden, message, err)
	case domain.ErrorCodeRevisionConflict:
		return server.NewHandlerErrorWithCause(nethttp.StatusConflict, message, err)
	case domain.ErrorCodeRevisionNotFound:
		return server.NewHandlerErrorWithCause(nethttp.StatusNotFound, message, err)
	default:
		return server.NewHandlerErrorWithCause(
			nethttp.StatusInternalServerError,
			message,
			err,
		)
	}
}

func publicErrorMessage(code domain.ErrorCode) string {
	switch code {
	case domain.ErrorCodeInvalidArgument:
		return "invalid Recovery request"
	case domain.ErrorCodeUnauthorized:
		return "Recovery operation is not authorized"
	case domain.ErrorCodeArchiveIntegrity:
		return "Recovery archive integrity check failed"
	case domain.ErrorCodeArchiveTooLarge:
		return "Recovery archive exceeds the configured limit"
	case domain.ErrorCodeRevisionConflict:
		return "Recovery revision conflicts with existing content"
	case domain.ErrorCodeRevisionNotFound:
		return "Recovery revision was not found"
	case domain.ErrorCodeDependencyFailure:
		return "Recovery dependency failed"
	case domain.ErrorCodePersistence:
		return "Recovery persistence failed"
	default:
		return "Recovery operation failed"
	}
}
