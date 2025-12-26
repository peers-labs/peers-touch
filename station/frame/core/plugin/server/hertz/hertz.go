package hertz

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/middlewares/server/recovery"
	hz "github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/hlog"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// hertzRouterURL implements server.RouterURL for hertz endpoints
type hertzRouterURL struct {
	name string
	url  string
}

func (h hertzRouterURL) Name() string {
	return h.name
}

func (h hertzRouterURL) SubPath() string {
	return h.url
}

type Server struct {
	*server.BaseServer

	hertz *hz.Hertz

	lock    sync.RWMutex
	started bool
}

func NewServer(opts ...option.Option) *Server {
	s := &Server{
		BaseServer: server.NewServer(opts...),
	}

	return s
}

func (s *Server) Init(opts ...option.Option) error {
	err := s.BaseServer.Init(opts...)
	if err != nil {
		return err
	}

	s.Options().Apply(opts...)

	// Configure Hertz to use our custom logger via adapter
	// This ensures all internal Hertz logs follow our logging format and rules
	hlog.SetLogger(NewHertzLogger())
	// Set hertz log level to Error to avoid noisy debug logs
	hlog.SetLevel(hlog.LevelError)

	s.hertz = hz.New(hz.WithHostPorts(s.Options().Address))
	return nil
}

func (s *Server) Handle(h server.Handler) error {
	if hdl, ok := h.Handler().(func(context.Context, *app.RequestContext)); ok {
		mws := h.HertzMiddlewares()
		composed := composeHertz(mws, hdl)
		switch h.Method() {
		case server.POST:
			s.hertz.POST(h.Path(), composed)
		case server.GET:
			s.hertz.GET(h.Path(), composed)
		default:
			s.hertz.Any(h.Path(), composed)
		}
		return nil
	}

	return nil
}

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

	s.hertz.OnShutdown = append(s.hertz.OnShutdown, func(hertzCtx context.Context) {
		log.Infof(hertzCtx, "shutdown hertz")
		cancel()
	})

	for _, handler := range s.Options().Handlers {
		switch h := handler.Handler().(type) {
		case func(context.Context, *app.RequestContext):
			err = s.Handle(handler)
			if err != nil {
				return err
			}
		case http.Handler:
			// Apply wrappers to http.Handler
			hw := applyWrappers(h, handler.Wrappers())
			// Convert http.Handler to Hertz handler
			hertzHandler := func(c context.Context, ctx *app.RequestContext) {
				// Parse URL
				rURL, _ := url.Parse(string(ctx.Request.URI().RequestURI()))

				// Create http.Request from Hertz context
				req := &http.Request{
					Method: string(ctx.Method()),
					URL:    rURL,
					Header: make(http.Header),
					Body:   io.NopCloser(bytes.NewReader(ctx.Request.Body())),
				}

				// Copy headers
				ctx.Request.Header.VisitAll(func(key, value []byte) {
					req.Header.Set(string(key), string(value))
				})

				// Create response writer
				rw := &responseWriter{ctx: ctx}

				// Call the wrapped handler
				hw.ServeHTTP(rw, req)
			}

			err = s.Handle(server.NewHandler(hertzRouterURL{name: handler.Name(), url: handler.Path()},
				hertzHandler, server.WithMethod(handler.Method())))
			if err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported handler type: %T of %s. ", h, handler.Name())
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

func (s *Server) Name() string {
	return "hertz"
}

// responseWriter implements http.ResponseWriter for Hertz
type responseWriter struct {
	ctx *app.RequestContext
}

func (w *responseWriter) Header() http.Header {
	// Convert Hertz headers to http.Header
	h := make(http.Header)
	w.ctx.Response.Header.VisitAll(func(key, value []byte) {
		h.Add(string(key), string(value))
	})
	return h
}

func (w *responseWriter) Write(data []byte) (int, error) {
	w.ctx.Write(data)
	return len(data), nil
}

func (w *responseWriter) WriteHeader(statusCode int) {
	w.ctx.SetStatusCode(statusCode)
}

func composeHertz(middlewares []func(context.Context, *app.RequestContext), h func(context.Context, *app.RequestContext)) func(context.Context, *app.RequestContext) {
	return func(c context.Context, ctx *app.RequestContext) {
		for _, mw := range middlewares {
			mw(c, ctx)
		}
		if _, exists := ctx.Get("user_id"); exists {
			h(c, ctx)
			return
		}
		if len(middlewares) == 0 {
			h(c, ctx)
		}
	}
}

func applyWrappers(h http.Handler, wrappers []server.Wrapper) http.Handler {
	wrapped := h
	for i := len(wrappers) - 1; i >= 0; i-- {
		wrapped = wrappers[i](wrapped)
	}
	return wrapped
}
