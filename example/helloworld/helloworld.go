package main

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"

	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/registry/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/native"
	_ "github.com/dirty-bro-tech/peers-touch-go/core/plugin/store/rds/sqlite"
)

func main() {
	ctx := context.Background()
	p := peers.NewPeer()
	err := p.Init(
		ctx,
		peers.WithName("hello-world"),
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
