package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/option"
	relayclient "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay-client"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type request struct {
	RelayURL             string `json:"relay_url"`
	RelayStreamAddr      string `json:"relay_stream_addr"`
	BootstrapInfoURL     string `json:"bootstrap_info_url"`
	BootstrapIdentityURL string `json:"bootstrap_identity_url"`
	InviteToken          string `json:"invite_token"`
	TokenStorePath       string `json:"token_store_path"`
	TimeoutSeconds       int    `json:"timeout_seconds"`
}

type response struct {
	Status           string `json:"status"`
	CredentialCached bool   `json:"credential_cached"`
}

func main() {
	var input request
	decoder := json.NewDecoder(os.Stdin)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		fail("invalid probe input")
	}
	if strings.TrimSpace(input.InviteToken) == "" ||
		strings.TrimSpace(input.TokenStorePath) == "" {
		fail("probe requires enrollment material")
	}
	timeout := time.Duration(input.TimeoutSeconds) * time.Second
	if timeout <= 0 || timeout > 90*time.Second {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	subserver := relayclient.NewRelayClientSubServer(
		option.WithRootCtx(ctx),
		relayclient.WithEnabled(true),
		relayclient.WithRelayURL(input.RelayURL),
		relayclient.WithRelayStreamAddr(input.RelayStreamAddr),
		relayclient.WithInviteToken(input.InviteToken),
		relayclient.WithLabel("acceptance-relay-client"),
		relayclient.WithLocalHTTPPort(1),
		relayclient.WithLocalHTTPTimeoutSec(1),
		relayclient.WithBootstrapInfoURL(input.BootstrapInfoURL),
		relayclient.WithBootstrapIdentityURL(input.BootstrapIdentityURL),
		relayclient.WithTokenStorePath(input.TokenStorePath),
		relayclient.WithUseTLS(true),
		relayclient.WithTLSInsecureSkipVerify(true),
		relayclient.WithHeartbeatIntervalSec(1),
		relayclient.WithCredentialRefreshIntervalSec(300),
	)
	if err := subserver.Init(ctx); err != nil {
		fail("relay-client init failed")
	}
	if err := subserver.Start(ctx); err != nil {
		fail("relay-client start failed")
	}
	defer func() {
		_ = subserver.Stop(context.Background())
	}()

	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		switch subserver.Status() {
		case server.StatusRunning:
			info, err := os.Stat(input.TokenStorePath)
			if err != nil || info.Size() == 0 {
				fail("relay-client became ready without a cached credential")
			}
			payload, err := json.Marshal(response{
				Status:           string(server.StatusRunning),
				CredentialCached: true,
			})
			if err != nil {
				fail("encode probe result failed")
			}
			_, _ = fmt.Fprintf(
				os.Stdout,
				"PT_RELAY_CLIENT_PROBE=%s\n",
				payload,
			)
			return
		case server.StatusError:
			fail("relay-client entered error state")
		}
		select {
		case <-ctx.Done():
			fail("relay-client readiness timed out")
		case <-ticker.C:
		}
	}
}

func fail(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
