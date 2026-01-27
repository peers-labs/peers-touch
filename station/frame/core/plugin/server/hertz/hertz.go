package hertz

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/middlewares/server/recovery"
	hz "github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/hlog"
	"github.com/google/uuid"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// hertzRouterURL implements server.RouterURL for hertz endpoints
type hertzRouterURL struct {
	name string
	url  string
}

// Name returns route name.
func (h hertzRouterURL) Name() string { return h.name }

// SubPath returns route subpath.
func (h hertzRouterURL) SubPath() string { return h.url }

// Server implements server.Server using CloudWeGo Hertz.
type Server struct {
	*server.BaseServer

	hertz *hz.Hertz

	lock    sync.RWMutex
	started bool
}

// NewServer constructs a Hertz server.
func NewServer(opts ...option.Option) *Server {
	s := &Server{
		BaseServer: server.NewServer(opts...),
	}

	return s
}

// Init initializes base server and Hertz engine.
func (s *Server) Init(opts ...option.Option) error {
	err := s.BaseServer.Init(opts...)
	if err != nil {
		return err
	}

	s.Options().Apply(opts...)

	// Configure Hertz to use our custom logger via adapter
	// This ensures all internal Hertz logs follow our logging format and rules
	hlog.SetLogger(NewHertzLogger())
	// Note: We don't call hlog.SetLevel here because it would re-initialize
	// our DefaultLogger and override the log level from config

	s.hertz = hz.New(hz.WithHostPorts(s.Options().Address))
	return nil
}

// Handle registers a handler on the Hertz engine.
func (s *Server) Handle(h server.Handler) error {
	// Convert EndpointHandler to Hertz handler
	endpointHandler := h.Handler()

	// Apply wrappers
	for _, wrapper := range h.Wrappers() {
		endpointHandler = wrapper(endpointHandler)
	}

	// Create Hertz handler from EndpointHandler
	hertzHandler := func(c context.Context, ctx *app.RequestContext) {
		req := &hertzRequest{ctx: ctx}
		resp := &hertzResponse{ctx: ctx}
		_ = endpointHandler(c, req, resp)
	}

	switch h.Method() {
	case server.POST:
		s.hertz.POST(h.Path(), hertzHandler)
	case server.GET:
		s.hertz.GET(h.Path(), hertzHandler)
	case server.PUT:
		s.hertz.PUT(h.Path(), hertzHandler)
	case server.DELETE:
		s.hertz.DELETE(h.Path(), hertzHandler)
	case server.PATCH:
		s.hertz.PATCH(h.Path(), hertzHandler)
	default:
		s.hertz.Any(h.Path(), hertzHandler)
	}

	return nil
}

// Start starts base server and spins Hertz.
func (s *Server) Start(ctx context.Context, opts ...option.Option) error {
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.started {
		log.Errorf(ctx, "server already started!")
		return nil
	}

	ctx, cancel := context.WithCancel(ctx)
	s.Options().Apply(opts...)
	err := s.BaseServer.Start()
	if err != nil {
		log.Errorf(ctx, "warmup baseServer error: %v", err)
		cancel()
		return err
	}

	// recovery middleware
	s.hertz.Use(recovery.Recovery())

	// request logger middleware
	s.hertz.Use(RequestLoggerMiddleware())

	s.hertz.OnShutdown = append(s.hertz.OnShutdown, func(hertzCtx context.Context) {
		log.Infof(hertzCtx, "shutdown hertz")
		cancel()
	})

	for _, handler := range s.Options().Handlers {
		// Capture handler in closure to avoid loop variable issues
		h := handler
		endpointHandler := h.Handler()

		// Apply endpoint-level wrappers first
		allWrappers := append(s.Options().GlobalWrappers, h.Wrappers()...)
		for _, wrapper := range allWrappers {
			endpointHandler = wrapper(endpointHandler)
		}

		// Capture the final endpoint handler
		finalEndpointHandler := endpointHandler

		// Create a Hertz handler that wraps the EndpointHandler
		hertzHandler := func(c context.Context, ctx *app.RequestContext) {
			// Create request/response adapters that can provide Hertz context
			req := &hertzRequestWithContext{ctx: ctx}
			resp := &hertzResponse{ctx: ctx}

			// Call the endpoint handler
			if err := finalEndpointHandler(c, req, resp); err != nil {
				log.Errorf(c, "handler error: %v", err)
				ctx.SetStatusCode(http.StatusInternalServerError)
			}
		}

		// Register handler directly with Hertz router
		switch h.Method() {
		case server.POST:
			s.hertz.POST(h.Path(), hertzHandler)
		case server.GET:
			s.hertz.GET(h.Path(), hertzHandler)
		case server.PUT:
			s.hertz.PUT(h.Path(), hertzHandler)
		case server.DELETE:
			s.hertz.DELETE(h.Path(), hertzHandler)
		case server.PATCH:
			s.hertz.PATCH(h.Path(), hertzHandler)
		default:
			s.hertz.Any(h.Path(), hertzHandler)
		}
	}

	go s.hertz.Spin()
	select {
	// wait for server to start
	// TODO maybe need a better way to wait for server to start
	case <-time.After(time.Second * 3):
	}
	if s.Options().ReadyChan != nil {
		s.Options().ReadyChan <- struct {
			Msg string
		}{
			Msg: "ready",
		}
	}

	s.started = true
	return nil
}

