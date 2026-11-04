package sandbox

import "context"

// TerminalBridge is the Station-side proxy for interactive sandbox terminals.
// It ensures the addressed sandbox is live before opening the PTY and forwards
// the bounded stream. It never executes locally and never falls back.
type TerminalBridge struct {
	executor *Executor
	pty      PtyClient
}

// NewTerminalBridge pairs the sandbox lifecycle executor with the PTY client.
func NewTerminalBridge(executor *Executor, pty PtyClient) *TerminalBridge {
	return &TerminalBridge{executor: executor, pty: pty}
}

// PtySessionOpen is one interactive terminal request.
type PtySessionOpen struct {
	SandboxRef string
	PtyID      string
	Command    string
	Args       []string
	Cwd        string
	Cols       uint32
	Rows       uint32
}

// Open cold-starts the sandbox if needed and opens the PTY inside it.
func (b *TerminalBridge) Open(ctx context.Context, in PtySessionOpen) error {
	if _, err := b.executor.EnsureByRef(ctx, in.SandboxRef); err != nil {
		return err
	}
	return b.pty.OpenPty(ctx, PtyOpen{
		SandboxRef: in.SandboxRef, PtyID: in.PtyID, Command: in.Command,
		Args: in.Args, Cwd: in.Cwd, Cols: in.Cols, Rows: in.Rows,
	})
}

func (b *TerminalBridge) Write(ctx context.Context, sandboxRef, ptyID string, data []byte) error {
	return b.pty.WritePty(ctx, sandboxRef, ptyID, data)
}

func (b *TerminalBridge) Read(ctx context.Context, sandboxRef, ptyID string, cursor uint64, maxBytes uint32) (*PtyRead, error) {
	return b.pty.ReadPty(ctx, sandboxRef, ptyID, cursor, maxBytes)
}

func (b *TerminalBridge) Resize(ctx context.Context, sandboxRef, ptyID string, cols, rows uint32) error {
	return b.pty.ResizePty(ctx, sandboxRef, ptyID, cols, rows)
}

func (b *TerminalBridge) Signal(ctx context.Context, sandboxRef, ptyID string, signal int) error {
	return b.pty.SignalPty(ctx, sandboxRef, ptyID, signal)
}

func (b *TerminalBridge) Close(ctx context.Context, sandboxRef, ptyID string) error {
	return b.pty.ClosePty(ctx, sandboxRef, ptyID)
}
