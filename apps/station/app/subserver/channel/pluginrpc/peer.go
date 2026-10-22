package pluginrpc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
)

// RequestHandler answers one inbound RPC call from the other side. Returning
// (nil, nil) yields a JSON null result; a *RPCError is forwarded with its
// code, any other error becomes a generic internal-error response.
type RequestHandler func(ctx context.Context, params json.RawMessage) (any, error)

// Peer is a bidirectional JSON-RPC endpoint over a reader/writer pair.
// Channel plugins use it both to answer host calls (initialize/deliver/...)
// and to initiate their own (inboundEvent/getCredential/...).
type Peer struct {
	r *bufio.Reader
	w io.Writer

	writeMu sync.Mutex
	nextID  atomic.Int64

	pendingMu sync.Mutex
	pending   map[int64]chan Response

	handlerMu sync.RWMutex
	handlers  map[string]RequestHandler

	closeOnce sync.Once
	closed    chan struct{}

	dispatchSem chan struct{}
}

// NewPeer builds an endpoint. concurrency bounds simultaneous inbound calls;
// non-positive values use the default of 8.
func NewPeer(r io.Reader, w io.Writer, concurrency int) *Peer {
	if concurrency <= 0 {
		concurrency = 8
	}
	var br *bufio.Reader
	if buffered, ok := r.(*bufio.Reader); ok {
		br = buffered
	} else {
		br = bufio.NewReaderSize(r, MaxFrameBytes+1024)
	}
	return &Peer{
		r:           br,
		w:           w,
		pending:     make(map[int64]chan Response),
		handlers:    make(map[string]RequestHandler),
		closed:      make(chan struct{}),
		dispatchSem: make(chan struct{}, concurrency),
	}
}

// Handle registers the answerer for one method.
func (p *Peer) Handle(method string, h RequestHandler) {
	if h == nil {
		return
	}
	p.handlerMu.Lock()
	p.handlers[method] = h
	p.handlerMu.Unlock()
}

// Serve consumes frames until the reader ends or ctx is cancelled. It must run
// exactly once per Peer.
func (p *Peer) Serve(ctx context.Context) error {
	for {
		line, err := p.r.ReadBytes('\n')
		if len(line) > 0 {
			p.dispatch(ctx, line[:len(line)-1])
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				p.failAllPending(io.EOF)
				return nil
			}
			p.failAllPending(err)
			return err
		}
	}
}

// Closed is closed when Serve has left.
func (p *Peer) Closed() <-chan struct{} { return p.closed }

func (p *Peer) dispatch(ctx context.Context, line []byte) {
	if len(line) > MaxFrameBytes {
		// A request beyond the frame budget is rejected; its id is unknown once
		// parsing fails, so count-and-drop mirrors the host supervisor policy.
		return
	}
	req, resp, err := DecodeFrame(line)
	if err != nil {
		return
	}
	if resp != nil {
		p.pendingMu.Lock()
		ch := p.pending[resp.ID]
		delete(p.pending, resp.ID)
		p.pendingMu.Unlock()
		if ch != nil {
			select {
			case ch <- *resp:
			default:
			}
		}
		return
	}
	// Bound simultaneous handlers so a burst of platform events cannot grow
	// goroutines without limit.
	go func() {
		select {
		case p.dispatchSem <- struct{}{}:
		case <-ctx.Done():
			_ = p.writeError(req.ID, CodeRetryableDelivery, "shutting down")
			return
		}
		defer func() { <-p.dispatchSem }()

		handlerCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		result, callErr := p.handle(handlerCtx, req)
		if callErr != nil {
			rpcErr, ok := callErr.(*RPCError)
			if !ok {
				_ = p.writeError(req.ID, -32603, safeErrorMessage(callErr))
				return
			}
			_ = p.writeError(req.ID, rpcErr.Code, rpcErr.Message)
			return
		}
		_ = p.writeResult(req.ID, result)
	}()
}

func (p *Peer) handle(ctx context.Context, req *Request) (result any, err error) {
	p.handlerMu.RLock()
	handler := p.handlers[req.Method]
	p.handlerMu.RUnlock()
	if handler == nil {
		return nil, &RPCError{Code: CodeMethodNotFound, Message: "method not found: " + req.Method}
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err = &RPCError{Code: -32603, Message: fmt.Sprintf("handler panic: %v", recovered)}
		}
	}()
	return handler(ctx, req.Params)
}

// Call invokes a method on the other side and waits for its result.
func (p *Peer) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := p.nextID.Add(1)
	ch := make(chan Response, 1)
	p.pendingMu.Lock()
	p.pending[id] = ch
	p.pendingMu.Unlock()
	defer func() {
		p.pendingMu.Lock()
		delete(p.pending, id)
		p.pendingMu.Unlock()
	}()

	frame, err := NewRequest(id, method, params)
	if err != nil {
		return nil, err
	}
	if err := p.write(frame); err != nil {
		return nil, err
	}
	select {
	case resp := <-ch:
		if resp.Error != nil {
			return nil, resp.Error
		}
		return resp.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.closed:
		return nil, io.ErrClosedPipe
	}
}

func (p *Peer) write(frame []byte) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if len(frame)+1 > MaxFrameBytes {
		return fmt.Errorf("rpc frame exceeds %d bytes", MaxFrameBytes)
	}
	if _, err := p.w.Write(frame); err != nil {
		return err
	}
	_, err := p.w.Write([]byte{'\n'})
	return err
}

func (p *Peer) writeResult(id int64, result any) error {
	frame, err := NewResponse(id, result)
	if err != nil {
		return err
	}
	return p.write(frame)
}

func (p *Peer) writeError(id int64, code int, message string) error {
	frame, err := NewErrorResponse(id, code, message)
	if err != nil {
		return err
	}
	return p.write(frame)
}

func (p *Peer) failAllPending(err error) {
	p.closeOnce.Do(func() { close(p.closed) })
	p.pendingMu.Lock()
	pending := p.pending
	p.pending = make(map[int64]chan Response)
	p.pendingMu.Unlock()
	for _, ch := range pending {
		select {
		case ch <- Response{Error: &RPCError{Code: -32000, Message: err.Error()}}:
		default:
		}
	}
}

func safeErrorMessage(err error) string {
	msg := err.Error()
	if len(msg) > 512 {
		return msg[:512]
	}
	return msg
}
