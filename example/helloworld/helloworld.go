package main

import (
	"context"
	"net/http"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/dirty-bro-tech/peers-touch-go"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	ns "github.com/dirty-bro-tech/peers-touch-go/core/service/native"
)

func main() {
	s := ns.NewService(service.WithHandlers(
		server.NewHandler("hello-world", "/hello", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("hello world, from native handler"))
		})),
		// this handler will only work for hertz server
		server.NewHandler("hello-world-hertz", "/hello-hz",
			func(c context.Context, ctx *app.RequestContext) {
				ctx.String(http.StatusOK, "hello world, from hertz handler")
			})),
	)
	p := peers.NewPeer()
	err := p.Init(
		peers.WithName("hello-world"),
		peers.WithCore(s),
	)
	if err != nil {
		panic(err)
	}

	err = p.Start()
	if err != nil {
		panic(err)
	}
}
