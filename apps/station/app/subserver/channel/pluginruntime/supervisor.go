// Package pluginruntime supervises external channel-plugin processes:
// process group lifecycle, stdio JSON-RPC handshake, bidirectional calls,
// health and exit detection.
//
// fp-01 scope: enable (spawn + initialize), disable (graceful stop), and
// observable crash detection. fp-02 adds plugin-initiated calls
// (inboundEvent/connectionStatus/getCredential) through host-registered
// method handlers. Automatic reconnect/backoff for the platform connection
// arrives with fp-03.
package pluginruntime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginrpc"
)

// maxInvalidFrames bounds parse/proto noise before the process is treated as
// failed; one-off corruption is counted, not fatal.
const maxInvalidFrames = 10

// ProcessConfig describes one plugin launch.
type ProcessConfig struct {
	ExecPath string
	Args     []string
	// HandshakeTimeout bounds initialize; zero uses the default.
	HandshakeTimeout time.Duration
	// StopGrace bounds graceful shutdown; zero uses the default.
	StopGrace time.Duration
}

// HostMethodHandler answers one plugin-initiated RPC call.
type HostMethodHandler func(ctx context.Context, params json.RawMessage) (any, error)

// State is a supervised plugin process.
type State struct {
	cfg ProcessConfig

	mu       sync.Mutex
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	exited   chan struct{}
	exitErr  error
	nextID   int64
	pending  map[int64]chan pluginrpc.Response
	info     pluginrpc.InitializeResult
	running  bool
	handlers map[string]HostMethodHandler

	invalidFrames atomic.Int64
	dispatchSem   chan struct{}
}

var (
	// ErrNotRunning is returned when a call is made to a stopped process.
	ErrNotRunning = errors.New("plugin process is not running")
	// ErrHandshake is returned when initialize fails or times out.
	ErrHandshake = errors.New("plugin handshake failed")
)

// Start launches the plugin and completes the initialize handshake.
func Start(parent context.Context, cfg ProcessConfig) (*State, error) {
	if cfg.HandshakeTimeout <= 0 {
		cfg.HandshakeTimeout = 10 * time.Second
	}
	if cfg.StopGrace <= 0 {
		cfg.StopGrace = 5 * time.Second
	}

	cmd := exec.Command(cfg.ExecPath, cfg.Args...)
	configureProcessGroup(cmd)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("plugin stdin: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("plugin stdout: %w", err)
	}
	cmd.Stderr = nil // plugin stderr intentionally discarded for fp-01

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start plugin: %w", err)
	}

	s := &State{
		cfg:         cfg,
		cmd:         cmd,
		stdin:       stdin,
		exited:      make(chan struct{}),
		pending:     make(map[int64]chan pluginrpc.Response),
		handlers:    make(map[string]HostMethodHandler),
		running:     true,
		dispatchSem: make(chan struct{}, 8),
	}
	go s.readLoop(stdout)
	go s.waitLoop()

	ctx, cancel := context.WithTimeout(parent, cfg.HandshakeTimeout)
	defer cancel()
	info, err := s.call(ctx, pluginrpc.MethodInitialize, pluginrpc.InitializeParams{
		ProtocolMin: pluginrpc.ProtocolMin,
		ProtocolMax: pluginrpc.ProtocolMax,
		HostName:    "peers-touch-station",
	})
	if err != nil {
		_ = s.kill()
		return nil, fmt.Errorf("%w: %v", ErrHandshake, err)
	}
	if err := json.Unmarshal(info.Result, &s.info); err != nil {
		_ = s.kill()
		return nil, fmt.Errorf("%w: decode initialize result: %v", ErrHandshake, err)
	}
	if s.info.Protocol < pluginrpc.ProtocolMin || s.info.Protocol > pluginrpc.ProtocolMax {
		_ = s.kill()
		return nil, fmt.Errorf("%w: plugin protocol %d outside host range %d-%d",
			ErrHandshake, s.info.Protocol, pluginrpc.ProtocolMin, pluginrpc.ProtocolMax)
	}
	return s, nil
}

// Info returns the handshake-declared plugin identity.
func (s *State) Info() pluginrpc.InitializeResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}

// OnMethod registers the host answerer for a plugin-initiated method
// (inboundEvent/connectionStatus/getCredential).
func (s *State) OnMethod(method string, handler HostMethodHandler) {
	s.mu.Lock()
	if handler != nil {
		s.handlers[method] = handler
	}
	s.mu.Unlock()
}

// InvalidFrames reports accumulated parse/proto violations.
func (s *State) InvalidFrames() int64 { return s.invalidFrames.Load() }

// Call invokes a plugin method and returns its raw result.
func (s *State) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	resp, err := s.call(ctx, method, params)
	if err != nil {
		return nil, err
	}
	return resp.Result, nil
}

