package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// Remote transports use the SDK's initialization, session IDs, event framing,
// pagination, cancellation, and close semantics. Station owns configuration.
func callHTTPMcp(
	ctx context.Context,
	config mcpRuntimeConfig,
	sse bool,
	method string,
	params interface{},
) (response map[string]interface{}, resultErr error) {
	origin, err := url.Parse(config.URL)
	if err != nil {
		return nil, fmt.Errorf("parse MCP endpoint: %w", err)
	}
	httpClient := &http.Client{
		Timeout: mcpRuntimeTimeout,
		Transport: &mcpHTTPTransport{
			base: http.DefaultTransport, origin: origin, headers: config.Headers,
		},
	}
	var transport mcp.Transport
	if sse {
		transport = &mcp.SSEClientTransport{Endpoint: config.URL, HTTPClient: httpClient}
	} else {
		transport = &mcp.StreamableClientTransport{
			Endpoint: config.URL, HTTPClient: httpClient,
			DisableStandaloneSSE: true, MaxRetries: -1,
		}
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "peers-touch-station", Version: "1"}, nil)
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, fmt.Errorf("connect remote MCP server: %w", err)
	}
	defer func() {
		if err := session.Close(); err != nil && resultErr == nil {
			resultErr = fmt.Errorf("close remote MCP session: %w", err)
		}
	}()

	var result interface{}
	switch method {
	case "tools/list":
		tools := make([]*mcp.Tool, 0)
		for tool, err := range session.Tools(ctx, nil) {
			if err != nil {
				return nil, fmt.Errorf("list remote MCP tools: %w", err)
			}
			tools = append(tools, tool)
		}
		result = &mcp.ListToolsResult{Tools: tools}
	case "tools/call":
		input, ok := params.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("MCP tool parameters must be an object")
		}
		name, _ := input["name"].(string)
		result, err = session.CallTool(ctx, &mcp.CallToolParams{
			Name: name, Arguments: input["arguments"],
		})
		if err != nil {
			return nil, fmt.Errorf("call remote MCP tool: %w", err)
		}
	default:
		return nil, fmt.Errorf("unsupported MCP method %q", method)
	}
	body, err := json.Marshal(map[string]interface{}{"result": result})
	if err != nil {
		return nil, fmt.Errorf("encode remote MCP result: %w", err)
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode remote MCP result: %w", err)
	}
	return response, nil
}

type mcpHTTPTransport struct {
	base    http.RoundTripper
	origin  *url.URL
	headers map[string]string
}

func (t *mcpHTTPTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := validateMcpRuntimeConfig(mcpRuntimeConfig{
		Transport: model.McpTransport_MCP_TRANSPORT_HTTP, URL: request.URL.String(),
	}); err != nil {
		return nil, err
	}
	cloned := request.Clone(request.Context())
	// A server-advertised SSE endpoint or redirect cannot acquire credentials
	// configured for a different origin.
	if cloned.URL.Scheme == t.origin.Scheme && cloned.URL.Host == t.origin.Host {
		for name, value := range t.headers {
			cloned.Header.Set(name, value)
		}
	} else {
		for name := range t.headers {
			cloned.Header.Del(name)
		}
	}
	response, err := t.base.RoundTrip(cloned)
	if err != nil {
		return nil, err
	}
	response.Body = http.MaxBytesReader(nil, response.Body, mcpMaxFrameBytes)
	return response, nil
}
