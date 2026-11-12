package sandboxprov

import (
	"context"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

// ptyMaxRingBytes bounds how much scrollback the provisioner retains per PTY.
// Viewers page back only within this window, like the Desktop D5 ring.
const ptyMaxRingBytes = 256 * 1024

// Pty lifecycle vocabulary (mirrors TW-D5 honest states).
const (
	PtyStateRunning = "running"
	PtyStateExited  = "exited"
	PtyStateKilled  = "killed"
	PtyStateUnknown = "unknown"
)

// PtyOpenRequest starts an interactive command in a TTY inside a sandbox.
type PtyOpenRequest struct {
	SandboxRef string   `json:"sandbox_ref"`
	PtyID      string   `json:"pty_id"`
	Command    string   `json:"command"`
	Args       []string `json:"args"`
	Cwd        string   `json:"cwd"`
	Cols       uint32   `json:"cols"`
	Rows       uint32   `json:"rows"`
}

// PtyReadRequest reads scrollback from a monotonic cursor.
type PtyReadRequest struct {
	SandboxRef string `json:"sandbox_ref"`
	PtyID      string `json:"pty_id"`
	Cursor     uint64 `json:"cursor"`
	MaxBytes   uint32 `json:"max_bytes"`
}

// PtyReadResult is a bounded chunk plus honest process state.
type PtyReadResult struct {
	Data       []byte `json:"data"`
	NextCursor uint64 `json:"next_cursor"`
	Truncated  bool   `json:"truncated"`
	Pid        uint32 `json:"pid"`
	State      string `json:"state"`
	ExitCode   int    `json:"exit_code"`
}

// boundedRing is a fixed-capacity byte window with monotonic offsets. Old
// bytes are dropped from the front; total counts everything ever written so
// viewers can detect a gap and re-sync from the oldest available offset.
type boundedRing struct {
	mu      sync.Mutex
	buf     []byte
	total   uint64
	dropped uint64
	limit   int
}

func newBoundedRing(limit int) *boundedRing {
	if limit <= 0 {
		limit = ptyMaxRingBytes
	}
	return &boundedRing{limit: limit}
}

func (r *boundedRing) write(p []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf = append(r.buf, p...)
	r.total += uint64(len(p))
	if overflow := len(r.buf) - r.limit; overflow > 0 {
		r.buf = append([]byte(nil), r.buf[overflow:]...)
		r.dropped += uint64(overflow)
	}
}

// read returns bytes strictly after cursor. It reports whether the requested
// cursor is older than the oldest retained byte (viewer must re-sync).
func (r *boundedRing) read(cursor uint64, max int) ([]byte, uint64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	gapped := cursor < r.dropped
	if gapped {
		// Gap: clamp to oldest available and signal truncation.
		cursor = r.dropped
	}
	if cursor > r.total {
		return nil, r.total, false
	}
	start := int(cursor - r.dropped)
	data := r.buf[start:]
	if max > 0 && len(data) > max {
		data = data[:max]
	}
	next := cursor + uint64(len(data))
	return append([]byte(nil), data...), next, gapped
}

type ptySession struct {
	mu        sync.Mutex
	ptyID     string
	container string
	execID    string
	conn      net.Conn
	ring      *boundedRing
	state     string
	exitCode  int
	pid       uint32
	done      chan struct{}
}

// PtyManager owns live PTYs inside sandbox containers. It is in-memory: a
// provisioner restart loses the sessions and Station reconcile downgrades
// them to UNKNOWN, exactly like the device worker model.
type PtyManager struct {
	docker  *dockerClient
	shell   CommandRunner // used only to send signals to the pty process group
	mu      sync.Mutex
	session map[string]*ptySession
}

func NewPtyManager() *PtyManager {
	return &PtyManager{
		docker:  newDockerClient(),
		shell:   execRunner,
		session: make(map[string]*ptySession),
	}
}

func (m *PtyManager) key(ref, pty string) string { return ref + "\x00" + pty }

func (m *PtyManager) get(ref, pty string) (*ptySession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.session[m.key(ref, pty)]
	if !ok {
		return nil, fmt.Errorf("%w: pty %s/%s not found", ErrNotRunning, ref, pty)
	}
	return s, nil
}

// Open starts the command inside the TTY Docker allocates for the exec. The
// exec'd entry process is already the session/process-group leader with the
// TTY as its controlling terminal (so setsid must NOT be used: it would
// detach from the controlling TTY and make the shell exit). We record $$
// before exec so the foreground group can be signalled deterministically via
// `kill -- -<pid>`, independent of other PTYs sharing the container.
func (m *PtyManager) Open(ctx context.Context, req PtyOpenRequest) (uint32, error) {
	if strings.TrimSpace(req.SandboxRef) == "" || strings.TrimSpace(req.PtyID) == "" ||
		strings.TrimSpace(req.Command) == "" {
		return 0, fmt.Errorf("%w: sandbox_ref, pty_id and command are required", ErrPolicyRejected)
	}
	name := containerName(req.SandboxRef)
	cmd := []string{
		"sh", "-c",
		fmt.Sprintf(
			`echo $$ > /tmp/.wbox-pty-%s.pid; exec %s "$@"`,
			req.PtyID, shellQuote(req.Command),
		),
		"wbox-pty",
	}
	cmd = append(cmd, req.Args...)
	execID, err := m.docker.execCreate(ctx, name, cmd, req.Cwd, "")
	if err != nil {
		return 0, err
	}
	conn, err := m.docker.execStart(ctx, execID)
	if err != nil {
		return 0, err
	}
	s := &ptySession{
		ptyID: req.PtyID, container: name, execID: execID, conn: conn,
		ring: newBoundedRing(ptyMaxRingBytes), state: PtyStateRunning,
		done: make(chan struct{}),
	}
	m.mu.Lock()
	m.session[m.key(req.SandboxRef, req.PtyID)] = s
	m.mu.Unlock()
	go m.pump(req.SandboxRef, s)
	if req.Cols > 0 || req.Rows > 0 {
		cols, rows := req.Cols, req.Rows
		if cols == 0 {
			cols = 80
		}
		if rows == 0 {
			rows = 24
		}
		if err := m.resizeWithRetry(ctx, execID, cols, rows); err != nil {
			_ = m.Close(ctx, req.SandboxRef, req.PtyID)
			return 0, err
		}
	}
	return 0, nil
}

// resizeWithRetry tolerates the short window right after exec start before
// the TTY accepts resize, without weakening isolation.
func (m *PtyManager) resizeWithRetry(ctx context.Context, execID string, cols, rows uint32) error {
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		last = m.docker.execResize(ctx, execID, cols, rows)
		if last == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(120 * time.Millisecond):
		}
	}
	return last
}

