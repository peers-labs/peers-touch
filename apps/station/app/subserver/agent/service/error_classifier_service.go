// Change History:
//   - 2026-04-11: Initial implementation — complete error classification pipeline
//     for LLM provider failover. Classifies upstream errors by HTTP status, provider
//     error code, message pattern matching, and transport heuristics; maps each
//     FailoverReason to recovery action flags (retryable, compress, rotate, fallback).
//   - 2026-04-11: Added ProviderHTTPError type assertion in extractHTTPStatus so
//     that HTTP status codes from provider_service's non-2xx responses flow into
//     the Priority 1 classification pipeline.
package service

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// ---------------------------------------------------------------------------
// Pattern tables — ported from hermes error classifier
// ---------------------------------------------------------------------------

var billingPatterns = []string{
	"insufficient_quota",
	"billing hard limit",
	"exceeded your current quota",
	"account has been deactivated",
	"account is not active",
	"payment required",
	"plan limit reached",
	"credit balance is too low",
	"balance is insufficient",
	"no available billing method",
}

var rateLimitPatterns = []string{
	"rate limit",
	"rate_limit",
	"too many requests",
	"throttled",
	"capacity",
	"request_limit_exceeded",
	"requests per minute",
	"tokens per minute",
	"requests per day",
	"resource_exhausted",
	"overloaded",
}

var contextOverflowPatterns = []string{
	"maximum context length",
	"context length exceeded",
	"token limit",
	"max_tokens",
	"context_length_exceeded",
	"too many tokens",
	"input is too long",
	"prompt is too long",
	"reduce the length",
	"上下文长度超过限制",
	"context window",
	"sequence length",
}

var modelNotFoundPatterns = []string{
	"model not found",
	"model_not_found",
	"does not exist",
	"model_not_available",
	"no such model",
	"invalid model",
	"unknown model",
	"model is not accessible",
}

var authPatterns = []string{
	"invalid api key",
	"invalid_api_key",
	"authentication failed",
	"unauthorized",
	"invalid bearer token",
	"api key expired",
	"permission denied",
	"access denied",
	"forbidden",
}

var transientRateLimitSignals = []string{
	"daily",
	"minute",
	"rpm",
	"per minute",
	"per day",
	"per hour",
}

// ---------------------------------------------------------------------------
// Recovery action table
// ---------------------------------------------------------------------------

type recoveryAction struct {
	Retryable              bool
	ShouldCompress         bool
	ShouldRotateCredential bool
	ShouldFallback         bool
}

var recoveryActionTable = map[domain.FailoverReason]recoveryAction{
	domain.FailoverReasonAuth:              {Retryable: true, ShouldRotateCredential: true},
	domain.FailoverReasonAuthPermanent:     {ShouldFallback: true},
	domain.FailoverReasonBilling:           {ShouldFallback: true},
	domain.FailoverReasonRateLimit:         {Retryable: true, ShouldRotateCredential: true},
	domain.FailoverReasonOverloaded:        {Retryable: true, ShouldFallback: true},
	domain.FailoverReasonServerError:       {Retryable: true},
	domain.FailoverReasonTimeout:           {Retryable: true},
	domain.FailoverReasonContextOverflow:   {ShouldCompress: true},
	domain.FailoverReasonPayloadTooLarge:   {ShouldCompress: true},
	domain.FailoverReasonModelNotFound:     {ShouldFallback: true},
	domain.FailoverReasonFormatError:       {},
	domain.FailoverReasonThinkingSignature: {},
	domain.FailoverReasonLongContextTier:   {ShouldCompress: true},
	domain.FailoverReasonUnknown:           {Retryable: true},
}

// ---------------------------------------------------------------------------
// ErrorClassifierService
// ---------------------------------------------------------------------------

type ErrorClassifierService struct{}

func NewErrorClassifierService() *ErrorClassifierService {
	return &ErrorClassifierService{}
}

