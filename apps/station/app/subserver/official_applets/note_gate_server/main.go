package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	notestation "github.com/peers-labs/peers-touch/apps/applets/note/service/stationadapter"
	notetransport "github.com/peers-labs/peers-touch/apps/applets/note/service/transport"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	gateActorID = "note-real-product-gate-actor"
	noteMount   = "/applets/note"
)

func main() {
	if err := run(context.Background()); err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	secret, err := randomSecret()
	if err != nil {
		return err
	}
	coreauth.Init(coreauth.Config{Secret: secret, AccessTTL: time.Hour})
	provider := coreauth.NewJWTProvider(secret, time.Hour)
	_, token, err := provider.Authenticate(ctx, coreauth.Credentials{
		SubjectID: gateActorID,
		SessionID: "note-real-product-gate-session",
	})
	if err != nil {
		return err
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		return err
	}
	bundle, err := notestation.NewBundle(ctx, db)
	if err != nil {
		return err
	}

	noteHandler := bundle.Mount(noteMount)
	authenticated := httpadapter.RequireJWT(provider)(ctx, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		subject := coreauth.GetSubject(request.Context())
		if subject == nil || strings.TrimSpace(subject.ID) == "" {
			http.Error(response, "authenticated subject is missing", http.StatusUnauthorized)
			return
		}
		request.Header.Set(notetransport.OwnerPTIDHeader, subject.ID)
		noteHandler.ServeHTTP(response, request)
	}))

	mux := http.NewServeMux()
	mux.Handle(noteMount+"/", authenticated)
	mux.HandleFunc("/healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.WriteHeader(http.StatusOK)
		response.Write([]byte(`{"ok":true}`))
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}

	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	errCh := make(chan error, 1)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	ready := map[string]string{
		"baseUrl": "http://" + listener.Addr().String(),
		"token":   token.Value,
	}
	payload, err := json.Marshal(ready)
	if err != nil {
		return err
	}
	os.Stdout.Write(append(payload, '\n'))

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case <-signalCh:
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func randomSecret() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}
