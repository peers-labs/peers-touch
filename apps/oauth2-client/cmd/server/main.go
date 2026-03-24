package main

import (
	"log"
	"net/http"
	"os"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/bootstrap"
)

func main() {
	container, err := bootstrap.BuildContainer()
	if err != nil {
		log.Fatalf("build container failed: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/start", container.Handler.Start)
	mux.HandleFunc("/oauth/callback", container.Handler.Callback)
	mux.HandleFunc("/healthz", container.Handler.Healthz)
	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("oauth2-client listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
