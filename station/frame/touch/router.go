package touch

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
)

// Router is a server handler that can be registered with a server.
// Peers defines a router protocol that can be used to register handlers with a server.
// also supplies standard handlers which follow activityPub protocol.
// if you what to register a handler with Peers server, you can implement this interface, then call server.listPeers() to register it.
type Router server.Handler

type RouterPath string

func (apr RouterPath) Name() string {
	return string(apr)
}

func (apr RouterPath) SubPath() string {
	return string(apr)
}

// CommonAccessControlWrapper creates a wrapper that checks router accessibility based on router family name
func CommonAccessControlWrapper(routerFamilyName string) server.Wrapper {
	httpWrapper := func(ctx context.Context, next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			routerConfig := GetRouterConfig()

			// Check if the router family is enabled based on its name
			var isEnabled bool
			switch routerFamilyName {
			case model.RouteNameManagement:
				isEnabled = routerConfig.Management
			case model.RouteNameActivityPub:
				isEnabled = routerConfig.ActivityPub
			case model.RouteNameWellKnown:
				isEnabled = routerConfig.WellKnown
			case model.RouteNameActor:
				isEnabled = routerConfig.User
			case model.RouteNamePeer:
				isEnabled = routerConfig.Peer
			case model.RouteNameMessage:
				isEnabled = routerConfig.Message
			case model.RouteNameMastodon:
				isEnabled = routerConfig.Mastodon
			case model.RouteNameSocial:
				isEnabled = routerConfig.Social
			default:
				log.Warnf(r.Context(), "Unknown router family: %s", routerFamilyName)
				isEnabled = false
			}

			if !isEnabled {
				log.Warnf(r.Context(), "Router family %s is disabled by configuration", routerFamilyName)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`{"error":"Page not found"}`)) // Match the existing 404 response format
				return
			}

			next.ServeHTTP(w, r)
		})
	}
	return server.HTTPWrapperAdapter(httpWrapper)
}

// wrapHandler creates a wrapper that checks configuration before executing the handler
func wrapHandler(handlerName string, configCheck func(*RouterConfig) bool, handler func(context.Context, *app.RequestContext)) func(context.Context, *app.RequestContext) {
	return func(ctx context.Context, c *app.RequestContext) {
		routerConfig := GetRouterConfig()
		if !configCheck(routerConfig) {
			log.Warnf(context.Background(), "Handler %s is disabled by configuration", handlerName)
			c.JSON(http.StatusNotFound, map[string]string{"error": "Handler disabled"})
			return
		}
		handler(ctx, c)
	}
}

// Routers returns server options with touch handlers
func Routers() []option.Option {
	routers := make([]server.Routers, 0)
	routers = append(routers, NewManageRouter())
	routers = append(routers, NewActivityPubRouter())
	routers = append(routers, NewWellKnownRouter())
	routers = append(routers, NewPeerRouter())
	routers = append(routers, NewMessageRouter())
	routers = append(routers, NewMastodonRouter())
	routers = append(routers, NewSocialRouter())
	routers = append(routers, NewSessionRouter())
	return []option.Option{
		server.WithRouters(routers...),
	}
}

func convertRouterToServerHandler(r Router) server.Handler {
	return server.Handler(r)
}

// shouldUseProto checks if the client prefers protobuf response
func shouldUseProto(ctx *app.RequestContext) bool {
	accept := string(ctx.GetHeader("Accept"))
	contentType := string(ctx.GetHeader("Content-Type"))
	return strings.Contains(accept, model.AcceptProtobuf) ||
		strings.Contains(contentType, model.ContentTypeProtobuf)
}

// SuccessResponse sends a success response in proto or JSON format based on Accept header
func SuccessResponse(c context.Context, ctx *app.RequestContext, msg string, data interface{}) {
	if msg == "" {
		msg = "success"
	}

	// Build PeersResponse
	resp := &types.PeersResponse{
		Code: model.SuccessCode,
		Msg:  msg,
	}

	// Pack data into Any if it's a proto.Message
	if protoMsg, ok := data.(proto.Message); ok && protoMsg != nil {
		anyData, err := anypb.New(protoMsg)
		if err == nil {
			resp.Data = anyData
		}
	}

	if shouldUseProto(ctx) {
		// Return protobuf
		respBytes, err := proto.Marshal(resp)
		if err != nil {
			log.Errorf(c, "failed to marshal protobuf response: %v", err)
			ctx.SetStatusCode(http.StatusInternalServerError)
			return
		}
		ctx.Data(http.StatusOK, model.ContentTypeProtobuf, respBytes)
		return
	}

	// Return JSON
	ctx.Header("Content-Type", model.ContentTypeJSONUTF8)
	ctx.JSON(http.StatusOK, model.NewSuccessResponse(msg, data))
}

// FailedResponse sends an error response in proto or JSON format based on Accept header
func FailedResponse(c context.Context, ctx *app.RequestContext, err error) {
	if err == nil {
		err = errors.New("undefined error")
	}

	var errResp *model.ErrorResponse
	if !errors.As(err, &errResp) {
		errResp = model.UndefinedError(err)
	}

	statusCode := http.StatusBadRequest
	if errResp.Code == model.ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR {
		statusCode = http.StatusInternalServerError
	}

	if shouldUseProto(ctx) {
		// Return protobuf error
		respBytes, marshalErr := proto.Marshal(errResp)
		if marshalErr != nil {
			log.Errorf(c, "failed to marshal protobuf error: %v", marshalErr)
			ctx.SetStatusCode(http.StatusInternalServerError)
			return
		}
		ctx.Data(statusCode, model.ContentTypeProtobuf, respBytes)
		return
	}

	// Return JSON error
	ctx.JSON(statusCode, errResp)
}
