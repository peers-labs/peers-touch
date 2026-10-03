package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"
	"unicode"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

const (
	mcpProtocolVersion     = "2024-11-05"
	mcpRuntimeTimeout      = 8 * time.Second
	mcpMaxFrameBytes       = 8 * 1024 * 1024
	mcpReservedEnvPrefix   = "PEERS_TOUCH_"
	mcpHTTPResponseMaxSize = 8 * 1024 * 1024
)

type mcpRuntimeConfig struct {
	Transport model.McpTransport
	Command   string
	Args      []string
	Env       map[string]string
	URL       string
	Headers   map[string]string
}

type discoveredMcpTool struct {
	Name        string
	Description string
	InputSchema json.RawMessage
}

func probeMcpRuntime(
	ctx context.Context,
	config mcpRuntimeConfig,
) ([]discoveredMcpTool, error) {
	if err := validateMcpRuntimeConfig(config); err != nil {
		return nil, err
	}
	response, err := callMcpRuntime(ctx, config, "tools/list", map[string]interface{}{})
	if err != nil {
		return nil, err
	}
	return extractMcpTools(response)
}

func executeMcpRuntimeTool(
	ctx context.Context,
	config mcpRuntimeConfig,
	toolName string,
	arguments json.RawMessage,
) (string, error) {
	if err := validateMcpRuntimeConfig(config); err != nil {
		return "", err
	}
	var decoded interface{} = map[string]interface{}{}
	if len(bytes.TrimSpace(arguments)) > 0 {
		if err := json.Unmarshal(arguments, &decoded); err != nil {
			return "", fmt.Errorf("decode MCP tool arguments: %w", err)
		}
	}
	response, err := callMcpRuntime(ctx, config, "tools/call", map[string]interface{}{
		"name":      strings.TrimSpace(toolName),
		"arguments": decoded,
	})
	if err != nil {
		return "", err
	}
	result, ok := response["result"]
	if !ok {
		return "", fmt.Errorf("MCP tools/call response did not include result")
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("encode MCP tool result: %w", err)
	}
	return string(encoded), nil
}

func callMcpRuntime(
	ctx context.Context,
	config mcpRuntimeConfig,
	method string,
	params interface{},
) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, mcpRuntimeTimeout)
	defer cancel()
	switch config.Transport {
	case model.McpTransport_MCP_TRANSPORT_STDIO:
		return callStdioMcp(ctx, config, method, params)
	case model.McpTransport_MCP_TRANSPORT_HTTP:
		return callHTTPMcp(ctx, config, false, method, params)
	case model.McpTransport_MCP_TRANSPORT_SSE:
		return callHTTPMcp(ctx, config, true, method, params)
	default:
		return nil, fmt.Errorf("unsupported MCP transport")
	}
}

func callStdioMcp(
	ctx context.Context,
	config mcpRuntimeConfig,
	method string,
	params interface{},
) (map[string]interface{}, error) {
	command := exec.CommandContext(ctx, config.Command, config.Args...)
	command.Env = []string{"PATH=" + os.Getenv("PATH")}
	for key, value := range config.Env {
		command.Env = append(command.Env, key+"="+value)
	}
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("open MCP stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("open MCP stdout: %w", err)
	}
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("start stdio MCP server: %w", err)
	}
	defer func() {
		_ = command.Process.Kill()
		_ = command.Wait()
	}()

	reader := bufio.NewReader(stdout)
	if err := writeMcpFrame(stdin, mcpRequest(1, "initialize", map[string]interface{}{
		"protocolVersion": mcpProtocolVersion,
		"capabilities":    map[string]interface{}{},
		"clientInfo": map[string]string{
			"name":    "peers-touch-station",
			"version": "1",
		},
	})); err != nil {
		return nil, err
	}
	if _, err := readMcpFrame(reader, 1); err != nil {
		return nil, fmt.Errorf("initialize stdio MCP server: %w", err)
	}
	if err := writeMcpFrame(stdin, map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
		"params":  map[string]interface{}{},
	}); err != nil {
		return nil, err
	}
	if err := writeMcpFrame(stdin, mcpRequest(2, method, params)); err != nil {
		return nil, err
	}
	return readMcpFrame(reader, 2)
}

func writeMcpFrame(writer io.Writer, payload interface{}) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode MCP request: %w", err)
	}
	if len(encoded) > mcpMaxFrameBytes {
		return fmt.Errorf("MCP request exceeds %d bytes", mcpMaxFrameBytes)
	}
	encoded = append(encoded, '\n')
	if _, err := writer.Write(encoded); err != nil {
		return fmt.Errorf("write MCP message: %w", err)
	}
	return nil
}

func readMcpFrame(reader *bufio.Reader, expectedID int64) (map[string]interface{}, error) {
	for {
		body, err := reader.ReadBytes('\n')
		if err != nil {
			return nil, fmt.Errorf("read MCP message: %w", err)
		}
		body = bytes.TrimSpace(body)
		if len(body) == 0 {
			continue
		}
		if len(body) > mcpMaxFrameBytes {
			return nil, fmt.Errorf("MCP message exceeds %d bytes", mcpMaxFrameBytes)
		}
		var response map[string]interface{}
		if err := json.Unmarshal(body, &response); err != nil {
			return nil, fmt.Errorf("decode MCP response: %w", err)
		}
		if id, ok := response["id"].(float64); ok && int64(id) == expectedID {
			if remoteError, exists := response["error"]; exists {
				return nil, fmt.Errorf("MCP server returned error: %v", remoteError)
			}
			return response, nil
		}
	}
}

