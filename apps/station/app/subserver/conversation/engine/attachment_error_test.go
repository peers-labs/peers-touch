package conversationengine

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

func TestAttachmentErrorsUseCanonicalProtobufBody(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		status    int
		code      chat.AttachmentTransferErrorCode
		retryable bool
	}{
		{
			name:   "expired",
			err:    domain.ErrAttachmentExpired,
			status: http.StatusConflict,
			code:   chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_UPLOAD_EXPIRED,
		},
		{
			name:   "part conflict",
			err:    domain.ErrAttachmentConflict,
			status: http.StatusConflict,
			code:   chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_PART_CONFLICT,
		},
		{
			name:   "not granted",
			err:    domain.ErrAttachmentNotGranted,
			status: http.StatusForbidden,
			code:   chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED,
		},
		{
			name:      "quota",
			err:       domain.ErrAttachmentQuota,
			status:    http.StatusTooManyRequests,
			code:      chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_QUOTA_EXCEEDED,
			retryable: true,
		},
		{
			name:   "etag",
			err:    domain.ErrAttachmentETag,
			status: http.StatusPreconditionFailed,
			code:   chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH,
		},
		{
			name:   "range",
			err:    domain.ErrAttachmentRange,
			status: http.StatusRequestedRangeNotSatisfiable,
			code:   chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RANGE_INVALID,
		},
		{
			name:   "descriptor",
			err:    domain.ErrAttachmentDescriptor,
			status: http.StatusBadRequest,
			code:   chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mapped := mapConversationEngineError(test.err)
			var handlerError *server.HandlerError
			if !errors.As(mapped, &handlerError) {
				t.Fatalf("mapped error type = %T", mapped)
			}
			if handlerError.Code != test.status ||
				handlerError.ContentType != "application/x-protobuf" {
				t.Fatalf("unexpected handler error: %+v", handlerError)
			}
			var payload chat.AttachmentTransferError
			if err := proto.Unmarshal(handlerError.Body, &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Code != test.code || payload.RetryAfter != nil {
				t.Fatalf("unexpected attachment error payload: %+v", &payload)
			}
			if test.retryable && payload.Code !=
				chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_QUOTA_EXCEEDED {
				t.Fatal("retryable mapping lost canonical quota code")
			}
		})
	}
}

func TestAttachmentRetryLaterCarriesCanonicalDelay(t *testing.T) {
	mapped := attachmentHandlerError(
		http.StatusServiceUnavailable,
		chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER,
		1500*time.Millisecond,
	)
	var handlerError *server.HandlerError
	if !errors.As(mapped, &handlerError) {
		t.Fatalf("mapped error type = %T", mapped)
	}
	if handlerError.Headers["Retry-After"] != "2" {
		t.Fatalf("Retry-After = %q", handlerError.Headers["Retry-After"])
	}
	var payload chat.AttachmentTransferError
	if err := proto.Unmarshal(handlerError.Body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code !=
		chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER ||
		payload.RetryAfter == nil ||
		payload.RetryAfter.Seconds != 1 ||
		payload.RetryAfter.Nanos != 500_000_000 {
		t.Fatalf("unexpected retry-later payload: %+v", &payload)
	}
}

func TestUnknownAttachmentFailureMapsToRetryLater(t *testing.T) {
	mapped := mapAttachmentError(errors.New("storage temporarily unavailable"))
	var handlerError *server.HandlerError
	if !errors.As(mapped, &handlerError) {
		t.Fatalf("mapped error type = %T", mapped)
	}
	if handlerError.Code != http.StatusServiceUnavailable ||
		handlerError.Headers["Retry-After"] != "1" {
		t.Fatalf("unexpected handler error: %+v", handlerError)
	}
	var payload chat.AttachmentTransferError
	if err := proto.Unmarshal(handlerError.Body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code !=
		chat.AttachmentTransferErrorCode_ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER ||
		payload.RetryAfter == nil ||
		payload.RetryAfter.Seconds != 1 ||
		payload.RetryAfter.Nanos != 0 {
		t.Fatalf("unexpected retry-later payload: %+v", &payload)
	}
}
