// Package pluginrpc defines the stdio JSON-RPC contract between the Station
// channel host and external channel plugin processes.
//
// Wire format: newline-delimited JSON-RPC 2.0 frames on stdin/stdout.
//
// Protocol 1 (fp-01) carried lifecycle methods only (initialize/health/
// shutdown). Protocol 2 adds bidirectional calls: the host starts/stops
// bindings and asks for outbound delivery, while plugins report inbound
// events, connection status and request credentials.
//
// Direction is encoded by the JSON-RPC shape, not the id: a frame with a
// "method" field is a request originating on the other side; a frame without
// one is the response to one of this side's pending calls. This keeps the two
// peers' independent id spaces unambiguous.
package pluginrpc

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// ProtocolMin/Max name the contract range this host speaks.
const (
	ProtocolMin = 1
	ProtocolMax = 3
)

// MaxFrameBytes bounds a single NDJSON frame on both sides.
const MaxFrameBytes = 4 * 1024 * 1024

// Host -> plugin methods.
const (
	MethodInitialize     = "initialize"
	MethodHealth         = "health"
	MethodShutdown       = "shutdown"
	MethodBindingStart   = "bindingStart"
	MethodBindingStop    = "bindingStop"
	MethodDeliver        = "deliver"
	MethodResourceFetch  = "resourceFetch"
	MethodResourceUpload = "resourceUpload"
	MethodAutomationSync = "automationSync"
	MethodTestEmitEvent  = "test.emitEvent" // testdata hook only, never shipped by production plugins
)

// Plugin -> host methods.
const (
	MethodInboundEvent     = "inboundEvent"
	MethodConnectionStatus = "connectionStatus"
	MethodGetCredential    = "getCredential"
	MethodCardAction       = "cardAction"
)

// JSON-RPC error codes. Standard values follow the JSON-RPC 2.0 specification;
// channel-specific failures use the -32000..-32099 implementation range.
const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	// CodeRetryableDelivery is returned by a plugin for a transient platform
	// failure. The host may retry with the same idempotency key.
	CodeRetryableDelivery = -32001
	// CodePermanentDelivery is a non-retryable platform rejection.
	CodePermanentDelivery = -32002
	// CodeUnauthorized reports rejected/missing platform credentials.
	CodeUnauthorized = -32003
)

// Request is a JSON-RPC call frame (either direction).
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Response is a JSON-RPC result/error frame (either direction). Responses
// never carry Method so the reader can distinguish them from new requests.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError follows the JSON-RPC error shape.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string { return "rpc error " + strconv.Itoa(e.Code) + ": " + e.Message }

// InitializeParams are sent on first handshake.
type InitializeParams struct {
	ProtocolMin int    `json:"protocol_min"`
	ProtocolMax int    `json:"protocol_max"`
	HostName    string `json:"host_name"`
}

// InitializeResult is the plugin capability declaration.
type InitializeResult struct {
	Protocol     int      `json:"protocol"`
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	Provider     string   `json:"provider"`
	Capabilities []string `json:"capabilities,omitempty"`
}

// HealthResult reports liveness from the plugin.
type HealthResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

// NewRequest encodes a call.
func NewRequest(id int64, method string, params any) ([]byte, error) {
	var raw json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	return json.Marshal(Request{JSONRPC: "2.0", ID: id, Method: method, Params: raw})
}

// NewResponse encodes a result frame for the given request id.
func NewResponse(id int64, result any) ([]byte, error) {
	var raw json.RawMessage
	if result != nil {
		b, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	return json.Marshal(Response{JSONRPC: "2.0", ID: id, Result: raw})
}

// NewErrorResponse encodes an error frame for the given request id.
func NewErrorResponse(id int64, code int, message string) ([]byte, error) {
	return json.Marshal(Response{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: message},
	})
}

// DecodeFrame parses one NDJSON line into either a request or a response.
// Exactly one of the returned pointers is non-nil.
func DecodeFrame(line []byte) (*Request, *Response, error) {
	var probe struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      int64           `json:"id"`
		Method  *string         `json:"method"`
		Result  json.RawMessage `json:"result,omitempty"`
		Error   *RPCError       `json:"error,omitempty"`
	}
	if err := json.Unmarshal(line, &probe); err != nil {
		return nil, nil, fmt.Errorf("decode rpc frame: %w", err)
	}
	if probe.JSONRPC != "2.0" {
		return nil, nil, fmt.Errorf("unexpected jsonrpc version %q", probe.JSONRPC)
	}
	if probe.Method != nil {
		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			return nil, nil, fmt.Errorf("decode rpc request: %w", err)
		}
		return &req, nil, nil
	}
	var resp Response
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, nil, fmt.Errorf("decode rpc response: %w", err)
	}
	return nil, &resp, nil
}

// DecodeResponse parses one response frame.
func DecodeResponse(line []byte) (Response, error) {
	_, resp, err := DecodeFrame(line)
	if err != nil {
		return Response{}, err
	}
	if resp == nil {
		return Response{}, fmt.Errorf("frame is a request, not a response")
	}
	return *resp, nil
}

// EncodeResult builds a success frame (used by plugins/test echo).
func EncodeResult(id int64, result any) ([]byte, error) {
	return NewResponse(id, result)
}
