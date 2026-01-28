package server

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"reflect"

	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

type Method string

const (
	GET     Method = "GET"
	POST    Method = "POST"
	PUT     Method = "PUT"
	DELETE  Method = "DELETE"
	PATCH   Method = "PATCH"
	HEAD    Method = "HEAD"
	OPTIONS Method = "OPTIONS"
	ANY     Method = "ANY"
)

type HandlerType int

const (
	HandlerTypeHTTP HandlerType = iota
	HandlerTypePS
)

type Request interface {
	Context() context.Context
	Header() map[string]string
	Method() Method
	Path() string
	Body() []byte
}

type Response interface {
	Header() map[string]string
	SetHeader(key, value string)
	Write([]byte) (int, error)
	WriteHeader(int)
	Status() int
}

type EndpointHandler func(ctx context.Context, req Request, resp Response) error

type Wrapper func(EndpointHandler) EndpointHandler

type Handler interface {
	Name() string
	Path() string
	Method() Method
	Handler() EndpointHandler
	Wrappers() []Wrapper
	Type() HandlerType
}

// RouterURL provides name and path for a handler
type RouterURL interface {
	Name() string
	SubPath() string
}

// HandlerOption is a functional option for configuring handlers
type HandlerOption func(*handler)

// WithMethod sets the HTTP method for a handler
func WithMethod(m Method) HandlerOption {
	return func(h *handler) {
		h.method = m
	}
}

// WithType sets the handler type
func WithType(t HandlerType) HandlerOption {
	return func(h *handler) {
		h.t = t
	}
}

// WithWrappers adds wrappers to a handler
func WithWrappers(w ...Wrapper) HandlerOption {
	return func(h *handler) {
		h.wrappers = append(h.wrappers, w...)
	}
}

type handler struct {
	name     string
	method   Method
	path     string
	h        EndpointHandler
	wrappers []Wrapper
	t        HandlerType
}

func (h *handler) Name() string             { return h.name }
func (h *handler) Path() string             { return h.path }
func (h *handler) Method() Method           { return h.method }
func (h *handler) Handler() EndpointHandler { return h.h }
func (h *handler) Wrappers() []Wrapper      { return h.wrappers }
func (h *handler) Type() HandlerType        { return h.t }

// NewHandler creates a new handler with explicit parameters
func NewHandler(name, path string, method Method, typ HandlerType, h EndpointHandler, wrappers ...Wrapper) Handler {
	return &handler{name: name, path: path, method: method, t: typ, h: h, wrappers: wrappers}
}

// NewHandlerWithURL creates a handler using a RouterURL interface and options
func NewHandlerWithURL(url RouterURL, h interface{}, opts ...HandlerOption) Handler {
	handler := &handler{
		name:   url.Name(),
		path:   url.SubPath(),
		method: GET,
		t:      HandlerTypeHTTP,
	}

	// Handle the handler argument
	switch v := h.(type) {
	case EndpointHandler:
		handler.h = v
	default:
		// Assume it's a Hertz-style handler, wrap with HertzHandlerFunc
		handler.h = HertzHandlerFunc(h)
	}

	// Apply options
	for _, opt := range opts {
		opt(handler)
	}

	return handler
}

func NewHTTPHandler(name, path string, method Method, h EndpointHandler, wrappers ...Wrapper) Handler {
	return &handler{
		name:     name,
		path:     path,
		method:   method,
		t:        HandlerTypeHTTP,
		h:        h,
		wrappers: wrappers,
	}
}

func HTTPHandlerFunc(h http.HandlerFunc) EndpointHandler {
	return func(ctx context.Context, req Request, resp Response) error {
		// Create body reader from request body
		var bodyReader io.Reader
		if body := req.Body(); len(body) > 0 {
			bodyReader = bytes.NewReader(body)
		}

		// Create http.Request with full path including query string
		r, err := http.NewRequestWithContext(ctx, string(req.Method()), req.Path(), io.NopCloser(bodyReader))
		if err != nil {
			return err
		}

		for k, v := range req.Header() {
			r.Header.Set(k, v)
		}

		w := &httpResponseWriter{resp: resp}
		h(w, r)
		return nil
	}
}

type httpResponseWriter struct {
	resp   Response
	header http.Header
}

func (w *httpResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
		// Copy existing headers from response
		for k, v := range w.resp.Header() {
			w.header.Set(k, v)
		}
	}
	return w.header
}

func (w *httpResponseWriter) Write(b []byte) (int, error) {
	// Sync headers before first write
	w.syncHeaders()
	return w.resp.Write(b)
}

func (w *httpResponseWriter) WriteHeader(statusCode int) {
	// Sync headers before writing status
	w.syncHeaders()
	w.resp.WriteHeader(statusCode)
}

func (w *httpResponseWriter) syncHeaders() {
	if w.header != nil {
		for k, vals := range w.header {
			if len(vals) > 0 {
				w.resp.SetHeader(k, vals[0])
			}
		}
	}
}

