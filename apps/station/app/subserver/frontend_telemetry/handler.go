package frontend_telemetry

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type frontendTelemetryEvent struct {
	ID            string         `json:"id"`
	SchemaVersion int            `json:"schemaVersion"`
	TS            float64        `json:"ts"`
	Kind          string         `json:"kind"`
	Source        string         `json:"source"`
	Module        string         `json:"module"`
	Runtime       string         `json:"runtime"`
	ActorID       string         `json:"actorId,omitempty"`
	DeviceID      string         `json:"deviceId,omitempty"`
	SessionID     string         `json:"sessionId,omitempty"`
	Owner         string         `json:"owner,omitempty"`
	PageID        string         `json:"pageId,omitempty"`
	SectionID     string         `json:"sectionId,omitempty"`
	InteractionID string         `json:"interactionId,omitempty"`
	Phase         string         `json:"phase,omitempty"`
	Severity      string         `json:"severity,omitempty"`
	DurationMS    *float64       `json:"durationMs,omitempty"`
	Tags          map[string]any `json:"tags,omitempty"`
	Data          map[string]any `json:"data,omitempty"`
}

type ingestRequest struct {
	Events []frontendTelemetryEvent `json:"events"`
}

type ingestResponse struct {
	Accepted        int      `json:"accepted"`
	Rejected        int      `json:"rejected"`
	Failed          int      `json:"failed"`
	Uploaded        bool     `json:"uploaded"`
	RejectedReasons []string `json:"rejectedReasons,omitempty"`
}

type ingestResult struct {
	Accepted        int
	Rejected        int
	RejectedReasons []string
}

type queryRequest struct {
	InteractionID string  `json:"interactionId"`
	Runtime       string  `json:"runtime"`
	Module        string  `json:"module"`
	Kind          string  `json:"kind"`
	Since         float64 `json:"since"`
	Until         float64 `json:"until"`
	Limit         int     `json:"limit"`
}

type queryResponse struct {
	Events []frontendTelemetryEvent `json:"events"`
	Count  int                      `json:"count"`
}

type rollupQueryRequest struct {
	Runtime string `json:"runtime"`
	Module  string `json:"module"`
	Kind    string `json:"kind"`
	Limit   int    `json:"limit"`
}

type rollupResponse struct {
	Rollups []rollupDTO `json:"rollups"`
	Count   int         `json:"count"`
}

type rollupDTO struct {
	ActorID           string   `json:"actorId"`
	Runtime           string   `json:"runtime"`
	Module            string   `json:"module"`
	Kind              string   `json:"kind"`
	WindowStart       string   `json:"windowStart"`
	WindowMinutes     int      `json:"windowMinutes"`
	Count             int      `json:"count"`
	DurationCount     int      `json:"durationCount"`
	P50DurationMS     *float64 `json:"p50DurationMs,omitempty"`
	P95DurationMS     *float64 `json:"p95DurationMs,omitempty"`
	MaxDurationMS     *float64 `json:"maxDurationMs,omitempty"`
	LastObservedAt    string   `json:"lastObservedAt"`
	LastInteractionID string   `json:"lastInteractionId,omitempty"`
}

func (s *subServer) handleIngest(ctx context.Context, req *ingestRequest) (*ingestResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil || len(req.Events) == 0 {
		return nil, &server.HandlerError{Code: http.StatusBadRequest, Message: "events must not be empty"}
	}
	if len(req.Events) > 500 {
		return nil, &server.HandlerError{Code: http.StatusBadRequest, Message: "events batch exceeds 500"}
	}
	result, err := s.store.PersistBatch(ctx, subject.ID, subject.SessionID, req.Events)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to persist frontend telemetry", err)
	}
	return &ingestResponse{
		Accepted:        result.Accepted,
		Rejected:        result.Rejected,
		Failed:          0,
		Uploaded:        result.Accepted > 0,
		RejectedReasons: result.RejectedReasons,
	}, nil
}

func (s *subServer) handleQuery(ctx context.Context, req *queryRequest) (*queryResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil {
		req = &queryRequest{}
	}
	rows, err := s.store.Query(ctx, subject.ID, *req)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to query frontend telemetry", err)
	}
	events := make([]frontendTelemetryEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, row.toDTO())
	}
	return &queryResponse{Events: events, Count: len(events)}, nil
}

