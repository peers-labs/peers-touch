package social_gate

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// OperationExtractor derives Operation fields from the raw request body.
// It is called after the wrapper sets the Action; the extractor only needs to
// populate TargetPtid and ConversationID from the request payload.
type OperationExtractor func(body []byte) Operation

// NewGateWrapper returns a server.Wrapper that evaluates the social gate
// before allowing the request to reach the inner handler.
//
// Behavior on gate verdict:
//   - nil error: request passes through to the next handler.
//   - *PolicyDeniedError: respond 403 with JSON {"code": "...", "retry_after_sec": 0}.
//   - *RateLimitedError: respond 429 with Retry-After header and JSON body.
//   - Any other error: fail closed with 403 and code "GATE_ERROR".
func NewGateWrapper(gate SocialGate, action string, extractor OperationExtractor) server.Wrapper {
	return func(next server.EndpointHandler) server.EndpointHandler {
		return func(ctx context.Context, req server.Request, resp server.Response) error {
			op := Operation{Action: action}
			if extractor != nil {
				extracted := extractor(req.Body())
				op.TargetPtid = extracted.TargetPtid
				op.ConversationID = extracted.ConversationID
			}

			if err := gate.Evaluate(ctx, op); err != nil {
				return handleGateError(err, resp)
			}

			return next(ctx, req, resp)
		}
	}
}

// handleGateError writes the appropriate HTTP response for a gate rejection.
func handleGateError(err error, resp server.Response) error {
	var denied *PolicyDeniedError
	var limited *RateLimitedError

	switch {
	case errors.As(err, &denied):
		resp.SetHeader("Content-Type", "application/json")
		resp.WriteHeader(http.StatusForbidden)
		body, _ := json.Marshal(map[string]any{
			"code":            denied.Code,
			"retry_after_sec": 0,
		})
		resp.Write(body) //nolint:errcheck // best-effort response write
		return nil

	case errors.As(err, &limited):
		resp.SetHeader("Content-Type", "application/json")
		resp.SetHeader("Retry-After", strconv.Itoa(limited.RetryAfterSec))
		resp.WriteHeader(http.StatusTooManyRequests)
		body, _ := json.Marshal(map[string]any{
			"code":            "RATE_LIMITED",
			"retry_after_sec": limited.RetryAfterSec,
		})
		resp.Write(body) //nolint:errcheck // best-effort response write
		return nil

	default:
		// Unknown error from gate — fail closed
		resp.SetHeader("Content-Type", "application/json")
		resp.WriteHeader(http.StatusForbidden)
		body, _ := json.Marshal(map[string]any{
			"code":            "GATE_ERROR",
			"retry_after_sec": 0,
		})
		resp.Write(body) //nolint:errcheck // best-effort response write
		return nil
	}
}
