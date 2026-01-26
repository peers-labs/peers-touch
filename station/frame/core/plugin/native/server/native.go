// Package native provides a net/http-based server implementation.
package native

import (
	"context"
	"io"
	"net/http"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

var (
	_ server.Server = (*Server)(nil)
)

// Server is a golang native web server based on net/http.
type Server struct {
	*server.BaseServer

	httpServer *http.Server
	httpRouter *http.ServeMux
	psRouter   map[string]server.StreamHandler

	transport    transport.Transport
	done         chan struct{}
	listener     transport.Listener
	httpHandlers []server.Handler
	psHandlers   []server.StreamHandler
}

// NewServer creates a new native Server with provided options.
func NewServer(opts ...option.Option) *Server {
	s := &Server{
		BaseServer: server.NewServer(opts...),
		httpRouter: http.NewServeMux(),
		psRouter:   make(map[string]server.StreamHandler),
		done:       make(chan struct{}),
	}

	return s
}

// SetTransport sets the transport for the server - should be called before Init
func (s *Server) SetTransport(t transport.Transport) {
	s.transport = t
}

// AddHTTPHandlers adds HTTP handlers to the server
func (s *Server) AddHTTPHandlers(handlers ...server.Handler) {
	s.httpHandlers = append(s.httpHandlers, handlers...)
}

// AddStreamHandlers adds P2P stream handlers to the server
func (s *Server) AddStreamHandlers(handlers ...server.StreamHandler) {
	s.psHandlers = append(s.psHandlers, handlers...)
}

// Init initializes the server and its transport using given options.
func (s *Server) Init(option ...option.Option) (err error) {
	err = s.BaseServer.Init(option...)
	if err != nil {
		return err
	}

	if s.transport != nil {
		if err := s.transport.Init(); err != nil {
			return err
		}
	}

	return nil
}

// Handle records a legacy handler; base server will dispatch it.
func (s *Server) Handle(handler server.Handler) error {
	// Since we can't safely type assert between conflicting interfaces,
	// we'll store this in the base server handlers and let the base server handle it
	s.Options().Handlers = append(s.Options().Handlers, handler)

	return nil
}

// Start applies options, registers handlers, starts HTTP and P2P listeners, then blocks.
func (s *Server) Start(ctx context.Context, opts ...option.Option) error {
	for _, o := range opts {
		s.Options().Apply(o)
	}

	// Register handlers from stored httpHandlers
	for _, h := range s.httpHandlers {
		handler := h.Handler()
		for _, wrapper := range h.Wrappers() {
			handler = wrapper(handler)
		}

		s.httpRouter.HandleFunc(h.Path(), func(w http.ResponseWriter, r *http.Request) {
			if h.Method() != server.ANY && string(h.Method()) != r.Method {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			req := &request{r: r}
			resp := &response{w: w}
			_ = handler(r.Context(), req, resp)
		})
	}

	// Register handlers from stored psHandlers
	for _, h := range s.psHandlers {
		s.psRouter[h.Path()] = h
	}

	s.httpServer = &http.Server{Addr: s.Options().Address, Handler: s}
	go func() { _ = s.httpServer.ListenAndServe() }()

	if s.transport != nil {
		addrs := s.transport.Options().Addrs
		if len(addrs) > 0 {
			l, err := s.transport.Listen(addrs[0])
			if err != nil {
				return err
			}
			s.listener = l
			go func() {
				if err := l.Accept(func(sock transport.Socket) { s.handleSocket(ctx, sock) }); err != nil {
					logger.Errorf(ctx, "listener accept error: %v", err)
				}
			}()
		}
	}
	if s.Options().ReadyChan != nil {
		close(s.Options().ReadyChan)
	}

	<-s.done

	return nil
}

// ServeHTTP implements http.Handler using the internal router.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.httpRouter.ServeHTTP(w, r)
}

// Stop shuts down listeners and the base server.
func (s *Server) Stop(ctx context.Context) error {
	close(s.done)
	if s.listener != nil {
		_ = s.listener.Close()
	}
	if s.httpServer != nil {
		_ = s.httpServer.Close()
	}
	return s.BaseServer.Stop(ctx)
}

// Name returns the server identifier.
func (s *Server) Name() string {
	return "native"
}

func (s *Server) handleSocket(ctx context.Context, sock transport.Socket) {
	var msg transport.Message
	if err := sock.Recv(&msg); err != nil {
		_ = sock.Close()
		return
	}

	serviceName := msg.Header["service"]
	if serviceName == "" {
		_ = sock.Close()
		return
	}

	h, ok := s.psRouter[serviceName]
	if !ok {
		_ = sock.Close()
		return
	}

	handler := h.Handler()
	for _, wrapper := range h.Wrappers() {
		handler = wrapper(handler)
	}

	// Create a wrapper socket that provides the already received message
	wrapperSock := &messageSocket{
		Socket:   sock,
		message:  &msg,
		received: true,
	}

	_ = handler(ctx, wrapperSock)
	_ = sock.Close()
}

type request struct {
	r *http.Request
}

// Context returns the request context.
func (r *request) Context() context.Context {
	return r.r.Context()
}

// Header returns the first value for each header key.
func (r *request) Header() map[string]string {
	h := make(map[string]string)

	for k, v := range r.r.Header {
		if len(v) > 0 {
			h[k] = v[0]
		}
	}
	return h
}

// Method returns the HTTP method as server.Method.
func (r *request) Method() server.Method {
	return server.Method(r.r.Method)
}

// Path returns the request path.
func (r *request) Path() string {
	return r.r.URL.Path
}

// Body reads and returns the request body.
func (r *request) Body() []byte {
	body, _ := io.ReadAll(r.r.Body)
	return body
}

type response struct {
	w      http.ResponseWriter
	status int
	header map[string]string
}

// Header returns the response header map to set before writing.
func (r *response) Header() map[string]string {
	if r.header == nil {
		r.header = make(map[string]string)
	}
	return r.header
}

// Write writes the bytes to the underlying ResponseWriter.
func (r *response) Write(b []byte) (int, error) {
	for k, v := range r.header {
		r.w.Header().Set(k, v)
	}
	if r.status != 0 {
		r.w.WriteHeader(r.status)
	}
	return r.w.Write(b)
}

// WriteHeader sets the pending response status code.
func (r *response) WriteHeader(status int) {
	r.status = status
}

// Status returns the pending response status code.
func (r *response) Status() int {
	return r.status
}

// messageSocket wraps a transport.Socket to provide the first received message
type messageSocket struct {
	transport.Socket
	message  *transport.Message
	received bool
}

// Recv returns the first received message once, then delegates to underlying socket.
func (s *messageSocket) Recv(msg *transport.Message) error {
	if s.received {
		// Return the already received message
		*msg = *s.message
		s.received = false // Only return the message once
		return nil
	}
	// For subsequent receives, use the underlying socket
	return s.Socket.Recv(msg)
}
