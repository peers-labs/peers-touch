package native

import (
	"bytes"
	"context"
	"net/http"
	"strconv"
	"sync"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/transport"
)

var (
	_ server.Server = (*ServerV2)(nil)
)

// Server is a golang native web server based on net/http.
type ServerV2 struct {
	*server.BaseServer

	warmupLk   sync.RWMutex
	httpServer *http.Server
	mux        *http.ServeMux
	once       sync.Once

	transport  transport.Transport
	done       chan struct{}
	listener   transport.Listener
	handlersV2 []server.HandlerV2
	streamsV2  []server.StreamHandler
}

func NewServerV2(opts ...option.Option) server.Server {
	s := &ServerV2{
		BaseServer: server.NewServer(opts...),
		mux:        http.NewServeMux(),
		done:       make(chan struct{}),
	}
	return s
}

func WithTransport(t transport.Transport) option.Option {
	return func(o *option.Options) {
		o.AppendCtx("native.server.transport", t)
	}
}

func (s *ServerV2) Init(option ...option.Option) (err error) {
	err = s.BaseServer.Init(option...)
	if err != nil {
		return err
	}

	if v := s.Options().Ctx().Value("native.server.transport"); v != nil {
		if tr, ok := v.(transport.Transport); ok {
			s.transport = tr
		}
	}

	if s.transport != nil {
		if err := s.transport.Init(); err != nil {
			return err
		}
	}

	return nil
}

func (s *ServerV2) Handle(handler server.Handler) error {
	s.warmupLk.Lock()
	defer s.warmupLk.Unlock()
	s.Options().Handlers = append(s.Options().Handlers, handler)
	if s.mux != nil {
		base := s.toHTTPHandler(handler)
		for _, mw := range handler.Wrappers() {
			base = mw(base)
		}
		s.mux.Handle(handler.Path(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if handler.Method() != server.ANY && string(handler.Method()) != r.Method {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			base.ServeHTTP(w, r)
		}))
	}
	return nil
}

func (s *ServerV2) HandleV2(h server.HandlerV2) error {
	s.warmupLk.Lock()
	defer s.warmupLk.Unlock()
	if h.Type() == server.HandlerTypeHTTP {
		if s.mux != nil {
			hf := h.Handler()
			for _, w := range h.Wrappers() {
				hf = w(hf)
			}
			s.mux.Handle(h.Path(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if h.Method() != server.ANYV2 && string(h.Method()) != r.Method {
					w.WriteHeader(http.StatusMethodNotAllowed)
					return
				}
				reqV := &requestV2{ctx: r.Context(), header: map[string]string{}, method: server.MethodV2(r.Method), path: r.URL.Path, body: readBody(r)}
				respV := &responseV2{header: map[string]string{}, code: 0}
				_ = hf(r.Context(), reqV, respV)
				for k, v := range respV.header {
					w.Header().Set(k, v)
				}
				if respV.code != 0 {
					w.WriteHeader(respV.code)
				}
				_, _ = w.Write(respV.buf.Bytes())
			}))
		}
	} else {
		s.handlersV2 = append(s.handlersV2, h)
	}
	return nil
}

func (s *ServerV2) HandleStreamV2(h server.StreamHandler) error {
	s.warmupLk.Lock()
	defer s.warmupLk.Unlock()
	if h.Type() == server.HandlerTypePS {
		s.streamsV2 = append(s.streamsV2, h)
	}
	return nil
}

func (s *ServerV2) Start(ctx context.Context, opts ...option.Option) error {
	for _, o := range opts {
		s.Options().Apply(o)
	}

	for _, h := range s.Options().Handlers {
		if err := s.Handle(h); err != nil {
			return err
		}
	}

	s.httpServer = &http.Server{Addr: s.Options().Address, Handler: s.mux}
	go func() { _ = s.httpServer.ListenAndServe() }()

	if s.transport != nil {
		addrs := s.transport.Options().Addrs
		if len(addrs) > 0 {
			l, err := s.transport.Listen(addrs[0])
			if err != nil {
				return err
			}
			s.listener = l
			go l.Accept(func(sock transport.Socket) { s.handleSocket(ctx, sock) })
		}
	}
	if s.Options().ReadyChan != nil {
		close(s.Options().ReadyChan)
	}

	<-s.done
	return nil
}

func (s *ServerV2) Stop(ctx context.Context) error {
	close(s.done)
	if s.listener != nil {
		_ = s.listener.Close()
	}
	if s.httpServer != nil {
		_ = s.httpServer.Close()
	}
	return s.BaseServer.Stop(ctx)
}

func (s *ServerV2) Name() string {
	return "native_v2"
}

