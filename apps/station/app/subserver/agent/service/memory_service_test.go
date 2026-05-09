package service

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestMemoryEmbeddingLiteralShape(t *testing.T) {
	provider := NewHashMemoryEmbeddingProvider(defaultMemoryEmbeddingDims)
	vector, err := provider.Embed(context.Background(), "Go backend prefers PostgreSQL and memory retrieval")
	if err != nil {
		t.Fatalf("embedding provider failed: %v", err)
	}
	literal := embeddingVectorLiteral(vector)
	values := strings.Split(strings.Trim(literal, "[]"), ",")
	if len(values) != provider.Dimensions() {
		t.Fatalf("embedding dimension mismatch: got %d want %d", len(values), provider.Dimensions())
	}

	var norm float64
	for _, raw := range values {
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			t.Fatalf("invalid vector component %q: %v", raw, err)
		}
		norm += v * v
	}
	if math.Abs(math.Sqrt(norm)-1) > 0.001 {
		t.Fatalf("embedding should be normalized, got norm %.6f", math.Sqrt(norm))
	}
}

func TestMemoryServiceEmbeddingProviderIsSwappable(t *testing.T) {
	svc := NewMemoryService(nil, WithMemoryEmbeddingProvider(NewHashMemoryEmbeddingProvider(8)))
	if svc.MemoryEmbeddingProvider().Dimensions() != 8 {
		t.Fatalf("expected custom provider dimensions")
	}

	literal, ok := svc.memoryEmbeddingLiteral(context.Background(), "custom provider")
	if !ok {
		t.Fatalf("expected custom provider to produce embedding")
	}
	values := strings.Split(strings.Trim(literal, "[]"), ",")
	if len(values) != 8 {
		t.Fatalf("embedding dimension mismatch: got %d want 8", len(values))
	}
}

func TestProviderMemoryEmbeddingProviderOpenAICompatible(t *testing.T) {
	var gotAuth, gotModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		var body struct {
			Model string `json:"model"`
			Input string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode request: %v", err)
		}
		gotModel = body.Model
		if body.Input != "hello memory" {
			t.Fatalf("unexpected input: %q", body.Input)
		}
		_, _ = w.Write([]byte(`{"data":[{"embedding":[3,4,0]}]}`))
	}))
	defer server.Close()

	provider := NewProviderMemoryEmbeddingProvider("provider-1", "text-embedding-3-small", 3)
	vector, err := provider.callOpenAIEmbedding(context.Background(), server.URL, "test-key", provider.Model(), "hello memory")
	if err != nil {
		t.Fatalf("embedding call failed: %v", err)
	}
	if gotAuth != "Bearer test-key" {
		t.Fatalf("missing authorization header: %q", gotAuth)
	}
	if gotModel != "text-embedding-3-small" {
		t.Fatalf("unexpected model: %q", gotModel)
	}
	if len(vector) != 3 || math.Abs(vector[0]-0.6) > 0.001 || math.Abs(vector[1]-0.8) > 0.001 {
		t.Fatalf("unexpected normalized vector: %#v", vector)
	}
}

func TestGovernMemoryResultsLayerLimits(t *testing.T) {
	results := []domain.ScoredMemory{
		{Memory: domain.MemoryItem{MemoryID: "i1", Layer: domain.MemoryLayerIdentity}, Score: 0.9},
		{Memory: domain.MemoryItem{MemoryID: "i2", Layer: domain.MemoryLayerIdentity}, Score: 0.8},
		{Memory: domain.MemoryItem{MemoryID: "p1", Layer: domain.MemoryLayerPreference}, Score: 0.7},
		{Memory: domain.MemoryItem{MemoryID: "p2", Layer: domain.MemoryLayerPreference}, Score: 0.6},
		{Memory: domain.MemoryItem{MemoryID: "p3", Layer: domain.MemoryLayerPreference}, Score: 0.5},
	}

	governed := governMemoryResults(results, "low", 10)
	if len(governed) != 3 {
		t.Fatalf("low effort should keep 1 identity + 2 preferences, got %d", len(governed))
	}
	if governed[0].Memory.MemoryID != "i1" || governed[1].Memory.MemoryID != "p1" || governed[2].Memory.MemoryID != "p2" {
		t.Fatalf("unexpected governed order: %#v", governed)
	}
}

func TestMemoryDecayFactorReinforcesRecentAccess(t *testing.T) {
	now := time.Now()
	cold := persistence.Memory{
		Layer:     string(domain.MemoryLayerActivity),
		CreatedAt: now.AddDate(0, 0, -30),
	}
	hot := cold
	lastAccessed := now.Add(-time.Hour)
	hot.LastAccessedAt = &lastAccessed
	hot.RetrievalCount = 12

	if memoryDecayFactor(hot, now) <= memoryDecayFactor(cold, now) {
		t.Fatalf("recent accessed memory should decay less than cold memory")
	}
}
