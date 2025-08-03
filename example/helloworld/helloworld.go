package main

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go"
	"github.com/dirty-bro-tech/peers-touch-go/core/debug/actuator"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"

	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/store"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/rds/sqlite"
)

func main() {
	ctx := context.Background()
	p := peers.NewPeer()
	err := p.Init(
		ctx,
		service.Name("peers-touch-helloworld"),
		server.WithSubServer("debug", actuator.NewDebugSubServer, actuator.WithDebugServerPath("")),
		server.WithHandlers(
			server.NewHandler("hello-world", "/hello", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("hello world, from native handler"))
			})),
			server.NewHandler("hello-world-hertz", "/hello-hz",
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
