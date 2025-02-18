package main

import (
	"github.com/dirty-bro-tech/peers-touch-go"
	"github.com/dirty-bro-tech/peers-touch-go/core/server"
	ns "github.com/dirty-bro-tech/peers-touch-go/core/server/native"
	"net/http"
)

func main() {
	s := ns.NewServer()
	err := s.Init(
		server.WithAddress(":8080"),
		server.WithTimeout(100),
	)
	if err != nil {
		panic(err)
	}

	err = s.Handle(ns.NewHandler("hello-world", "/hello", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello world"))
	})))
	if err != nil {
		panic(err)
	}

	p := peers.NewPeer()
	err = p.Init(
		peers.WithName("hello-world"),
		peers.WithServer(s),
	)
	if err != nil {
		panic(err)
	}

	err = p.Start()
	if err != nil {
		panic(err)
	}
}