func HTTPWrapperAdapter(httpWrapper func(ctx context.Context, next http.Handler) http.Handler) Wrapper {
	return func(next EndpointHandler) EndpointHandler {
		return func(ctx context.Context, req Request, resp Response) error {
			// Preserve the original request for Hertz context access
			originalReq := req

			httpHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reqAdapter := &httpRequestAdapter{r: r, originalReq: originalReq}
				respAdapter := &httpResponseAdapter{w: w}
				_ = next(r.Context(), reqAdapter, respAdapter)
			})

			wrapped := httpWrapper(ctx, httpHandler)
			bodyReader := io.NopCloser(bytes.NewReader(req.Body()))
			r, err := http.NewRequestWithContext(ctx, string(req.Method()), req.Path(), bodyReader)
			if err != nil {
				return err
			}

			for k, v := range req.Header() {
				r.Header.Set(k, v)
			}

			w := &httpResponseWriter{resp: resp}
			wrapped.ServeHTTP(w, r)
			return nil
		}
	}
}

type httpRequestAdapter struct {
	r           *http.Request
	originalReq Request // Preserve original request for Hertz context access
}

func (r *httpRequestAdapter) Context() context.Context {
	return r.r.Context()
}

func (r *httpRequestAdapter) Header() map[string]string {
	h := make(map[string]string)
	for k, v := range r.r.Header {
		if len(v) > 0 {
			h[k] = v[0]
		}
	}
	return h
}

func (r *httpRequestAdapter) Method() Method {
	return Method(r.r.Method)
}

func (r *httpRequestAdapter) Path() string {
	return r.r.URL.Path
}

func (r *httpRequestAdapter) Body() []byte {
	if r.r.Body == nil {
		return nil
	}
	b, _ := io.ReadAll(r.r.Body)
	return b
}

// GetHertzContext returns the underlying Hertz context if available
// This preserves the Hertz context through HTTP wrapper adapters
func (r *httpRequestAdapter) GetHertzContext() interface{} {
	type hertzContextGetter interface {
		GetHertzContext() interface{}
	}
	if getter, ok := r.originalReq.(hertzContextGetter); ok {
		return getter.GetHertzContext()
	}
	return nil
}

type httpResponseAdapter struct {
	w http.ResponseWriter
}

func (r *httpResponseAdapter) Header() map[string]string {
	h := make(map[string]string)
	for k, v := range r.w.Header() {
		if len(v) > 0 {
			h[k] = v[0]
		}
	}
	return h
}

func (r *httpResponseAdapter) SetHeader(key, value string) {
	r.w.Header().Set(key, value)
}

func (r *httpResponseAdapter) Write(b []byte) (int, error) {
	return r.w.Write(b)
}

func (r *httpResponseAdapter) WriteHeader(statusCode int) {
	r.w.WriteHeader(statusCode)
}

func (r *httpResponseAdapter) Status() int {
	return 0
}

// HertzHandlerFunc wraps a Hertz-style handler into an EndpointHandler.
// The wrapped handler uses reflection to call the original Hertz handler
// with the proper context extracted from the request.
func HertzHandlerFunc(h interface{}) EndpointHandler {
	// Validate that h is a function
	hv := reflect.ValueOf(h)
	if hv.Kind() != reflect.Func {
		return func(ctx context.Context, req Request, resp Response) error {
			return fmt.Errorf("HertzHandlerFunc: invalid handler type %T, expected function", h)
		}
	}

	return func(ctx context.Context, req Request, resp Response) (err error) {
		// Recover from panic and convert to error
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("handler panic: %v", r)
			}
		}()

		// Try to extract the underlying Hertz context
		type hertzContextGetter interface {
			GetHertzContext() interface{}
		}

		if getter, ok := req.(hertzContextGetter); ok {
			hertzCtx := getter.GetHertzContext()
			if hertzCtx != nil {
				// Use reflection to call the original handler
				args := []reflect.Value{
					reflect.ValueOf(ctx),
					reflect.ValueOf(hertzCtx),
				}
				hv.Call(args)
				return nil
			}
		}

		// Fallback: create adapter for the handler (should not normally happen)
		hertzCtx := &hertzContextAdapter{
			ctx: ctx,
			req: req,
		}
		args := []reflect.Value{
			reflect.ValueOf(ctx),
			reflect.ValueOf(hertzCtx),
		}
		hv.Call(args)
		return nil
	}
}

type hertzContextAdapter struct {
	ctx  context.Context
	req  Request
	// Headers need to be set through a different mechanism
}

type StreamEndpoint func(ctx context.Context, s transport.Socket) error

type StreamWrapper func(StreamEndpoint) StreamEndpoint

type StreamHandler interface {
	Name() string
	Path() string
	Method() Method
	Handler() StreamEndpoint
	Wrappers() []StreamWrapper
	Type() HandlerType
}

type streamHandler struct {
	name     string
	method   Method
	path     string
	h        StreamEndpoint
	wrappers []StreamWrapper
	t        HandlerType
}

func (h *streamHandler) Name() string              { return h.name }
func (h *streamHandler) Path() string              { return h.path }
func (h *streamHandler) Method() Method            { return h.method }
func (h *streamHandler) Handler() StreamEndpoint   { return h.h }
func (h *streamHandler) Wrappers() []StreamWrapper { return h.wrappers }
func (h *streamHandler) Type() HandlerType         { return h.t }

func NewStreamHandler(name, path string, method Method, typ HandlerType, h StreamEndpoint, wrappers ...StreamWrapper) StreamHandler {
	return &streamHandler{name: name, path: path, method: method, t: typ, h: h, wrappers: wrappers}
}
