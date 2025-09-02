package touch

import (
	"context"
	"errors"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/option"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
)

const (
	RoutersNameManagement  = "management"
	RoutersNameActivityPub = "activitypub"
	RoutersNameWellKnown   = ".well-known"
	RoutersNameUser        = "user"
	RoutersNamePeer        = "peer"
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
			case RoutersNameManagement:
				isEnabled = routerConfig.Management
			case RoutersNameActivityPub:
				isEnabled = routerConfig.ActivityPub
			case RoutersNameWellKnown:
				isEnabled = routerConfig.WellKnown
			case RoutersNameUser:
				isEnabled = routerConfig.User
			case RoutersNamePeer:
				isEnabled = routerConfig.Peer
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
	routerConfig := GetRouterConfig()
	log.Infof(context.Background(), "Router config: %+v", routerConfig)

	routers := make([]server.Routers, 0)

	// Conditionally add routers based on configuration
	if routerConfig.Management {
		routers = append(routers, NewManageRouter())
	}

	if routerConfig.ActivityPub {
		routers = append(routers, NewActivityPubRouter())
	}

	if routerConfig.WellKnown {
		routers = append(routers, NewWellKnownRouter())
	}

	if routerConfig.User {
		routers = append(routers, NewUserRouter())
	}

	if routerConfig.Peer {
		routers = append(routers, NewPeerRouter())
	}

	return []option.Option{
		server.WithRouters(routers...),
	}
}

// wrapRouterHandler wraps a router handler with configuration checking
func wrapRouterHandler(router Router, routerName string, configCheck func(*RouterConfig) bool) server.Handler {
	originalHandler := router.Handler()
	wrappedHandler := func(ctx context.Context, c *app.RequestContext) {
		routerConfig := GetRouterConfig()
		if !configCheck(routerConfig) {
			log.Warnf(context.Background(), "Router %s is disabled by configuration", routerName)
			c.JSON(http.StatusNotFound, map[string]string{"error": "Router disabled"})
			return
		}
		originalHandler.(func(context.Context, *app.RequestContext))(ctx, c)
	}

	// Create a RouterPath from the router's path
	routerURL := RouterPath(router.Path())

	// Create a new handler with the wrapped function and method
	return server.NewHandler(routerURL, wrappedHandler, server.WithMethod(router.Method()))
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
