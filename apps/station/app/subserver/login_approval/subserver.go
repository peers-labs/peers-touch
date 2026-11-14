// Package login_approval owns Station-mediated, claimant-first device
// authorization for a new installation.
package login_approval

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/login_approval/application"
	link "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/login_approval/infrastructure"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/loginapproval"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type subServer struct {
	mu      sync.RWMutex
	status  server.Status
	service *application.Service
	jwt     server.Wrapper
	cancel  context.CancelFunc
	done    chan struct{}
}

func NewLoginApprovalSubServer(_ ...option.Option) server.Subserver {
	return &subServer{status: server.StatusStopped}
}

func (s *subServer) Init(ctx context.Context, _ ...option.Option) error {
	database, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	if err := rows.Migrate(database); err != nil {
		return err
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.service = &application.Service{
		Database: func(ctx context.Context) (*gorm.DB, error) { return store.GetRDS(ctx) },
		Attempts: infrastructure.AttemptOwner{},
		Approver: infrastructure.ApproverOwner{},
		Clock:    time.Now,
	}
	s.jwt = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	s.status = server.StatusStarting
	return nil
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		return nil
	}
	worker, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.done = make(chan struct{})
	go s.run(worker, s.done)
	s.status = server.StatusRunning
	return nil
}

func (s *subServer) run(ctx context.Context, done chan struct{}) {
	defer close(done)
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
			if _, err := s.service.Sweep(bounded); err != nil {
				logger.Errorf(bounded, "login_approval expiry sweep failed: %v", err)
			}
			cancel()
		}
	}
}

func (s *subServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	cancel, done := s.cancel, s.done
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancel, s.done = nil, nil
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string                     { return "login_approval" }
func (s *subServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *subServer) Address() server.SubserverAddress { return server.SubserverAddress{} }
func (s *subServer) Status() server.Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

type boundedRequest struct {
	server.Request
	body []byte
}

func (r boundedRequest) Body() []byte { return r.body }

func protectedMaterial(next server.EndpointHandler) server.EndpointHandler {
	return func(ctx context.Context, request server.Request, response server.Response) error {
		response.SetHeader("Cache-Control", "no-store")
		response.SetHeader("Pragma", "no-cache")
		response.SetHeader("Referrer-Policy", "no-referrer")
		var body []byte
		if streaming, ok := request.(server.StreamingRequest); ok {
			raw, err := io.ReadAll(io.LimitReader(streaming.BodyStream(), link.MaxProtocolBytes+1))
			if err != nil {
				return projectError(ctx, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT))
			}
			body = raw
		} else {
			body = request.Body()
		}
		if len(body) > link.MaxProtocolBytes {
			return projectError(ctx, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPACITY_EXCEEDED))
		}
		bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		return next(bounded, boundedRequest{Request: request, body: body}, response)
	}
}

func projectError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	var typed *link.Error
	code := pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNSPECIFIED
	status := http.StatusInternalServerError
	if errors.As(err, &typed) {
		code = typed.Code
		status = http.StatusBadRequest
		switch code {
		case pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPABILITY_INVALID,
			pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNAUTHORIZED_ATTEMPT:
			status = http.StatusUnauthorized
		case pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_REVISION_CONFLICT:
			status = http.StatusConflict
		case pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPACITY_EXCEEDED:
			status = http.StatusTooManyRequests
		}
	}
	logger.Warnf(ctx, "login_approval operation rejected code=%s", code.String())
	raw, marshalErr := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(&pb.LoginApprovalError{Code: code})
	if marshalErr != nil {
		return server.InternalError("login_approval error projection failed")
	}
	return server.NewHandlerErrorWithResponse(status, "login_approval rejected", "application/json", raw,
		map[string]string{"Cache-Control": "no-store"})
}

func guarded[Request any, Response any](operation func(context.Context, *Request) (*Response, error)) func(context.Context, *Request) (*Response, error) {
	return func(ctx context.Context, request *Request) (*Response, error) {
		if message, ok := any(request).(proto.Message); ok && proto.Size(message) > link.MaxProtocolBytes {
			return nil, projectError(ctx, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPACITY_EXCEEDED))
		}
		response, err := operation(ctx, request)
		return response, projectError(ctx, err)
	}
}

func (s *subServer) Handlers() []server.Handler {
	return []server.Handler{
		// No-session claimant surface, authorized by a possession capability.
		server.NewStrictTypedHandler("login-approval-create", "/auth/login-approval/create", server.POST, guarded(s.service.Create), protectedMaterial),
		server.NewStrictTypedHandler("login-approval-status", "/auth/login-approval/status", server.POST, guarded(s.service.Status), protectedMaterial),
		server.NewStrictTypedHandler("login-approval-cancel", "/auth/login-approval/cancel", server.POST, guarded(s.service.Cancel), protectedMaterial),
		// Authenticated approver surface.
		server.NewStrictTypedHandler("login-approval-list-pending", "/auth/login-approval/list-pending", server.POST, guarded(s.service.ListPending), protectedMaterial, s.jwt),
		server.NewStrictTypedHandler("login-approval-approve", "/auth/login-approval/approve", server.POST, guarded(s.service.Approve), protectedMaterial, s.jwt),
		server.NewStrictTypedHandler("login-approval-deny", "/auth/login-approval/deny", server.POST, guarded(s.service.Deny), protectedMaterial, s.jwt),
	}
}
