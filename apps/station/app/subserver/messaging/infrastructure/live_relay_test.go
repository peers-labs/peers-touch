package infrastructure

import (
	"context"
	"testing"

	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
)

type liveRelayTestClient struct {
	baseURL string
	token   string
}

func (c liveRelayTestClient) BaseURL() string {
	return c.baseURL
}

func (c liveRelayTestClient) Token() string {
	return c.token
}

func (liveRelayTestClient) Publish(context.Context, string, []byte) error {
	return nil
}

func TestLiveFederationRelayAccessReadsCurrentRuntimeHandle(t *testing.T) {
	nativefed.ClearRelayClient()
	t.Cleanup(nativefed.ClearRelayClient)

	access := NewLiveFederationRelayAccess()
	if access.BaseURL() != "" || access.Token() != "" {
		t.Fatal("relay access must be empty before runtime registration")
	}

	nativefed.RegisterRelayClient(liveRelayTestClient{
		baseURL: "https://relay.example",
		token:   "relay-token-1",
	})
	if access.BaseURL() != "https://relay.example" ||
		access.Token() != "relay-token-1" {
		t.Fatal("relay access did not observe runtime registration")
	}

	nativefed.RegisterRelayClient(liveRelayTestClient{
		baseURL: "https://relay.example",
		token:   "relay-token-2",
	})
	if access.Token() != "relay-token-2" {
		t.Fatal("relay access retained a stale token")
	}

	nativefed.ClearRelayClient()
	if access.BaseURL() != "" || access.Token() != "" {
		t.Fatal("relay access did not observe runtime shutdown")
	}
}
