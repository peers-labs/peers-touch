package domain

import "time"

type FailoverReason int

const (
	FailoverReasonAuth FailoverReason = iota
	FailoverReasonAuthPermanent
	FailoverReasonBilling
	FailoverReasonRateLimit
	FailoverReasonOverloaded
	FailoverReasonServerError
	FailoverReasonTimeout
	FailoverReasonContextOverflow
	FailoverReasonPayloadTooLarge
	FailoverReasonModelNotFound
	FailoverReasonFormatError
	FailoverReasonThinkingSignature
	FailoverReasonLongContextTier
	FailoverReasonUnknown
)

var failoverReasonNames = map[FailoverReason]string{
	FailoverReasonAuth:              "auth",
	FailoverReasonAuthPermanent:     "auth_permanent",
	FailoverReasonBilling:           "billing",
	FailoverReasonRateLimit:         "rate_limit",
	FailoverReasonOverloaded:        "overloaded",
	FailoverReasonServerError:       "server_error",
	FailoverReasonTimeout:           "timeout",
	FailoverReasonContextOverflow:   "context_overflow",
	FailoverReasonPayloadTooLarge:   "payload_too_large",
	FailoverReasonModelNotFound:     "model_not_found",
	FailoverReasonFormatError:       "format_error",
	FailoverReasonThinkingSignature: "thinking_signature",
	FailoverReasonLongContextTier:   "long_context_tier",
	FailoverReasonUnknown:           "unknown",
}

func (r FailoverReason) String() string {
	if name, ok := failoverReasonNames[r]; ok {
		return name
	}
	return "unknown"
}

type ClassifiedError struct {
	Reason                 FailoverReason
	Retryable              bool
	ShouldCompress         bool
	ShouldRotateCredential bool
	ShouldFallback         bool
	Provider               string
	Model                  string
	HTTPStatus             int
	ErrorCode              string
	ErrorMessage           string
	ClassifiedAt           time.Time
}