// Health performs a health RPC call.
func (s *State) Health(ctx context.Context) (pluginrpc.HealthResult, error) {
	raw, err := s.Call(ctx, pluginrpc.MethodHealth, struct{}{})
	if err != nil {
		return pluginrpc.HealthResult{}, err
	}
	var h pluginrpc.HealthResult
	if err := json.Unmarshal(raw, &h); err != nil {
		return pluginrpc.HealthResult{}, err
	}
	return h, nil
}

// Stop requests graceful shutdown then kills the process group.
func (s *State) Stop() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	running := s.running
	s.mu.Unlock()
	if !running {
		return nil
	}

	if frame, err := pluginrpc.NewRequest(s.allocID(), pluginrpc.MethodShutdown, struct{}{}); err == nil {
		_ = s.write(frame)
	}

	select {
	case <-s.exited:
	case <-time.After(s.cfg.StopGrace):
		_ = s.kill()
		<-s.exited
	}
	s.markStopped()
	return nil
}

// Exited reports a channel closed when the plugin process terminates.
func (s *State) Exited() <-chan struct{} { return s.exited }

// ExitError returns the process wait error after exit (nil = clean exit).
func (s *State) ExitError() error {
	<-s.exited
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitErr
}

func (s *State) call(ctx context.Context, method string, params any) (pluginrpc.Response, error) {
	id := s.allocID()
	ch := make(chan pluginrpc.Response, 1)
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return pluginrpc.Response{}, ErrNotRunning
	}
	s.pending[id] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
	}()

	frame, err := pluginrpc.NewRequest(id, method, params)
	if err != nil {
		return pluginrpc.Response{}, err
	}
	if err := s.write(frame); err != nil {
		return pluginrpc.Response{}, err
	}

	select {
	case resp := <-ch:
		if resp.Error != nil {
			return resp, resp.Error
		}
		return resp, nil
	case <-ctx.Done():
		return pluginrpc.Response{}, ctx.Err()
	case <-s.exited:
		return pluginrpc.Response{}, fmt.Errorf("plugin exited: %v", s.snapshotExitErr())
	}
}

func (s *State) allocID() int64 { return atomic.AddInt64(&s.nextID, 1) }

func (s *State) write(frame []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		return ErrNotRunning
	}
	if _, err := s.stdin.Write(append(frame, '\n')); err != nil {
		return err
	}
	return nil
}

func (s *State) readLoop(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), pluginrpc.MaxFrameBytes)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		req, resp, err := pluginrpc.DecodeFrame(line)
		if err != nil {
			s.handleInvalidFrame()
			continue
		}
		if resp != nil {
			s.mu.Lock()
			ch, ok := s.pending[resp.ID]
			s.mu.Unlock()
			if ok {
				ch <- *resp
			}
			continue
		}
		s.dispatchPluginRequest(req)
	}
}

func (s *State) handleInvalidFrame() {
	if s.invalidFrames.Add(1) >= maxInvalidFrames {
		_ = s.kill()
	}
}

func (s *State) dispatchPluginRequest(req *pluginrpc.Request) {
	if len(req.Method) == 0 || req.ID == 0 {
		s.handleInvalidFrame()
		return
	}
	s.mu.Lock()
	handler := s.handlers[req.Method]
	running := s.running
	s.mu.Unlock()
	if handler == nil {
		_ = s.respondError(req.ID, pluginrpc.CodeMethodNotFound, "no host handler for "+req.Method)
		return
	}
	if !running {
		return
	}
	go func() {
		select {
		case s.dispatchSem <- struct{}{}:
		default:
			_ = s.respondError(req.ID, pluginrpc.CodeRetryableDelivery, "host busy")
			return
		}
		defer func() { <-s.dispatchSem }()

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		result, err := s.invokeHandler(ctx, handler, req)
		if err != nil {
			var rpcErr *pluginrpc.RPCError
			if errors.As(err, &rpcErr) {
				_ = s.respondError(req.ID, rpcErr.Code, rpcErr.Message)
				return
			}
			_ = s.respondError(req.ID, -32603, err.Error())
			return
		}
		frame, mErr := pluginrpc.NewResponse(req.ID, result)
		if mErr == nil {
			_ = s.write(frame)
		}
	}()
}

func (s *State) invokeHandler(ctx context.Context, handler HostMethodHandler, req *pluginrpc.Request) (result any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("host handler panic: %v", recovered)
		}
	}()
	return handler(ctx, req.Params)
}

func (s *State) respondError(id int64, code int, message string) error {
	frame, err := pluginrpc.NewErrorResponse(id, code, message)
	if err != nil {
		return err
	}
	return s.write(frame)
}

func (s *State) waitLoop() {
	err := s.cmd.Wait()
	s.mu.Lock()
	s.exitErr = err
	for _, ch := range s.pending {
		close(ch)
	}
	s.pending = map[int64]chan pluginrpc.Response{}
	s.running = false
	s.mu.Unlock()
	close(s.exited)
}

func (s *State) snapshotExitErr() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.exitErr
}

func (s *State) markStopped() {
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
}
