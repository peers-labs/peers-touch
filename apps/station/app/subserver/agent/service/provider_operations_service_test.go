package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestProviderDiscoveryUsesSDKAndPreservesUnknownCapabilities(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/api/v3/models" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("unexpected discovery path or authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"object":"list","data":[{"id":"z-model","object":"model"},{"id":"a-model","object":"model"},{"id":"a-model","object":"model"}]}`)
	}))
	defer upstream.Close()
	operations := NewProviderOperationsService(nil, nil, nil)
	result, err := operations.discoverHTTP(context.Background(), "openai-compatible", upstream.URL+"/api/v3", "test-key")
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 2 || result[0].Id != "a-model" || result[1].Id != "z-model" || requests.Load() != 1 {
		t.Fatalf("unexpected discovery result: %v", result)
	}
	for _, entry := range result {
		if entry.Enabled || entry.ContextWindow != 0 || entry.Capabilities != nil || entry.Type != "" {
			t.Fatalf("discovery invented runtime metadata: %v", entry)
		}
	}
}

func TestProviderDiscoveryDoesNotRetryOrFollowCredentialRedirect(t *testing.T) {
	for _, status := range []int{401, 429, 307} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var requests atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("Location", "/other")
				w.WriteHeader(status)
				fmt.Fprint(w, `{"error":{"message":"rejected"}}`)
			}))
			defer upstream.Close()
			operations := NewProviderOperationsService(nil, nil, nil)
			_, err := operations.discoverHTTP(context.Background(), "openai", upstream.URL, "test-key")
			if err == nil || requests.Load() != 1 {
				t.Fatalf("error=%v requests=%d", err, requests.Load())
			}
		})
	}
}

func TestProviderDiscoveryCancellationReachesUpstream(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(cancelled)
	}))
	t.Cleanup(func() { upstream.CloseClientConnections(); upstream.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	operations := NewProviderOperationsService(nil, nil, nil)
	go func() {
		_, err := operations.discoverHTTP(ctx, "openai", upstream.URL, "test-key")
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("upstream continued after cancellation")
	}
}

func TestProviderDiscoveryUsesAnthropicSDKPagination(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.URL.Path != "/v1/models" || r.Header.Get("X-Api-Key") != "test-key" {
			t.Errorf("unexpected Anthropic discovery request")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("after_id") == "" {
			fmt.Fprint(w, `{"data":[{"id":"model-one","display_name":"One","type":"model"}],"has_more":true,"last_id":"model-one","first_id":"model-one"}`)
		} else {
			fmt.Fprint(w, `{"data":[{"id":"model-two","display_name":"Two","type":"model"}],"has_more":false,"last_id":"model-two","first_id":"model-two"}`)
		}
	}))
	defer upstream.Close()
	operations := NewProviderOperationsService(nil, nil, nil)
	found, err := operations.discoverHTTP(context.Background(), "anthropic", upstream.URL, "test-key")
	if err != nil || len(found) != 2 || requests.Load() != 2 {
		t.Fatalf("pagination: count=%d requests=%d err=%v", len(found), requests.Load(), err)
	}
}

func TestProviderCheckUsesActorAdmissionAndRejectsChangedConfiguration(t *testing.T) {
	db := openAdmissionTestDB(t, "provider-check-source")
	t.Cleanup(setupTestCatalog())
	var requests atomic.Int32
	changeConfiguration := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if changeConfiguration {
			db.Model(&persistence.AgentProvider{}).Where("actor_ptid = ?", "actor-1").Update("version", 2)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"model":"test-model","choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1}}`)
	}))
	defer upstream.Close()
	provider := persistence.AgentProvider{
		ID: "private-provider-record", Name: "test-provider", ActorPTID: "actor-1",
		BaseURL: upstream.URL, KeyVaults: `{"api_key":"test-key"}`,
		Enabled: true, RuntimeKind: "http", Protocol: "openai-compatible", Version: 1,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatal(err)
	}
	config := NewProviderConfigService()
	operations := NewProviderOperationsService(config, NewRuntimeAdmissionResolver(config, NewModelConfigService()), NewProviderService(nil))
	request := &model.CheckProviderRequest{ProviderId: "test-provider", Version: 1, ModelId: "test-model"}
	if _, err := operations.Check(context.Background(), "actor-2", request); err == nil || requests.Load() != 0 {
		t.Fatal("foreign actor accessed a private provider")
	}
	connected, err := operations.Check(context.Background(), "actor-1", request)
	if err != nil || !connected.GetConnected() || connected.GetObservedAt() == nil {
		t.Fatalf("actual completion probe failed: %v %v", connected, err)
	}
	changeConfiguration = true
	connected, err = operations.Check(context.Background(), "actor-1", request)
	var business *errcode.BizError
	if connected != nil || !errors.As(err, &business) || business.HTTPStatus != http.StatusConflict {
		t.Fatalf("stale result admitted: %v %v", connected, err)
	}
	if _, err := operations.Check(context.Background(), "actor-1", request); err == nil || requests.Load() != 2 {
		t.Fatal("stale request reached the provider")
	}
}
