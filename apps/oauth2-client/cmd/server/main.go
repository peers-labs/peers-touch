package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/bootstrap"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

func main() {
	container, err := bootstrap.BuildContainer()
	if err != nil {
		log.Fatalf("build container failed: %v", err)
	}
	mux := http.NewServeMux()
	handle := func(path string, fn http.HandlerFunc) {
		mux.HandleFunc(path, fn)
	}
	handle("/api/oauth/github/start", func(w http.ResponseWriter, r *http.Request) {
		container.Handler.StartWithProvider(w, r, valueobject.ProviderGitHub)
	})
	handle("/api/oauth/google/start", func(w http.ResponseWriter, r *http.Request) {
		container.Handler.StartWithProvider(w, r, valueobject.ProviderGoogle)
	})
	handle("/api/oauth/weixin/start", func(w http.ResponseWriter, r *http.Request) {
		container.Handler.StartWithProvider(w, r, valueobject.ProviderWeixin)
	})
	handle("/api/oauth/github/callback", func(w http.ResponseWriter, r *http.Request) {
		container.Handler.CallbackWithProvider(w, r, valueobject.ProviderGitHub)
	})
	handle("/api/oauth/google/callback", func(w http.ResponseWriter, r *http.Request) {
		container.Handler.CallbackWithProvider(w, r, valueobject.ProviderGoogle)
	})
	handle("/api/oauth/weixin/callback", func(w http.ResponseWriter, r *http.Request) {
		container.Handler.CallbackWithProvider(w, r, valueobject.ProviderWeixin)
	})
	handle("/api/healthz", container.Handler.Healthz)
	addr := resolveListenAddr()
	log.Printf("oauth2-client listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func resolveListenAddr() string {
	addr := strings.TrimSpace(os.Getenv("ADDR"))
	if addr != "" {
		return addr
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port != "" {
		if strings.HasPrefix(port, ":") {
			return port
		}
		return ":" + port
	}
	return ":8080"
}
