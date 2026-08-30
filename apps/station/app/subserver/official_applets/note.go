package officialapplets

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"

	notestation "github.com/peers-labs/peers-touch/apps/applets/note/service/stationadapter"
	notetransport "github.com/peers-labs/peers-touch/apps/applets/note/service/transport"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const noteMountPath = "/applets/note"

type NoteSubServer struct {
	status     server.Status
	jwtWrapper server.Wrapper
	handler    http.Handler
}

func NewNoteSubServer(_ ...option.Option) server.Subserver {
	return &NoteSubServer{status: server.StatusStopped}
}

func (s *NoteSubServer) Init(ctx context.Context, _ ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))

	rds, err := store.GetRDS(ctx)
	if err != nil {
		s.status = server.StatusError
		return err
	}

	bundle, err := notestation.NewBundle(ctx, rds)
	if err != nil {
		s.status = server.StatusError
		return err
	}
	s.handler = bundle.Mount(noteMountPath)
	return nil
}

func (s *NoteSubServer) Start(context.Context, ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *NoteSubServer) Stop(context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *NoteSubServer) Name() string                     { return "official_applet_note" }
func (s *NoteSubServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *NoteSubServer) Status() server.Status            { return s.status }
func (s *NoteSubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }

func (s *NoteSubServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewHTTPHandler(
			"official-applet-note",
			noteMountPath+"/",
			server.ANY,
			s.handle,
			serverwrapper.LogID(),
			s.jwtWrapper,
		),
	}
}

func (s *NoteSubServer) handle(ctx context.Context, req server.Request, resp server.Response) error {
	if s.handler == nil {
		return server.InternalError("note applet service is not initialized")
	}

	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return server.Unauthorized("authentication required")
	}

	httpReq, err := newHTTPRequest(ctx, req)
	if err != nil {
		return server.BadRequestWithCause("invalid applet note request", err)
	}
	httpReq.Header.Set(notetransport.OwnerPTIDHeader, subject.ID)

	writer := &serverResponseWriter{resp: resp}
	s.handler.ServeHTTP(writer, httpReq)
	return nil
}

func newHTTPRequest(ctx context.Context, req server.Request) (*http.Request, error) {
	fullPath := req.Path()
	path := fullPath
	rawQuery := ""
	if idx := strings.Index(fullPath, "?"); idx >= 0 {
		path = fullPath[:idx]
		rawQuery = fullPath[idx+1:]
	}

	httpReq, err := http.NewRequestWithContext(ctx, string(req.Method()), path, io.NopCloser(bytes.NewReader(req.Body())))
	if err != nil {
		return nil, err
	}
	httpReq.URL.RawQuery = rawQuery
	for key, value := range req.Header() {
		httpReq.Header.Set(key, value)
	}
	return httpReq, nil
}

type serverResponseWriter struct {
	resp   server.Response
	header http.Header
}

func (w *serverResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
		for key, value := range w.resp.Header() {
			w.header.Set(key, value)
		}
	}
	return w.header
}

func (w *serverResponseWriter) WriteHeader(statusCode int) {
	w.syncHeaders()
	w.resp.WriteHeader(statusCode)
}

func (w *serverResponseWriter) Write(payload []byte) (int, error) {
	w.syncHeaders()
	return w.resp.Write(payload)
}

func (w *serverResponseWriter) syncHeaders() {
	if w.header == nil {
		return
	}
	for key, values := range w.header {
		if len(values) > 0 {
			w.resp.SetHeader(key, values[0])
		}
	}
}