func (s *ErrorClassifierService) Classify(
	err error,
	provider string,
	model string,
	approxTokens int,
	contextLength int,
) *domain.ClassifiedError {

	ctx := context.Background()
	httpStatus := extractHTTPStatus(err)
	msg := extractErrorMessage(err)
	code := extractErrorCode(err)

	reason := s.runPipeline(httpStatus, code, msg, approxTokens, contextLength)

	action := recoveryActionTable[reason]

	result := &domain.ClassifiedError{
		Reason:                 reason,
		Retryable:              action.Retryable,
		ShouldCompress:         action.ShouldCompress,
		ShouldRotateCredential: action.ShouldRotateCredential,
		ShouldFallback:         action.ShouldFallback,
		Provider:               provider,
		Model:                  model,
		HTTPStatus:             httpStatus,
		ErrorCode:              code,
		ErrorMessage:           msg,
		ClassifiedAt:           time.Now(),
	}

	logger.Infof(ctx,
		"error classified: provider=%s model=%s reason=%s http=%d retryable=%v compress=%v rotate=%v fallback=%v",
		provider, model, reason.String(), httpStatus,
		result.Retryable, result.ShouldCompress, result.ShouldRotateCredential, result.ShouldFallback,
	)

	return result
}

// ---------------------------------------------------------------------------
// Classification pipeline (priority ordered)
// ---------------------------------------------------------------------------

func (s *ErrorClassifierService) runPipeline(
	httpStatus int,
	code string,
	msg string,
	approxTokens int,
	contextLength int,
) domain.FailoverReason {

	// Priority 1: HTTP status code + message refinement
	if reason, matched := s.classifyByHTTPStatus(httpStatus, msg); matched {
		return reason
	}

	// Priority 2: Provider error code
	if reason, matched := s.classifyByErrorCode(code); matched {
		return reason
	}

	// Priority 3: Message pattern matching
	if reason, matched := s.classifyByMessagePattern(msg); matched {
		return reason
	}

	// Priority 4: Transport / timeout heuristic
	if reason, matched := s.classifyByTransport(msg); matched {
		return reason
	}

	// Priority 5: Server disconnect + large session → infer context overflow
	if s.inferContextOverflow(httpStatus, approxTokens, contextLength) {
		return domain.FailoverReasonContextOverflow
	}

	// Priority 6: Fallback
	return domain.FailoverReasonUnknown
}

// Priority 1: HTTP status classification with 402 disambiguation.
func (s *ErrorClassifierService) classifyByHTTPStatus(status int, msg string) (domain.FailoverReason, bool) {
	switch status {
	case 401:
		return domain.FailoverReasonAuth, true

	case 402:
		return s.disambiguate402(msg), true

	case 403:
		if containsAny(msg, authPatterns) {
			return domain.FailoverReasonAuth, true
		}
		return domain.FailoverReasonAuthPermanent, true

	case 413:
		return domain.FailoverReasonPayloadTooLarge, true

	case 422:
		return domain.FailoverReasonFormatError, true

	case 429:
		return domain.FailoverReasonRateLimit, true

	case 503:
		return domain.FailoverReasonOverloaded, true

	case 502, 504:
		return domain.FailoverReasonServerError, true
	}

	if status >= 500 && status < 600 {
		return domain.FailoverReasonServerError, true
	}

	return domain.FailoverReasonUnknown, false
}

// disambiguate402 separates transient rate-limit signals from billing errors on 402.
func (s *ErrorClassifierService) disambiguate402(msg string) domain.FailoverReason {
	if containsAny(msg, transientRateLimitSignals) {
		return domain.FailoverReasonRateLimit
	}
	return domain.FailoverReasonBilling
}

// Priority 2: Provider error code classification.
func (s *ErrorClassifierService) classifyByErrorCode(code string) (domain.FailoverReason, bool) {
	if code == "" {
		return domain.FailoverReasonUnknown, false
	}

	lower := strings.ToLower(code)

	switch {
	case strings.Contains(lower, "billing") || strings.Contains(lower, "quota"):
		return domain.FailoverReasonBilling, true

	case strings.Contains(lower, "rate") || strings.Contains(lower, "limit") || strings.Contains(lower, "throttl"):
		return domain.FailoverReasonRateLimit, true

	case strings.Contains(lower, "context_length") || strings.Contains(lower, "token"):
		return domain.FailoverReasonContextOverflow, true

	case strings.Contains(lower, "model_not_found") || strings.Contains(lower, "not_found"):
		return domain.FailoverReasonModelNotFound, true

	case strings.Contains(lower, "auth") || strings.Contains(lower, "unauthorized") || strings.Contains(lower, "forbidden"):
		return domain.FailoverReasonAuth, true

	case strings.Contains(lower, "invalid_request") || strings.Contains(lower, "format"):
		return domain.FailoverReasonFormatError, true

	case strings.Contains(lower, "overloaded") || strings.Contains(lower, "capacity"):
		return domain.FailoverReasonOverloaded, true
	}

	return domain.FailoverReasonUnknown, false
}

