package touch

import (
	"context"
	"errors"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
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
	return func(next http.Handler) http.Handler {
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
	return []option.Option{
		server.WithRouters(routers...),
	}
}

func convertRouterToServerHandler(r Router) server.Handler {
	return server.Handler(r)
}

func SuccessResponse(ctx *app.RequestContext, msg string, data interface{}) {
	if msg == "" {
		msg = "success"
	}

	ctx.JSON(http.StatusOK, model.NewSuccessResponse(msg, data))
}

func FailedResponse(ctx *app.RequestContext, err error) {
	if err != nil {
		var e *model.Error
		if errors.As(err, &e) {
			ctx.JSON(http.StatusBadRequest, e)
			return
		}

		ctx.JSON(http.StatusBadRequest, model.UndefinedError(err))
		return
	}

	ctx.JSON(http.StatusBadRequest, model.ErrUndefined)
}