// pump copies PTY output into the ring until the process exits, then records
// the honest exit code. EOF on the hijacked stream means the exec ended.
func (m *PtyManager) pump(ref string, s *ptySession) {
	defer close(s.done)
	buf := make([]byte, 4096)
	for {
		n, err := s.conn.Read(buf)
		if n > 0 {
			s.ring.write(append([]byte(nil), buf[:n]...))
		}
		if err != nil {
			break
		}
	}
	state, code := m.finalState(s.execID)
	s.mu.Lock()
	s.state = state
	s.exitCode = code
	s.conn.Close()
	s.mu.Unlock()
}

// finalState maps the exec inspection to an honest terminal state.
func (m *PtyManager) finalState(execID string) (string, int) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	info, err := m.docker.execInspect(ctx, execID)
	if err != nil || info == nil {
		return PtyStateUnknown, 0
	}
	if info.Running {
		return PtyStateUnknown, 0
	}
	if info.ExitCode == 0 || info.ExitCode == 130 /* Ctrl-C exit */ {
		return PtyStateExited, info.ExitCode
	}
	return PtyStateExited, info.ExitCode
}

func (m *PtyManager) Write(_ context.Context, ref string, pty string, data []byte) error {
	s, err := m.get(ref, pty)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state != PtyStateRunning {
		return fmt.Errorf("%w: pty not running", ErrNotRunning)
	}
	if _, err := s.conn.Write(data); err != nil {
		return fmt.Errorf("write pty: %w", err)
	}
	return nil
}

func (m *PtyManager) Resize(ctx context.Context, ref, pty string, cols, rows uint32) error {
	s, err := m.get(ref, pty)
	if err != nil {
		return err
	}
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return m.docker.execResize(ctx, s.execID, cols, rows)
}

func (m *PtyManager) Read(_ context.Context, req PtyReadRequest) (*PtyReadResult, error) {
	s, err := m.get(req.SandboxRef, req.PtyID)
	if err != nil {
		return nil, err
	}
	max := int(req.MaxBytes)
	if max <= 0 || max > ptyMaxRingBytes {
		max = ptyMaxRingBytes
	}
	data, next, gapTrunc := s.ring.read(req.Cursor, max)
	s.mu.Lock()
	state, code, pid := s.state, s.exitCode, s.pid
	s.mu.Unlock()
	return &PtyReadResult{
		Data: data, NextCursor: next, Truncated: gapTrunc,
		Pid: pid, State: state, ExitCode: code,
	}, nil
}

// Signal sends a POSIX signal to the PTY's process group via a side non-TTY
// exec. SIGINT/SIGQUIT/SIGTSTP also have a control-character fast path, but
// killing the recorded setsid group works for every signal incl. SIGKILL and
// never affects other PTYs in the shared container.
func (m *PtyManager) Signal(ctx context.Context, ref, pty string, signal int) error {
	s, err := m.get(ref, pty)
	if err != nil {
		return err
	}
	if signal <= 0 {
		signal = 15
	}
	pidFile := fmt.Sprintf("/tmp/.wbox-pty-%s.pid", pty)
	script := fmt.Sprintf(
		`p=$(cat %s 2>/dev/null); [ -n "$p" ] && kill -%d -- -"$p" 2>/dev/null || kill -%d -- -"$p" 2>/dev/null || true`,
		pidFile, signal, signal,
	)
	out, err := m.shell(ctx, "docker", "exec", s.container, "sh", "-c", script)
	if err != nil {
		return fmt.Errorf("signal pty group: %w: %s", err, strings.TrimSpace(string(out)))
	}
	if signal == 9 || signal == 15 {
		s.mu.Lock()
		if s.state == PtyStateRunning {
			s.state = PtyStateKilled
		}
		s.mu.Unlock()
	}
	return nil
}

// Close tears down the PTY: SIGKILL the process group and drop the session.
// The viewer closing does NOT kill (kill is an explicit Signal); Close is the
// resource reclamation path.
func (m *PtyManager) Close(ctx context.Context, ref, pty string) error {
	s, err := m.get(ref, pty)
	if err != nil {
		return nil
	}
	_ = m.Signal(ctx, ref, pty, 9)
	s.mu.Lock()
	_ = s.conn.Close()
	s.mu.Unlock()
	m.mu.Lock()
	delete(m.session, m.key(ref, pty))
	m.mu.Unlock()
	return nil
}

// shellQuote single-quotes a command token for safe inclusion inside sh -c.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
