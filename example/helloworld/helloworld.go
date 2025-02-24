package main

import (
	"github.com/dirty-bro-tech/peers-touch-go"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	"github.com/dirty-bro-tech/peers-touch-go/core/service"
	ns "github.com/dirty-bro-tech/peers-touch-go/core/service/native"
	"net/http"
)

func main() {
	s := ns.NewService(service.WithHandlers(
		server.NewHandler("hello-world", "/hello", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("hello world"))
		}))))
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
