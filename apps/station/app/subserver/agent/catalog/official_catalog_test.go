package catalog

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOfficialPackageCatalogProjectionMatchesCanonicalAsset(t *testing.T) {
	root := repositoryRoot(t)
	canonicalPath := filepath.Join(
		root,
		"packages",
		"agent-catalog",
		"official-catalog.v1.envelope.json",
	)
	canonical, err := os.ReadFile(canonicalPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical) == 0 || len(canonical) > MaxOfficialPackageCatalogBytes {
		t.Fatalf("canonical catalog size = %d", len(canonical))
	}
	if !bytes.Equal(canonical, OfficialPackageCatalogEnvelope()) {
		t.Fatal("Station catalog projection differs from the canonical envelope")
	}
	digest := sha256.Sum256(canonical)
	if got := hex.EncodeToString(digest[:]); got != OfficialPackageCatalogEnvelopeSHA256 {
		t.Fatalf("catalog digest = %s, want %s", got, OfficialPackageCatalogEnvelopeSHA256)
	}
	var envelope struct {
		SchemaVersion string `json:"schemaVersion"`
	}
	if err := json.Unmarshal(canonical, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.SchemaVersion != "peers.package-catalog.envelope.v1" {
		t.Fatalf("catalog schema = %q", envelope.SchemaVersion)
	}
	if _, err := os.Stat(filepath.Join(
		root,
		"apps",
		"desktop",
		"src-tauri",
		"src",
		"application",
		"skills_market",
		"official-catalog.v1.envelope.json",
	)); !os.IsNotExist(err) {
		t.Fatal("Desktop-local official catalog copy must not exist")
	}
}

func TestOfficialPackageCatalogEnvelopeReturnsIndependentBytes(t *testing.T) {
	first := OfficialPackageCatalogEnvelope()
	second := OfficialPackageCatalogEnvelope()
	first[0] ^= 0xff
	if bytes.Equal(first, second) {
		t.Fatal("catalog envelope callers must not share mutable bytes")
	}
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	current, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(current, "packages", "agent-catalog")); err == nil {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			t.Fatal("repository root not found")
		}
		current = parent
	}
}