// Stop shuts down base server and Hertz engine.
func (s *Server) Stop(ctx context.Context) error {
	// Add fresh shutdown context with longer timeout
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// First stop base server components
	if err := s.BaseServer.Stop(shutdownCtx); err != nil {
		return err
	}

	// Then stop Hertz server with proper error handling
	if err := s.hertz.Engine.Close(); err != nil {
		return fmt.Errorf("hertz engine close error: %w", err)
	}

	// Wait for server to actually stop with new context
	select {
	case <-shutdownCtx.Done():
		if errors.Is(shutdownCtx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("server shutdown timed out after 5s")
		}
		return nil
	}
}

// Name returns the server identifier.
func (s *Server) Name() string {
	return "hertz"
}

// responseWriter implements http.ResponseWriter for Hertz
// responseWriter translates Hertz responses to http.ResponseWriter.
type responseWriter struct {
	ctx *app.RequestContext
}

// Header returns response header map.
func (w *responseWriter) Header() http.Header {
	// Convert Hertz headers to http.Header
	h := make(http.Header)
	w.ctx.Response.Header.VisitAll(func(key, value []byte) {
		h.Add(string(key), string(value))
	})
	return h
}

// Write writes response bytes.
func (w *responseWriter) Write(data []byte) (int, error) {
	w.ctx.Write(data)
	return len(data), nil
}

// WriteHeader sets HTTP status code.
func (w *responseWriter) WriteHeader(statusCode int) {
	w.ctx.SetStatusCode(statusCode)
}


func RequestLoggerMiddleware() app.HandlerFunc {
	return func(ctx context.Context, c *app.RequestContext) {
		requestID := string(c.Request.Header.Peek("X-Request-ID"))
		if requestID == "" {
			requestID = uuid.New().String()
		}

		ctx = log.WithRequestID(ctx, requestID)
		c.Response.Header.Set("X-Request-ID", requestID)

		start := time.Now()
		method := string(c.Method())
		path := string(c.Path())

		log.Infof(ctx, "[HTTP] → %s %s", method, path)

		c.Next(ctx)

		latency := time.Since(start)
		statusCode := c.Response.StatusCode()

		log.Infof(ctx, "[HTTP] ← %s %s %d %s", method, path, statusCode, latency)
	}
}

// hertzRequest adapts Hertz RequestContext to server.Request
type hertzRequest struct {
	ctx *app.RequestContext
}

func (r *hertzRequest) Context() context.Context {
	return context.Background()
}

func (r *hertzRequest) Header() map[string]string {
	h := make(map[string]string)
	r.ctx.Request.Header.VisitAll(func(key, value []byte) {
		h[string(key)] = string(value)
	})
	return h
}

func (r *hertzRequest) Method() server.Method {
	return server.Method(r.ctx.Method())
}

func (r *hertzRequest) Path() string {
	return string(r.ctx.Path())
}

func (r *hertzRequest) Body() []byte {
	return r.ctx.Request.Body()
}

// hertzRequestWithContext adapts Hertz RequestContext to server.Request
// and implements hertzContextGetter to provide access to the underlying Hertz context
type hertzRequestWithContext struct {
	ctx *app.RequestContext
}

func (r *hertzRequestWithContext) Context() context.Context {
	return context.Background()
}

func (r *hertzRequestWithContext) Header() map[string]string {
	h := make(map[string]string)
	r.ctx.Request.Header.VisitAll(func(key, value []byte) {
		h[string(key)] = string(value)
	})
	return h
}

func (r *hertzRequestWithContext) Method() server.Method {
	return server.Method(r.ctx.Method())
}

func (r *hertzRequestWithContext) Path() string {
	return string(r.ctx.Path())
}

func (r *hertzRequestWithContext) Body() []byte {
	return r.ctx.Request.Body()
}

// GetHertzContext returns the underlying Hertz RequestContext
// This implements the hertzContextGetter interface used by HertzHandlerFunc
func (r *hertzRequestWithContext) GetHertzContext() interface{} {
	return r.ctx
}

// hertzResponse adapts Hertz RequestContext to server.Response
type hertzResponse struct {
	ctx *app.RequestContext
}

func (r *hertzResponse) Header() map[string]string {
	h := make(map[string]string)
	r.ctx.Response.Header.VisitAll(func(key, value []byte) {
		h[string(key)] = string(value)
	})
	return h
}

func (r *hertzResponse) Write(b []byte) (int, error) {
	return r.ctx.Write(b)
}

func (r *hertzResponse) WriteHeader(statusCode int) {
	r.ctx.SetStatusCode(statusCode)
}

func (r *hertzResponse) Status() int {
	return r.ctx.Response.StatusCode()
}
