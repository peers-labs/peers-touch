package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/peers-labs/peers-touch/x-config/internal/bootstrap"
)

func main() {
	container, err := bootstrap.BuildFromEnvironment()
	if err != nil {
		log.Fatalf("build X Config failed: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/admin/auth/start", container.Auth.Start)
	mux.HandleFunc("/api/admin/auth/callback", container.Auth.Callback)
	mux.HandleFunc("/api/admin/auth/session", container.Auth.Session)
	mux.HandleFunc("/api/admin/auth/logout", container.Auth.Logout)
	mux.HandleFunc("/api/admin/catalog", container.Admin.Catalog)
	mux.HandleFunc("/api/admin/catalog/validate", container.Admin.ValidateCatalog)
	mux.HandleFunc("/api/admin/catalog/restore", container.Admin.Restore)
	mux.HandleFunc("/api/admin/publications", container.Admin.Publications)
	mux.HandleFunc("/api/config", container.Public.Snapshot)
	mux.HandleFunc("/channels/", container.Public.Snapshot)
	mux.HandleFunc("/snapshots/", container.Public.Snapshot)
	log.Fatal(http.ListenAndServe(listenAddress(), mux))
}

func listenAddress() string {
	if value := strings.TrimSpace(os.Getenv("ADDR")); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("PORT")); value != "" {
		if strings.HasPrefix(value, ":") {
			return value
		}
		return ":" + value
	}
	return ":8080"
}
