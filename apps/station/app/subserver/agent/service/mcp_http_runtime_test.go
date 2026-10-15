package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestMCPHTTPNegotiatesSSEAndClosesSession(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "transport-fixture", Version: "1"}, nil)
	server.AddTool(&mcp.Tool{
		Name: "echo", Description: "Echo a supplied value",
		InputSchema: map[string]interface{}{"type": "object",
			"properties": map[string]interface{}{"value": map[string]string{"type": "string"}}},
	}, func(_ context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var input struct {
			Value string `json:"value"`
		}
		if err := json.Unmarshal(request.Params.Arguments, &input); err != nil {
			return nil, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: input.Value}}}, nil
	})
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	var closed atomic.Int32
	var sessionRequests atomic.Int32
	endpoint := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPost && (!strings.Contains(request.Header.Get("Accept"), "application/json") ||
			!strings.Contains(request.Header.Get("Accept"), "text/event-stream")) {
			writer.WriteHeader(http.StatusNotAcceptable)
			return
		}
		if request.Header.Get("Authorization") != "Bearer fixture-canary" {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if request.Header.Get("Mcp-Session-Id") != "" {
			sessionRequests.Add(1)
		}
		if request.Method == http.MethodDelete {
			closed.Add(1)
		}
		handler.ServeHTTP(writer, request)
	}))
	defer endpoint.Close()
	config := mcpRuntimeConfig{
		Transport: model.McpTransport_MCP_TRANSPORT_HTTP, URL: endpoint.URL,
		Headers: map[string]string{"Authorization": "Bearer fixture-canary"},
	}
	tools, err := probeMcpRuntime(context.Background(), config)
	if err != nil {
		t.Fatalf("probe real HTTP/SSE protocol: %v", err)
	}
	if len(tools) != 1 || tools[0].Name != "echo" {
		t.Fatalf("discovered tools = %+v, want echo", tools)
	}
	result, err := executeMcpRuntimeTool(context.Background(), config, "echo", json.RawMessage(`{"value":"receiver-visible"}`))
	if err != nil || !strings.Contains(result, "receiver-visible") {
		t.Fatalf("HTTP tool result = %s, error = %v", result, err)
	}
	if closed.Load() != 2 || sessionRequests.Load() < 4 {
		t.Fatalf("session-bound requests = %d, closed sessions = %d", sessionRequests.Load(), closed.Load())
	}
}

func TestMCPLegacySSEUsesAdvertisedPostEndpoint(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "legacy-fixture", Version: "1"}, nil)
	server.AddTool(&mcp.Tool{
		Name: "inspect", InputSchema: map[string]string{"type": "object"},
	}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "legacy"}}}, nil
	})
	handler := mcp.NewSSEHandler(func(*http.Request) *mcp.Server { return server }, nil)
	endpoint := httptest.NewServer(handler)
	defer endpoint.Close()
	tools, err := probeMcpRuntime(context.Background(), mcpRuntimeConfig{
		Transport: model.McpTransport_MCP_TRANSPORT_SSE, URL: endpoint.URL,
	})
	if err != nil || len(tools) != 1 || tools[0].Name != "inspect" {
		t.Fatalf("legacy SSE discovery = %+v, error = %v", tools, err)
	}
}