func (s *ServerV2) handleSocket(ctx context.Context, sock transport.Socket) {
	for {
		var msg transport.Message
		if err := sock.Recv(&msg); err != nil {
			_ = sock.Close()
			return
		}

		path := msg.Header["Path"]
		method := msg.Header["Method"]
		if path == "" {
			path = "/"
		}
		if method == "" {
			method = string(server.ANY)
		}

		if sh := s.findStreamHandlerV2(path, method); sh != nil {
			hf := sh.Handler()
			for _, w := range sh.Wrappers() {
				hf = w(hf)
			}
			_ = hf(ctx, sock)
			_ = sock.Close()
			return
		}

		if hv2 := s.findHandlerV2(path, method); hv2 != nil {
			reqV := &requestV2{ctx: ctx, header: copyHeader(msg.Header, []string{"Path", "Method"}), method: server.MethodV2(method), path: path, body: msg.Body}
			respV := &responseV2{header: map[string]string{}, code: 0}
			hf := hv2.Handler()
			for _, w := range hv2.Wrappers() {
				hf = w(hf)
			}
			_ = hf(ctx, reqV, respV)
			status := respV.Status()
			if status == 0 {
				status = http.StatusOK
			}
			rspHeaders := map[string]string{"Status": strconv.Itoa(status)}
			for k, v := range respV.header {
				rspHeaders[k] = v
			}
			rsp := transport.Message{Header: rspHeaders, Body: respV.buf.Bytes()}
			_ = sock.Send(&rsp)
			continue
		}

		h := s.findHandler(path, method)
		if h == nil {
			rsp := transport.Message{Header: map[string]string{"Status": "404"}, Body: []byte("not found")}
			_ = sock.Send(&rsp)
			continue
		}

		rw := &responseBuffer{header: http.Header{}}
		req, _ := http.NewRequest(method, path, bytes.NewReader(msg.Body))
		req = req.WithContext(ctx)
		for k, v := range msg.Header {
			if k == "Path" || k == "Method" {
				continue
			}
			req.Header.Set(k, v)
		}

		base := s.toHTTPHandler(h)
		for _, mw := range h.Wrappers() {
			base = mw(base)
		}
		base.ServeHTTP(rw, req)

		status := rw.code
		if status == 0 {
			status = http.StatusOK
		}
		rspHeaders := map[string]string{"Status": strconv.Itoa(status)}
		if ct := rw.header.Get("Content-Type"); ct != "" {
			rspHeaders["Content-Type"] = ct
		}
		rsp := transport.Message{Header: rspHeaders, Body: rw.buf.Bytes()}
		_ = sock.Send(&rsp)
	}
}

func (s *ServerV2) findHandler(path, method string) server.Handler {
	for _, h := range s.Options().Handlers {
		if h.Path() == path {
			if h.Method() == server.ANY || string(h.Method()) == method {
				return h
			}
		}
	}
	return nil
}

func (s *ServerV2) findHandlerV2(path, method string) server.HandlerV2 {
	for _, h := range s.handlersV2 {
		if h.Path() == path {
			if string(h.Method()) == method || h.Method() == server.ANYV2 {
				if h.Type() == server.HandlerTypePS {
					return h
				}
			}
		}
	}
	return nil
}

func (s *ServerV2) findStreamHandlerV2(path, method string) server.StreamHandler {
	for _, h := range s.streamsV2 {
		if h.Path() == path {
			if string(h.Method()) == method || h.Method() == server.ANYV2 {
				if h.Type() == server.HandlerTypePS {
					return h
				}
			}
		}
	}
	return nil
}

func (s *ServerV2) toHTTPHandler(h server.Handler) http.Handler {
	switch x := h.Handler().(type) {
	case http.Handler:
		return x
	case server.HandlerFunc:
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { x(w, r) })
	case server.ContextHandlerFunc:
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { x(r.Context(), w, r) })
	default:
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotImplemented) })
	}
}

func readBody(r *http.Request) []byte {
	b := make([]byte, 0)
	if r.Body == nil {
		return b
	}
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(r.Body)
	return buf.Bytes()
}

type responseBuffer struct {
	header http.Header
	code   int
	buf    bytes.Buffer
}

func (r *responseBuffer) Header() http.Header         { return r.header }
func (r *responseBuffer) Write(p []byte) (int, error) { return r.buf.Write(p) }
func (r *responseBuffer) WriteHeader(statusCode int)  { r.code = statusCode }

type requestV2 struct {
	ctx    context.Context
	header map[string]string
	method server.MethodV2
	path   string
	body   []byte
}

func (r *requestV2) Context() context.Context  { return r.ctx }
func (r *requestV2) Header() map[string]string { return r.header }
func (r *requestV2) Method() server.MethodV2   { return r.method }
func (r *requestV2) Path() string              { return r.path }
func (r *requestV2) Body() []byte              { return r.body }

type responseV2 struct {
	header map[string]string
	code   int
	buf    bytes.Buffer
}

func (r *responseV2) Header() map[string]string   { return r.header }
func (r *responseV2) Write(p []byte) (int, error) { return r.buf.Write(p) }
func (r *responseV2) WriteHeader(statusCode int)  { r.code = statusCode }
func (r *responseV2) Status() int                 { return r.code }

func copyHeader(h map[string]string, skip []string) map[string]string {
	m := map[string]string{}
	sk := map[string]struct{}{}
	for _, k := range skip {
		sk[k] = struct{}{}
	}
	for k, v := range h {
		if _, ok := sk[k]; !ok {
			m[k] = v
		}
	}
	return m
}
