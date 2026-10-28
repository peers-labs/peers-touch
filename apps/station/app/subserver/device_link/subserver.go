// Package device_link owns Station-mediated authorization of a new installation.
package device_link

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	identity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/application"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type subServer struct {
	mu          sync.RWMutex
	status      server.Status
	service     *application.Service
	jwt         server.Wrapper
	optionalJWT server.Wrapper
	cancel      context.CancelFunc
	done        chan struct{}
}

func NewDeviceLinkSubServer(_ ...option.Option) server.Subserver {
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
	owner, err := identity.NewRepository(database)
	if err != nil {
		return err
	}
	network, err := infrastructure.NewNetwork()
	if err != nil {
		return err
	}
	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.service = &application.Service{Database: func(ctx context.Context) (*gorm.DB, error) {
		return store.GetRDS(ctx)
	}, Identity: owner, Network: network, Clock: time.Now}
	s.jwt = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	s.optionalJWT = server.HTTPWrapperAdapter(httpadapter.OptionalJWT(provider))
	s.status = server.StatusStarting
	return nil
}

func (s *subServer) Start(ctx context.Context, _ ...option.Option) error {
	if _, err := s.service.Sweep(ctx); err != nil {
		return err
	}
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
			pass, cancel := context.WithTimeout(ctx, 20*time.Second)
			if _, err := s.service.Sweep(pass); err != nil {
				logger.Errorf(ctx, "device_link expiry sweep failed: %v", err)
			}
			if err := s.service.Republish(pass); err != nil {
				logger.Errorf(ctx, "device_link bootstrap publication failed: %v", err)
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
	s.cancel = nil
	s.done = nil
	s.status = server.StatusStopped
	return nil
}

func (s *subServer) Name() string                     { return "device_link" }
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
			var err error
			body, err = io.ReadAll(io.LimitReader(streaming.BodyStream(), link.MaxProtocolBytes+1))
			if err != nil {
				return projectError(ctx, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT))
			}
		} else {
			body = request.Body()
		}
		if len(body) > link.MaxProtocolBytes {
			return projectError(ctx, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CAPACITY_EXCEEDED))
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
	code := pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNSPECIFIED
	status := http.StatusInternalServerError
	if errors.As(err, &typed) {
		code = typed.Code
		status = http.StatusBadRequest
		switch code {
		case pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED:
			status = http.StatusUnauthorized
		case pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_REVISION_CONFLICT:
			status = http.StatusConflict
		case pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CAPACITY_EXCEEDED,
			pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_LIMIT:
			status = http.StatusTooManyRequests
		}
	}
	// Codes contain no capabilities, Actor identifiers, keys or credentials.
	logger.Warnf(ctx, "device_link operation rejected code=%s", code.String())
	projection := &pb.DeviceLinkError{Code: code}
	if typed != nil {
		projection.Status = typed.Status
	}
	raw, marshalErr := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(projection)
	if marshalErr != nil {
		return server.InternalError("device_link error projection failed")
	}
	return server.NewHandlerErrorWithResponse(status, "device_link rejected", "application/json", raw, map[string]string{"Cache-Control": "no-store"})
}

func guarded[Request any, Response any](operation func(context.Context, *Request) (*Response, error)) func(context.Context, *Request) (*Response, error) {
	return func(ctx context.Context, request *Request) (*Response, error) {
		if message, ok := any(request).(proto.Message); ok && proto.Size(message) > link.MaxProtocolBytes {
			return nil, projectError(ctx, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CAPACITY_EXCEEDED))
		}
		response, err := operation(ctx, request)
		return response, projectError(ctx, err)
	}
}

func (s *subServer) Handlers() []server.Handler {
	return []server.Handler{
		server.NewStrictTypedHandler("device-link-create", "/auth/device-link/create", server.POST, guarded(s.service.Create), protectedMaterial, s.jwt),
		server.NewStrictTypedHandler("device-link-claim", "/auth/device-link/claim", server.POST, guarded(s.service.Claim), protectedMaterial),
		server.NewStrictTypedHandler("device-link-approve", "/auth/device-link/approve", server.POST, guarded(s.handleApprove), protectedMaterial, s.jwt),
		server.NewStrictTypedHandler("device-link-deny", "/auth/device-link/deny", server.POST, guarded(s.handleDeny), protectedMaterial, s.jwt),
		server.NewStrictTypedHandler("device-link-cancel", "/auth/device-link/cancel", server.POST, guarded(s.handleCancel), protectedMaterial, s.optionalJWT),
		server.NewStrictTypedHandler("device-link-status", "/auth/device-link/status", server.POST, guarded(s.handleStatus), protectedMaterial, s.optionalJWT),
		server.NewStrictTypedHandler("device-link-material", "/auth/device-link/material", server.POST, guarded(s.service.Material), protectedMaterial),
		server.NewStrictTypedHandler("device-link-prove", "/auth/device-link/prove", server.POST, guarded(s.handleProve), protectedMaterial),
		server.NewStrictTypedHandler("device-link-access", "/auth/device-link/access", server.POST, guarded(s.handleAccess), protectedMaterial),
		server.NewStrictTypedHandler("device-link-ack", "/auth/device-link/ack", server.POST, guarded(s.handleAcknowledge), protectedMaterial),
	}
}
