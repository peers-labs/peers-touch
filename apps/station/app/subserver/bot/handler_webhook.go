package bot

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/bot/application/ingest"
	"github.com/peers-labs/peers-touch/station/app/subserver/bot/domain"
	botmodel "github.com/peers-labs/peers-touch/station/app/subserver/bot/model"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const webhookRoutePrefix = "/bot/webhook/"

// webhookAuthorizationError is the single indistinguishable failure body for
// unknown ids, inactive bots, and missing/wrong secrets (BOT-A10).
const webhookAuthorizationError = "unauthorized"

func (s *subServer) handleWebhook(
	ctx context.Context,
	req server.Request,
	resp server.Response,
) error {
	if s.ingest == nil {
		// Misconfiguration, never a per-request credential failure.
		return server.NewHandlerError(http.StatusServiceUnavailable, "webhook ingestion is not configured")
	}
	webhookID, ok := webhookIDFromPath(req.Path())
	if !ok {
		return server.NewHandlerError(http.StatusUnauthorized, webhookAuthorizationError)
	}
	secret := bearerSecret(req.Header())
	if secret == "" {
		return server.NewHandlerError(http.StatusUnauthorized, webhookAuthorizationError)
	}

	body, err := readBoundedWebhookBody(req)
	if err != nil {
		return server.NewHandlerError(http.StatusRequestEntityTooLarge, "request body exceeds the limit")
	}
	var wire botmodel.IngestWebhookEventRequest
	// RejectUnknownFields keeps the public contract strict so callers cannot
	// smuggle actor/recipient fields that the server would otherwise ignore.
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: false}
	if err := unmarshal.Unmarshal(body, &wire); err != nil {
		return server.NewHandlerError(http.StatusBadRequest, "invalid webhook event payload")
	}

	result, err := s.ingest.Ingest(ctx, webhookID, secret, clientIP(req.Header()), &wire)
	if err != nil {
		return mapIngestError(err)
	}
	out := &botmodel.IngestWebhookEventResponse{
		Outcome: botmodel.IngestOutcome_INGEST_OUTCOME_ACCEPTED,
		EventId: result.EventID,
	}
	if result.Outcome == ingest.OutcomeDeduplicated {
		out.Outcome = botmodel.IngestOutcome_INGEST_OUTCOME_DEDUPLICATED
	}
	return writeWebhookProto(resp, out)
}

func webhookIDFromPath(path string) (string, bool) {
	pathOnly := path
	if index := strings.Index(pathOnly, "?"); index >= 0 {
		pathOnly = pathOnly[:index]
	}
	if !strings.HasPrefix(pathOnly, webhookRoutePrefix) {
		return "", false
	}
	id := strings.TrimPrefix(pathOnly, webhookRoutePrefix)
	if id == "" || strings.Contains(id, "/") || len(id) > domain.MaxFieldLen {
		return "", false
	}
	return id, true
}

func bearerSecret(headers map[string]string) string {
	for key, value := range headers {
		if !strings.EqualFold(key, "Authorization") {
			continue
		}
		const scheme = "Bearer "
		if len(value) >= len(scheme) && strings.EqualFold(value[:len(scheme)], scheme) {
			return strings.TrimSpace(value[len(scheme):])
		}
	}
	return ""
}

func clientIP(headers map[string]string) string {
	for _, key := range []string{"X-Forwarded-For", "X-Real-Ip"} {
		for headerKey, value := range headers {
			if strings.EqualFold(headerKey, key) && value != "" {
				// X-Forwarded-For may be a comma list; the first hop is the
				// client the gateway observed.
				if comma := strings.IndexByte(value, ','); comma >= 0 {
					value = value[:comma]
				}
				return strings.TrimSpace(value)
			}
		}
	}
	return "unknown"
}

func readBoundedWebhookBody(req server.Request) ([]byte, error) {
	var reader io.Reader
	if streaming, ok := req.(server.StreamingRequest); ok {
		reader = streaming.BodyStream()
	} else {
		reader = bytes.NewReader(req.Body())
	}
	body, err := io.ReadAll(io.LimitReader(reader, int64(domain.MaxWebhookBodyBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(body) > domain.MaxWebhookBodyBytes {
		return nil, io.ErrShortBuffer
	}
	return body, nil
}

func mapIngestError(err error) error {
	edge, ok := err.(*ingest.EdgeError)
	if !ok {
		return server.InternalError("webhook ingestion failed")
	}
	switch edge.Code {
	case ingest.CodeUnauthenticated:
		return server.NewHandlerError(http.StatusUnauthorized, webhookAuthorizationError)
	case ingest.CodeInvalidRequest:
		return server.NewHandlerError(http.StatusBadRequest, "invalid webhook event")
	case ingest.CodeRateLimited:
		return server.NewHandlerErrorWithResponse(
			http.StatusTooManyRequests,
			"rate limit exceeded",
			"text/plain",
			[]byte("rate limit exceeded"),
			map[string]string{"Retry-After": strconv.Itoa(edge.RetryAfter)},
		)
	case ingest.CodeDeliveryFailed:
		return server.NewHandlerError(http.StatusBadGateway, "event delivery is temporarily unavailable")
	default:
		return server.InternalError("webhook ingestion failed")
	}
}

func writeWebhookProto(resp server.Response, message proto.Message) error {
	body, err := protojson.MarshalOptions{UseProtoNames: true}.Marshal(message)
	if err != nil {
		return err
	}
	resp.SetHeader("Content-Type", "application/json")
	resp.WriteHeader(http.StatusOK)
	_, err = resp.Write(body)
	return err
}