// Priority 3: Message pattern matching against known error signatures.
func (s *ErrorClassifierService) classifyByMessagePattern(msg string) (domain.FailoverReason, bool) {
	if containsAny(msg, billingPatterns) {
		return domain.FailoverReasonBilling, true
	}
	if containsAny(msg, rateLimitPatterns) {
		return domain.FailoverReasonRateLimit, true
	}
	if containsAny(msg, contextOverflowPatterns) {
		return domain.FailoverReasonContextOverflow, true
	}
	if containsAny(msg, modelNotFoundPatterns) {
		return domain.FailoverReasonModelNotFound, true
	}
	if containsAny(msg, authPatterns) {
		return domain.FailoverReasonAuth, true
	}
	return domain.FailoverReasonUnknown, false
}

// Priority 4: Transport and timeout heuristics.
func (s *ErrorClassifierService) classifyByTransport(msg string) (domain.FailoverReason, bool) {
	timeoutSignals := []string{
		"timeout",
		"deadline exceeded",
		"context deadline",
		"connection timed out",
		"tls handshake timeout",
	}
	if containsAny(msg, timeoutSignals) {
		return domain.FailoverReasonTimeout, true
	}

	dnsSignals := []string{
		"no such host",
		"dns",
		"name resolution",
	}
	if containsAny(msg, dnsSignals) {
		return domain.FailoverReasonServerError, true
	}

	connSignals := []string{
		"connection refused",
		"connection reset",
		"broken pipe",
		"eof",
	}
	if containsAny(msg, connSignals) {
		return domain.FailoverReasonServerError, true
	}

	return domain.FailoverReasonUnknown, false
}

// Priority 5: Infer context overflow from server disconnect on large sessions.
// If the server disconnected (5xx or 0) and the session used >75% of context window,
// the most likely cause is an undeclared context overflow.
func (s *ErrorClassifierService) inferContextOverflow(
	httpStatus int,
	approxTokens int,
	contextLength int,
) bool {
	if contextLength <= 0 || approxTokens <= 0 {
		return false
	}

	isServerDisconnect := httpStatus == 0 || (httpStatus >= 500 && httpStatus < 600)
	ratio := float64(approxTokens) / float64(contextLength)

	return isServerDisconnect && ratio > 0.75
}

// ---------------------------------------------------------------------------
// Error introspection helpers
// ---------------------------------------------------------------------------

// extractHTTPStatus walks the error chain to find an HTTP status code.
// Checks ProviderHTTPError first, then BizError.HTTPStatus, then falls back
// to interface-based detection and net-level heuristics.
//
// Changelog:
// 2026-04-11 — Added ProviderHTTPError check so that HTTP status codes from
//
//	provider_service's Do() calls reach the Priority 1 classification pipeline.
func extractHTTPStatus(err error) int {
	if err == nil {
		return 0
	}

	// Check for ProviderHTTPError (provider_service wraps HTTP errors).
	var providerErr *ProviderHTTPError
	if errors.As(err, &providerErr) {
		return providerErr.StatusCode
	}

	var bizErr *errcode.BizError
	if errors.As(err, &bizErr) {
		return bizErr.HTTPStatus
	}

	type httpStatuser interface {
		StatusCode() int
	}
	var statuser httpStatuser
	if errors.As(err, &statuser) {
		return statuser.StatusCode()
	}

	type httpStatusField interface {
		HTTPStatus() int
	}
	var statusField httpStatusField
	if errors.As(err, &statusField) {
		return statusField.HTTPStatus()
	}

	if isTimeoutError(err) {
		return 0
	}

	return 0
}

// extractErrorMessage normalises the full error message to lowercase for pattern matching.
func extractErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	return strings.ToLower(err.Error())
}

// extractErrorCode attempts to pull a provider error code from the error chain.
func extractErrorCode(err error) string {
	if err == nil {
		return ""
	}

	var bizErr *errcode.BizError
	if errors.As(err, &bizErr) {
		return string(bizErr.Code)
	}

	type errorCoder interface {
		ErrorCode() string
	}
	var coder errorCoder
	if errors.As(err, &coder) {
		return coder.ErrorCode()
	}

	return ""
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

func containsAny(msg string, patterns []string) bool {
	for _, p := range patterns {
		if strings.Contains(msg, p) {
			return true
		}
	}
	return false
}

func isTimeoutError(err error) bool {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return true
	}
	return false
}
