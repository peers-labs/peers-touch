package sandbox

import (
	"context"
	"encoding/base64"
)

// PtyOpen opens an interactive command in a TTY inside a sandbox.
type PtyOpen struct {
	SandboxRef string
	PtyID      string
	Command    string
	Args       []string
	Cwd        string
	Cols       uint32
	Rows       uint32
}

// PtyRead is one bounded scrollback read from a monotonic cursor.
type PtyRead struct {
	Data       []byte
	NextCursor uint64
	Truncated  bool
	Pid        uint32
	State      string
	ExitCode   int
}

// PtyClient is the Station -> provisioner interactive terminal boundary.
type PtyClient interface {
	OpenPty(ctx context.Context, in PtyOpen) error
	WritePty(ctx context.Context, sandboxRef, ptyID string, data []byte) error
	ReadPty(ctx context.Context, sandboxRef, ptyID string, cursor uint64, maxBytes uint32) (*PtyRead, error)
	ResizePty(ctx context.Context, sandboxRef, ptyID string, cols, rows uint32) error
	SignalPty(ctx context.Context, sandboxRef, ptyID string, signal int) error
	ClosePty(ctx context.Context, sandboxRef, ptyID string) error
}

func (c *HTTPClient) OpenPty(ctx context.Context, in PtyOpen) error {
	return c.postJSON(ctx, "/v1/ptys/open", map[string]any{
		"sandbox_ref": in.SandboxRef,
		"pty_id":      in.PtyID,
		"command":     in.Command,
		"args":        in.Args,
		"cwd":         in.Cwd,
		"cols":        in.Cols,
		"rows":        in.Rows,
	}, nil)
}

func (c *HTTPClient) WritePty(ctx context.Context, sandboxRef, ptyID string, data []byte) error {
	return c.postJSON(ctx, "/v1/ptys/write", map[string]string{
		"sandbox_ref": sandboxRef,
		"pty_id":      ptyID,
		"data_b64":    base64.StdEncoding.EncodeToString(data),
	}, nil)
}

func (c *HTTPClient) ReadPty(ctx context.Context, sandboxRef, ptyID string, cursor uint64, maxBytes uint32) (*PtyRead, error) {
	var resp struct {
		DataB64    string `json:"data_b64"`
		NextCursor uint64 `json:"next_cursor"`
		Truncated  bool   `json:"truncated"`
		Pid        uint32 `json:"pid"`
		State      string `json:"state"`
		ExitCode   int    `json:"exit_code"`
	}
	if err := c.postJSON(ctx, "/v1/ptys/read", map[string]any{
		"sandbox_ref": sandboxRef,
		"pty_id":      ptyID,
		"cursor":      cursor,
		"max_bytes":   maxBytes,
	}, &resp); err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(resp.DataB64)
	if err != nil {
		return nil, err
	}
	return &PtyRead{
		Data: data, NextCursor: resp.NextCursor, Truncated: resp.Truncated,
		Pid: resp.Pid, State: resp.State, ExitCode: resp.ExitCode,
	}, nil
}

func (c *HTTPClient) ResizePty(ctx context.Context, sandboxRef, ptyID string, cols, rows uint32) error {
	return c.postJSON(ctx, "/v1/ptys/resize", map[string]any{
		"sandbox_ref": sandboxRef, "pty_id": ptyID, "cols": cols, "rows": rows,
	}, nil)
}

func (c *HTTPClient) SignalPty(ctx context.Context, sandboxRef, ptyID string, signal int) error {
	return c.postJSON(ctx, "/v1/ptys/signal", map[string]any{
		"sandbox_ref": sandboxRef, "pty_id": ptyID, "signal": signal,
	}, nil)
}

func (c *HTTPClient) ClosePty(ctx context.Context, sandboxRef, ptyID string) error {
	return c.postJSON(ctx, "/v1/ptys/close", map[string]string{
		"sandbox_ref": sandboxRef, "pty_id": ptyID,
	}, nil)
}
