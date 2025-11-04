package types

import (
	"encoding/json"
	"fmt"
)

// MCP Protocol Types based on Model Context Protocol specification

// InitializeRequest represents the initialization request
type InitializeRequest struct {
	ProtocolVersion string                 `json:"protocolVersion"`
	Capabilities    ClientCapabilities     `json:"capabilities"`
	ClientInfo      Implementation         `json:"clientInfo"`
}

// InitializeResponse represents the initialization response
type InitializeResponse struct {
	ProtocolVersion string                 `json:"protocolVersion"`
	Capabilities    ServerCapabilities     `json:"capabilities"`
	ServerInfo      Implementation         `json:"serverInfo"`
}

// ClientCapabilities represents client capabilities
type ClientCapabilities struct {
	Experimental map[string]interface{} `json:"experimental,omitempty"`
	Sampling     map[string]interface{} `json:"sampling,omitempty"`
	Roots        *RootsCapability       `json:"roots,omitempty"`
}

// ServerCapabilities represents server capabilities
type ServerCapabilities struct {
	Experimental     map[string]interface{} `json:"experimental,omitempty"`
	Logging          map[string]interface{} `json:"logging,omitempty"`
	Prompts          *PromptsCapability     `json:"prompts,omitempty"`
	Resources        *ResourcesCapability   `json:"resources,omitempty"`
	Tools            *ToolsCapability       `json:"tools,omitempty"`
}

// RootsCapability represents roots capability
type RootsCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

// PromptsCapability represents prompts capability
type PromptsCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

// ResourcesCapability represents resources capability
type ResourcesCapability struct {
	Subscribe   bool `json:"subscribe,omitempty"`
	ListChanged bool `json:"listChanged,omitempty"`
}

// ToolsCapability represents tools capability
type ToolsCapability struct {
	ListChanged bool `json:"listChanged,omitempty"`
}

// Implementation represents implementation information
type Implementation struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Tool represents an MCP tool
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema json.RawMessage        `json:"inputSchema"`
}

// ToolCall represents a tool call request
type ToolCall struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// ToolResult represents a tool call result
type ToolResult struct {
	Content []ContentItem `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

// ContentItem represents a content item
type ContentItem struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// Prompt represents an MCP prompt
type Prompt struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Arguments   []PromptArgument `json:"arguments,omitempty"`
}

// PromptArgument represents a prompt argument
type PromptArgument struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

// PromptMessage represents a prompt message
type PromptMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ListToolsRequest represents a list tools request
type ListToolsRequest struct {
	MetaRequest
}

// ListToolsResponse represents a list tools response
type ListToolsResponse struct {
	MetaResponse
	Tools []Tool `json:"tools"`
}

// CallToolRequest represents a call tool request
type CallToolRequest struct {
	MetaRequest
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// CallToolResponse represents a call tool response
type CallToolResponse struct {
	MetaResponse
	Content []ContentItem `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

// ListPromptsRequest represents a list prompts request
type ListPromptsRequest struct {
	MetaRequest
}

// ListPromptsResponse represents a list prompts response
type ListPromptsResponse struct {
	MetaResponse
	Prompts []Prompt `json:"prompts"`
}

// GetPromptRequest represents a get prompt request
type GetPromptRequest struct {
	MetaRequest
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

// GetPromptResponse represents a get prompt response
type GetPromptResponse struct {
	MetaResponse
	Description string          `json:"description"`
	Messages    []PromptMessage `json:"messages"`
}

// MetaRequest represents metadata for requests
type MetaRequest struct {
	Meta map[string]interface{} `json:"_meta,omitempty"`
}

// MetaResponse represents metadata for responses
type MetaResponse struct {
	Meta map[string]interface{} `json:"_meta,omitempty"`
}

// Error represents an MCP error
type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Error codes
const (
	ErrorCodeParseError          = -32700
	ErrorCodeInvalidRequest      = -32600
	ErrorCodeMethodNotFound      = -32601
	ErrorCodeInvalidParams       = -32602
	ErrorCodeInternalError       = -32603
	ErrorCodeInvalidRequestID    = -32604
	ErrorCodeUnknownError        = -32000
	ErrorCodeResourceNotFound    = -32001
	ErrorCodeResourceAlreadyExists = -32002
)

// NewError creates a new error
func NewError(code int, message string, data interface{}) *Error {
	return &Error{
		Code:    code,
		Message: message,
		Data:    data,
	}
}

func (e *Error) Error() string {
	return fmt.Sprintf("MCP Error %d: %s", e.Code, e.Message)
}