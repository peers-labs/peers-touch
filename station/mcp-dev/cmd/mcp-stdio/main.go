package main

import (
    "bufio"
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "log"
    "os"
    "strconv"
    "strings"

    "github.com/peers-touch/peers-touch/station/mcp-dev/internal/service"
    "github.com/peers-touch/peers-touch/station/mcp-dev/internal/storage"
    "github.com/peers-touch/peers-touch/station/mcp-dev/internal/types"
)

// JSON-RPC 2.0 envelopes
type rpcRequest struct {
    JSONRPC string          `json:"jsonrpc"`
    Method  string          `json:"method"`
    Params  json.RawMessage `json:"params"`
    ID      interface{}     `json:"id"`
}

type rpcResponse struct {
    JSONRPC string      `json:"jsonrpc"`
    Result  interface{} `json:"result,omitempty"`
    Error   *rpcError   `json:"error,omitempty"`
    ID      interface{} `json:"id"`
}

type rpcError struct {
    Code    int    `json:"code"`
    Message string `json:"message"`
}

// Content-length framed reader/writer (LSP-style)
func readMessage(r *bufio.Reader) ([]byte, error) {
    // Read headers until blank line
    var contentLength int
    for {
        line, err := r.ReadString('\n')
        if err != nil {
            return nil, err
        }
        line = strings.TrimRight(line, "\r\n")
        if line == "" { // header end
            break
        }
        if strings.HasPrefix(strings.ToLower(line), "content-length:") {
            parts := strings.SplitN(line, ":", 2)
            if len(parts) == 2 {
                v := strings.TrimSpace(parts[1])
                n, err := strconv.Atoi(v)
                if err != nil {
                    return nil, fmt.Errorf("invalid content-length: %w", err)
                }
                contentLength = n
            }
        }
    }
    if contentLength <= 0 {
        return nil, fmt.Errorf("missing content-length")
    }
    buf := make([]byte, contentLength)
    if _, err := io.ReadFull(r, buf); err != nil {
        return nil, err
    }
    return buf, nil
}

func writeMessage(w *bufio.Writer, payload []byte) error {
    header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(payload))
    if _, err := w.WriteString(header); err != nil {
        return err
    }
    if _, err := w.Write(payload); err != nil {
        return err
    }
    return w.Flush()
}

func main() {
    // All logs to stderr so stdout stays clean for JSON-RPC
    log.SetOutput(os.Stderr)

    // Init storage and services (same as HTTP server)
    store, err := storage.NewSQLiteStorage("mcp-dev.db")
    if err != nil {
        log.Fatalf("failed to init storage: %v", err)
    }
    defer store.Close()

    db := store.GetDB()
    ctxService := service.NewContextService(db)
    templateService := service.NewTemplateService(db)
    ruleService := service.NewRuleService(db)
    mcp := service.NewMCPService(ctxService, templateService, ruleService)

    in := bufio.NewReader(os.Stdin)
    out := bufio.NewWriter(os.Stdout)

    for {
        msg, err := readMessage(in)
        if err != nil {
            if err == io.EOF {
                return
            }
            log.Printf("read error: %v", err)
            return
        }
        // Parse request
        var req rpcRequest
        if err := json.Unmarshal(msg, &req); err != nil {
            log.Printf("unmarshal request error: %v", err)
            // Try send error
            resp := rpcResponse{JSONRPC: "2.0", ID: nil, Error: &rpcError{Code: -32700, Message: "Parse error"}}
            b, _ := json.Marshal(resp)
            _ = writeMessage(out, b)
            continue
        }

        // Handle
        res, rpcErr := handleRPC(context.Background(), mcp, &req)
        resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
        if rpcErr != nil {
            resp.Error = rpcErr
        } else {
            resp.Result = res
        }
        payload, _ := json.Marshal(resp)
        if err := writeMessage(out, payload); err != nil {
            log.Printf("write error: %v", err)
            return
        }
    }
}

func handleRPC(ctx context.Context, mcp service.MCPService, req *rpcRequest) (interface{}, *rpcError) {
    method := strings.ToLower(req.Method)
    switch method {
    case "initialize", "mcp/initialize":
        var initReq types.InitializeRequest
        if len(bytes.TrimSpace(req.Params)) > 0 {
            if err := json.Unmarshal(req.Params, &initReq); err != nil {
                return nil, &rpcError{Code: -32602, Message: "Invalid params: initialize"}
            }
        }
        out, err := mcp.Initialize(ctx, &initReq)
        if err != nil {
            return nil, &rpcError{Code: -32000, Message: err.Error()}
        }
        return out, nil

    case "tools/list", "mcp/list-tools":
        tools, err := mcp.ListTools(ctx)
        if err != nil {
            return nil, &rpcError{Code: -32000, Message: err.Error()}
        }
        return map[string]interface{}{"tools": tools}, nil

    case "tools/call", "mcp/call-tool":
        var callReq types.CallToolRequest
        if err := json.Unmarshal(req.Params, &callReq); err != nil {
            return nil, &rpcError{Code: -32602, Message: "Invalid params: tools/call"}
        }
        out, err := mcp.CallTool(ctx, &callReq)
        if err != nil {
            return nil, &rpcError{Code: -32000, Message: err.Error()}
        }
        return out, nil

    case "prompts/list", "mcp/list-prompts":
        prompts, err := mcp.ListPrompts(ctx)
        if err != nil {
            return nil, &rpcError{Code: -32000, Message: err.Error()}
        }
        return map[string]interface{}{"prompts": prompts}, nil

    case "prompts/get", "mcp/get-prompt":
        var getReq types.GetPromptRequest
        if err := json.Unmarshal(req.Params, &getReq); err != nil {
            return nil, &rpcError{Code: -32602, Message: "Invalid params: prompts/get"}
        }
        out, err := mcp.GetPrompt(ctx, &getReq)
        if err != nil {
            return nil, &rpcError{Code: -32000, Message: err.Error()}
        }
        return out, nil
    }
    return nil, &rpcError{Code: -32601, Message: fmt.Sprintf("Method not found: %s", req.Method)}
}