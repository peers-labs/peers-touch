package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/network"
	"github.com/cloudwego/hertz/pkg/protocol"
	"github.com/cloudwego/hertz/pkg/protocol/http1/resp"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type EventStreamHandlers struct {
	eventStreamService *service.EventStreamService
}

func NewEventStreamHandlers(eventStreamService *service.EventStreamService) *EventStreamHandlers {
	return &EventStreamHandlers{eventStreamService: eventStreamService}
}

func newAgentSSEWriter(response *protocol.Response, writer network.Writer) network.ExtWriter {
	return resp.NewChunkedBodyWriter(response, writer)
}

func (h *EventStreamHandlers) HandleSubscribeHertz(ctx context.Context, c *app.RequestContext) {
	agentID := string(c.Query("agent_id"))
	taskID := string(c.Query("task_id"))
	afterEventSeq := parseInt64(string(c.Query("after_event_seq")))
	if agentID == "" {
		c.JSON(400, map[string]string{"error": "agent_id is required"})
		return
	}

	c.Response.Header.Set("Content-Type", "text/event-stream")
	c.Response.Header.Set("Cache-Control", "no-cache")
	c.Response.Header.Set("Connection", "keep-alive")
	c.Response.Header.Set("X-Accel-Buffering", "no")
	c.Response.Header.Set("Transfer-Encoding", "chunked")
	c.SetStatusCode(200)
	c.Response.HijackWriter(newAgentSSEWriter(&c.Response, c.GetWriter()))

	stream := h.eventStreamService.Subscribe(ctx, agentID)
	defer stream.Close()

	if _, err := c.Write([]byte("event: connected\ndata: {\"status\": \"connected\"}\n\n")); err != nil {
		return
	}
	if err := c.Flush(); err != nil {
		return
	}
	if !h.writeReplayHertz(ctx, c, agentID, taskID, afterEventSeq) {
		return
	}

	for {
		select {
		case event, ok := <-stream.Events():
			if !ok {
				return
			}
			data := service.SerializeEvent(event)
			if _, err := c.Write([]byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event.EventType, string(data)))); err != nil {
				return
			}
			if err := c.Flush(); err != nil {
				return
			}
		case <-ctx.Done():
			return
		case <-stream.Done():
			return
		}
	}
}

func (h *EventStreamHandlers) HandleSubscribe(ctx context.Context, req server.Request, resp server.Response) error {
	resp.SetHeader("Content-Type", "text/event-stream")
	resp.SetHeader("Cache-Control", "no-cache")
	resp.SetHeader("Connection", "keep-alive")
	resp.SetHeader("X-Accel-Buffering", "no")

	var input struct {
		AgentID       string `json:"agent_id"`
		TaskID        string `json:"task_id"`
		AfterEventSeq int64  `json:"after_event_seq"`
	}
	body := req.Body()
	if len(body) > 0 {
		if err := json.Unmarshal(body, &input); err != nil {
			_, _ = resp.Write([]byte("event: error\ndata: {\"error\": \"invalid request\"}\n\n"))
			return nil
		}
	} else {
		input.AgentID = queryValue(req.Path(), "agent_id")
		input.TaskID = queryValue(req.Path(), "task_id")
		input.AfterEventSeq = parseInt64(queryValue(req.Path(), "after_event_seq"))
	}

	if input.AgentID == "" {
		_, _ = resp.Write([]byte("event: error\ndata: {\"error\": \"agent_id is required\"}\n\n"))
		return nil
	}

	stream := h.eventStreamService.Subscribe(ctx, input.AgentID)
	defer stream.Close()

	_, _ = resp.Write([]byte("event: connected\ndata: {\"status\": \"connected\"}\n\n"))
	if !h.writeReplay(ctx, resp, input.AgentID, input.TaskID, input.AfterEventSeq) {
		return nil
	}

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

func (h *EventStreamHandlers) writeReplayHertz(ctx context.Context, c *app.RequestContext, agentID, taskID string, afterEventSeq int64) bool {
	replayEvents, err := h.eventStreamService.ReplayTaskEvents(ctx, subjectActorID(ctx), agentID, taskID, afterEventSeq)
	if err != nil {
		data, _ := json.Marshal(map[string]string{"error": err.Error()})
		_, _ = c.Write([]byte(fmt.Sprintf("event: error\ndata: %s\n\n", string(data))))
		_ = c.Flush()
		return false
	}
	for _, event := range replayEvents {
		data := service.SerializeEvent(event)
		if _, err := c.Write([]byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event.EventType, string(data)))); err != nil {
			return false
		}
		if err := c.Flush(); err != nil {
			return false
		}
	}
	return true
}

func (h *EventStreamHandlers) writeReplay(ctx context.Context, resp server.Response, agentID, taskID string, afterEventSeq int64) bool {
	replayEvents, err := h.eventStreamService.ReplayTaskEvents(ctx, subjectActorID(ctx), agentID, taskID, afterEventSeq)
	if err != nil {
		data, _ := json.Marshal(map[string]string{"error": err.Error()})
		_, _ = resp.Write([]byte(fmt.Sprintf("event: error\ndata: %s\n\n", string(data))))
		return false
	}
	for _, event := range replayEvents {
		data := service.SerializeEvent(event)
		if _, err := resp.Write([]byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event.EventType, string(data)))); err != nil {
			return false
		}
	}
	return true
}

func queryValue(path, key string) string {
	idx := strings.Index(path, "?")
	if idx == -1 {
		return ""
	}
	values, err := url.ParseQuery(path[idx+1:])
	if err != nil {
		return ""
	}
	return values.Get(key)
}

func parseInt64(value string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed < 0 {
		return 0
	}
	return parsed
}
