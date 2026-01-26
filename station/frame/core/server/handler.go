package server

import (
	"context"
	"io"
	"net/http"

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

type handler struct {
	name     string
	method   Method
	path     string
	h        EndpointHandler
	wrappers []Wrapper
	t        HandlerType
}

func (h *handler) Name() string           { return h.name }
func (h *handler) Path() string           { return h.path }
func (h *handler) Method() Method         { return h.method }
func (h *handler) Handler() EndpointHandler { return h.h }
func (h *handler) Wrappers() []Wrapper    { return h.wrappers }
func (h *handler) Type() HandlerType      { return h.t }

func NewHandler(name, path string, method Method, typ HandlerType, h EndpointHandler, wrappers ...Wrapper) Handler {
	return &handler{name: name, path: path, method: method, t: typ, h: h, wrappers: wrappers}
}

func NewHTTPHandler(name, path string, method Method, h EndpointHandler, wrappers ...Wrapper) Handler {
	return NewHandler(name, path, method, HandlerTypeHTTP, h, wrappers...)
}

func HTTPHandlerFunc(h http.HandlerFunc) EndpointHandler {
	return func(ctx context.Context, req Request, resp Response) error {
		r, err := http.NewRequestWithContext(ctx, string(req.Method()), req.Path(), io.NopCloser(io.Reader(nil)))
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
	resp Response
}

func (w *httpResponseWriter) Header() http.Header {
	h := make(http.Header)
	for k, v := range w.resp.Header() {
		h.Set(k, v)
	}
	return h
}

func (w *httpResponseWriter) Write(b []byte) (int, error) {
	return w.resp.Write(b)
}

func (w *httpResponseWriter) WriteHeader(statusCode int) {
	w.resp.WriteHeader(statusCode)
}

func HTTPWrapperAdapter(httpWrapper func(ctx context.Context, next http.Handler) http.Handler) Wrapper {
	return func(next EndpointHandler) EndpointHandler {
		return func(ctx context.Context, req Request, resp Response) error {
			httpHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reqAdapter := &httpRequestAdapter{r: r}
				respAdapter := &httpResponseAdapter{w: w}
				_ = next(r.Context(), reqAdapter, respAdapter)
			})

			wrapped := httpWrapper(ctx, httpHandler)

			r, err := http.NewRequestWithContext(ctx, string(req.Method()), req.Path(), io.NopCloser(io.Reader(nil)))
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
	r *http.Request
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

func (r *httpResponseAdapter) Write(b []byte) (int, error) {
	return r.w.Write(b)
}

func (r *httpResponseAdapter) WriteHeader(statusCode int) {
	r.w.WriteHeader(statusCode)
}

func (r *httpResponseAdapter) Status() int {
	return 0
}

func HertzHandlerFunc(h interface{}) EndpointHandler {
	hertzHandler, ok := h.(func(context.Context, interface{}))
	if !ok {
		return func(ctx context.Context, req Request, resp Response) error {
			return nil
		}
	}

	return func(ctx context.Context, req Request, resp Response) error {
		hertzCtx := &hertzContextAdapter{
			ctx:  ctx,
			req:  req,
			resp: resp,
		}
		hertzHandler(ctx, hertzCtx)
		return nil
	}
}

type hertzContextAdapter struct {
	ctx  context.Context
	req  Request
	resp Response
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

func (h *streamHandler) Name() string            { return h.name }
func (h *streamHandler) Path() string            { return h.path }
func (h *streamHandler) Method() Method          { return h.method }
func (h *streamHandler) Handler() StreamEndpoint { return h.h }
func (h *streamHandler) Wrappers() []StreamWrapper { return h.wrappers }
func (h *streamHandler) Type() HandlerType       { return h.t }

func NewStreamHandler(name, path string, method Method, typ HandlerType, h StreamEndpoint, wrappers ...StreamWrapper) StreamHandler {
	return &streamHandler{name: name, path: path, method: method, t: typ, h: h, wrappers: wrappers}
}
