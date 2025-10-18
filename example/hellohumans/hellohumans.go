package main

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-touch/peers-touch-go"
	"github.com/peers-touch/peers-touch-go/core/debug/actuator"
	"github.com/peers-touch/peers-touch-go/core/node"
	"github.com/peers-touch/peers-touch-go/core/server"

	_ "github.com/peers-touch/peers-touch-go/core/plugin/native"
	_ "github.com/peers-touch/peers-touch-go/core/plugin/native/registry"
	_ "github.com/peers-touch/peers-touch-go/core/plugin/native/store"
	_ "github.com/peers-touch/peers-touch-go/core/plugin/store/rds/sqlite"
)

// helloRouterURL implements server.RouterURL for hello endpoints
type helloRouterURL struct {
	name string
	url  string
}

func (h helloRouterURL) Name() string {
	return h.name
}

func (h helloRouterURL) SubPath() string {
	return h.url
}

func main() {
	ctx := context.Background()
	p := peers.NewPeer()
	err := p.Init(
		ctx,
		node.Name("peers-touch-helloworld"),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("")),
		server.WithHandlers(
			server.NewHandler(helloRouterURL{name: "hello-world", url: "/hello"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("hello world, from native handler"))
			})),
			server.NewHandler(helloRouterURL{name: "hello-world-hertz", url: "/hello-hz"},
				func(c context.Context, ctx *app.RequestContext) {
					ctx.String(http.StatusOK, "hello world, from hertz handler")
				},
			),
		),
	)
	if err != nil {
		panic(err)
	}

	err = p.Start()
	if err != nil {
		panic(err)
	}
}
