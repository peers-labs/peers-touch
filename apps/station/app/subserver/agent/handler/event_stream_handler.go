package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type EventStreamHandlers struct {
	eventStreamService *service.EventStreamService
}

func NewEventStreamHandlers(eventStreamService *service.EventStreamService) *EventStreamHandlers {
	return &EventStreamHandlers{eventStreamService: eventStreamService}
}

func (h *EventStreamHandlers) HandleSubscribe(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "text/event-stream")
	resp.SetHeader("Cache-Control", "no-cache")
	resp.SetHeader("Connection", "keep-alive")
	resp.SetHeader("X-Accel-Buffering", "no")

	var input struct {
		AgentID string `json:"agent_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		_, _ = resp.Write([]byte("event: error\ndata: {\"error\": \"invalid request\"}\n\n"))
		return nil
	}

	if input.AgentID == "" {
		_, _ = resp.Write([]byte("event: error\ndata: {\"error\": \"agent_id is required\"}\n\n"))
		return nil
	}

	stream := h.eventStreamService.Subscribe(ctx, input.AgentID)
	defer stream.Close()

	_, _ = resp.Write([]byte("event: connected\ndata: {\"status\": \"connected\"}\n\n"))

	for {
		select {
		case event, ok := <-stream.Events():
			if !ok {
				return nil
			}
			data := service.SerializeEvent(event)
			_, _ = resp.Write([]byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event.EventType, string(data))))
		case <-ctx.Done():
			return nil
		case <-stream.Done():
			return nil
		}
	}
}