func (s *subServer) handleRollupQuery(ctx context.Context, req *rollupQueryRequest) (*rollupResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil {
		req = &rollupQueryRequest{}
	}
	rows, err := s.store.QueryRollups(ctx, subject.ID, *req)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to query frontend telemetry rollups", err)
	}
	rollups := make([]rollupDTO, 0, len(rows))
	for _, row := range rows {
		rollups = append(rollups, row.toDTO())
	}
	return &rollupResponse{Rollups: rollups, Count: len(rollups)}, nil
}

func (event frontendTelemetryEvent) toRawEventModel(actorID, sessionID string, receivedAt time.Time) (rawEventModel, string) {
	if strings.TrimSpace(event.ID) == "" {
		return rawEventModel{}, "id is required"
	}
	if event.SchemaVersion <= 0 {
		return rawEventModel{}, fmt.Sprintf("event %s schemaVersion is required", event.ID)
	}
	if strings.TrimSpace(event.Kind) == "" {
		return rawEventModel{}, fmt.Sprintf("event %s kind is required", event.ID)
	}
	if strings.TrimSpace(event.Source) == "" {
		return rawEventModel{}, fmt.Sprintf("event %s source is required", event.ID)
	}
	if strings.TrimSpace(event.Module) == "" {
		return rawEventModel{}, fmt.Sprintf("event %s module is required", event.ID)
	}
	if strings.TrimSpace(event.Runtime) == "" {
		return rawEventModel{}, fmt.Sprintf("event %s runtime is required", event.ID)
	}
	ts := event.TS
	if ts <= 0 {
		ts = float64(receivedAt.UnixMilli())
	}
	return rawEventModel{
		ActorID:       actorID,
		EventID:       event.ID,
		SchemaVersion: event.SchemaVersion,
		TS:            ts,
		Kind:          strings.TrimSpace(event.Kind),
		Source:        strings.TrimSpace(event.Source),
		Module:        strings.TrimSpace(event.Module),
		Runtime:       strings.TrimSpace(event.Runtime),
		DeviceID:      strings.TrimSpace(event.DeviceID),
		SessionID:     firstNonEmpty(strings.TrimSpace(event.SessionID), sessionID),
		Owner:         strings.TrimSpace(event.Owner),
		PageID:        strings.TrimSpace(event.PageID),
		SectionID:     strings.TrimSpace(event.SectionID),
		InteractionID: strings.TrimSpace(event.InteractionID),
		Phase:         strings.TrimSpace(event.Phase),
		Severity:      strings.TrimSpace(event.Severity),
		DurationMS:    event.DurationMS,
		TagsJSON:      jsonString(event.Tags),
		DataJSON:      jsonString(event.Data),
		CreatedAt:     time.UnixMilli(int64(ts)).UTC(),
		ReceivedAt:    receivedAt,
	}, ""
}

func (row rawEventModel) toDTO() frontendTelemetryEvent {
	return frontendTelemetryEvent{
		ID:            row.EventID,
		SchemaVersion: row.SchemaVersion,
		TS:            row.TS,
		Kind:          row.Kind,
		Source:        row.Source,
		Module:        row.Module,
		Runtime:       row.Runtime,
		ActorID:       row.ActorID,
		DeviceID:      row.DeviceID,
		SessionID:     row.SessionID,
		Owner:         row.Owner,
		PageID:        row.PageID,
		SectionID:     row.SectionID,
		InteractionID: row.InteractionID,
		Phase:         row.Phase,
		Severity:      row.Severity,
		DurationMS:    row.DurationMS,
	}
}

func (row rollupModel) toDTO() rollupDTO {
	return rollupDTO{
		ActorID:           row.ActorID,
		Runtime:           row.Runtime,
		Module:            row.Module,
		Kind:              row.Kind,
		WindowStart:       row.WindowStart.UTC().Format(time.RFC3339Nano),
		WindowMinutes:     row.WindowMinutes,
		Count:             row.Count,
		DurationCount:     row.DurationCount,
		P50DurationMS:     row.P50DurationMS,
		P95DurationMS:     row.P95DurationMS,
		MaxDurationMS:     row.MaxDurationMS,
		LastObservedAt:    row.LastObservedAt.UTC().Format(time.RFC3339Nano),
		LastInteractionID: row.LastInteraction,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