func callHTTPMcp(
	ctx context.Context,
	config mcpRuntimeConfig,
	sse bool,
	method string,
	params interface{},
) (map[string]interface{}, error) {
	client := &http.Client{Timeout: mcpRuntimeTimeout}
	if _, err := postMcpJSON(ctx, client, config, sse, mcpRequest(
		1,
		"initialize",
		map[string]interface{}{
			"protocolVersion": mcpProtocolVersion,
			"capabilities":    map[string]interface{}{},
			"clientInfo": map[string]string{
				"name":    "peers-touch-station",
				"version": "1",
			},
		},
	)); err != nil {
		return nil, fmt.Errorf("initialize HTTP MCP server: %w", err)
	}
	_, _ = postMcpJSON(ctx, client, config, sse, map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
		"params":  map[string]interface{}{},
	})
	return postMcpJSON(ctx, client, config, sse, mcpRequest(2, method, params))
}

func postMcpJSON(
	ctx context.Context,
	client *http.Client,
	config mcpRuntimeConfig,
	sse bool,
	payload interface{},
) (map[string]interface{}, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode MCP HTTP request: %w", err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		config.URL,
		bytes.NewReader(encoded),
	)
	if err != nil {
		return nil, fmt.Errorf("create MCP HTTP request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if sse {
		request.Header.Set("Accept", "text/event-stream")
	}
	for key, value := range config.Headers {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("MCP HTTP request failed: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, mcpHTTPResponseMaxSize+1))
	if err != nil {
		return nil, fmt.Errorf("read MCP HTTP response: %w", err)
	}
	if len(body) > mcpHTTPResponseMaxSize {
		return nil, fmt.Errorf("MCP HTTP response exceeds %d bytes", mcpHTTPResponseMaxSize)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("MCP HTTP request failed with status %d", response.StatusCode)
	}
	if sse {
		body = extractMcpSSEData(body)
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, fmt.Errorf("decode MCP HTTP response: %w", err)
	}
	if remoteError, exists := decoded["error"]; exists {
		return nil, fmt.Errorf("MCP server returned error: %v", remoteError)
	}
	return decoded, nil
}

func extractMcpSSEData(body []byte) []byte {
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			return []byte(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	return body
}

func mcpRequest(id int64, method string, params interface{}) map[string]interface{} {
	return map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}
}

func extractMcpTools(response map[string]interface{}) ([]discoveredMcpTool, error) {
	result, ok := response["result"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("MCP tools/list response did not include result")
	}
	values, ok := result["tools"].([]interface{})
	if !ok {
		return nil, fmt.Errorf("MCP tools/list response did not include result.tools")
	}
	tools := make([]discoveredMcpTool, 0, len(values))
	for _, value := range values {
		item, ok := value.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := item["name"].(string)
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		description, _ := item["description"].(string)
		schema := json.RawMessage(`{"type":"object","properties":{}}`)
		if candidate, exists := item["inputSchema"]; exists {
			if encoded, err := json.Marshal(candidate); err == nil && json.Valid(encoded) {
				schema = encoded
			}
		}
		tools = append(tools, discoveredMcpTool{
			Name:        name,
			Description: strings.TrimSpace(description),
			InputSchema: schema,
		})
	}
	return tools, nil
}

func validateMcpRuntimeConfig(config mcpRuntimeConfig) error {
	switch config.Transport {
	case model.McpTransport_MCP_TRANSPORT_STDIO:
		command := strings.TrimSpace(config.Command)
		if command == "" {
			return fmt.Errorf("stdio MCP command is required")
		}
		for _, value := range append([]string{command}, config.Args...) {
			if hasMcpControlCharacter(value) {
				return fmt.Errorf("stdio MCP command and arguments must not contain control characters")
			}
		}
		if strings.ContainsAny(command, "|;&`$><\n\r") {
			return fmt.Errorf("stdio MCP command must not execute through a shell")
		}
		for key, value := range config.Env {
			if strings.TrimSpace(key) == "" || strings.Contains(key, "=") ||
				hasMcpControlCharacter(key) || hasMcpControlCharacter(value) {
				return fmt.Errorf("stdio MCP environment is invalid")
			}
			if strings.HasPrefix(strings.ToUpper(key), mcpReservedEnvPrefix) {
				return fmt.Errorf("stdio MCP environment cannot override reserved variables")
			}
		}
		return nil
	case model.McpTransport_MCP_TRANSPORT_HTTP,
		model.McpTransport_MCP_TRANSPORT_SSE:
		parsed, err := url.Parse(strings.TrimSpace(config.URL))
		if err != nil || parsed.Hostname() == "" || parsed.User != nil {
			return fmt.Errorf("MCP URL is invalid")
		}
		if parsed.Scheme != "https" &&
			!(parsed.Scheme == "http" && isMcpLoopbackHost(parsed.Hostname())) {
			return fmt.Errorf("MCP URL must use https or loopback http")
		}
		if address := net.ParseIP(parsed.Hostname()); address != nil &&
			!address.IsLoopback() &&
			(address.IsPrivate() || address.IsLinkLocalUnicast() ||
				address.IsLinkLocalMulticast() || address.IsUnspecified()) {
			return fmt.Errorf("MCP URL cannot target a private or metadata address")
		}
		for key, value := range config.Headers {
			if strings.TrimSpace(key) == "" ||
				hasMcpControlCharacter(key) || hasMcpControlCharacter(value) {
				return fmt.Errorf("MCP headers are invalid")
			}
		}
		return nil
	default:
		return fmt.Errorf("MCP transport must be stdio, HTTP, or SSE")
	}
}

func hasMcpControlCharacter(value string) bool {
	return strings.IndexFunc(value, func(character rune) bool {
		return unicode.IsControl(character)
	}) >= 0
}

func isMcpLoopbackHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "localhost" {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}
