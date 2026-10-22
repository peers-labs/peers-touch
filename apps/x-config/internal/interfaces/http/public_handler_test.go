package httpinterface

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/catalogrepo"
)

func TestPublicSnapshotServesMutableLatestAndImmutableSequence(t *testing.T) {
	repository := catalogrepo.NewMemoryRepository()
	digest := sha256.Sum256([]byte("catalog"))
	draft, err := repository.SaveDraft(
		context.Background(),
		"",
		catalog.Draft{
			ContentSHA256: hex.EncodeToString(digest[:]),
			Catalog: catalog.Catalog{
				SchemaVersion: 1,
				Channel:       "stable",
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	envelope := []byte("signed-envelope")
	envelopeDigest := sha256.Sum256(envelope)
	now := time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)
	published, err := repository.Publish(
		context.Background(),
		draft.Revision,
		"stable",
		func(sequence uint64) (catalog.Publication, error) {
			return catalog.Publication{
				SchemaVersion:   1,
				PublicationID:   "publication-00000000000000000001",
				Channel:         "stable",
				Sequence:        sequence,
				SourceRevision:  draft.Revision,
				ContentSHA256:   hex.EncodeToString(digest[:]),
				SigningKeyID:    "publisher-test",
				StatementSHA256: hex.EncodeToString(digest[:]),
				EnvelopeSHA256:  hex.EncodeToString(envelopeDigest[:]),
				PublishedBy:     "github:subject",
				PublishedAt:     now,
				ExpiresAt:       now.Add(time.Hour),
				Catalog:         draft.Catalog,
				EnvelopeBytes:   envelope,
			}, nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	handler := PublicHandler{Repository: repository}

	latestRequest := httptest.NewRequest(
		http.MethodGet,
		"/channels/stable/latest.pb",
		nil,
	)
	latestResponse := httptest.NewRecorder()
	handler.Snapshot(latestResponse, latestRequest)
	if latestResponse.Code != http.StatusOK ||
		latestResponse.Body.String() != string(envelope) ||
		latestResponse.Header().Get("Content-Type") != "application/protobuf" ||
		latestResponse.Header().Get("Cache-Control") !=
			"public, max-age=300, must-revalidate" {
		t.Fatalf("unexpected latest response: %+v", latestResponse.Result())
	}

	sequenceRequest := httptest.NewRequest(
		http.MethodGet,
		"/snapshots/stable-00000000000000000001.pb",
		nil,
	)
	sequenceResponse := httptest.NewRecorder()
	handler.Snapshot(sequenceResponse, sequenceRequest)
	if sequenceResponse.Code != http.StatusOK ||
		sequenceResponse.Body.String() != string(envelope) ||
		sequenceResponse.Header().Get("Cache-Control") !=
			"public, max-age=31536000, immutable" {
		t.Fatalf("unexpected immutable response: %+v", sequenceResponse.Result())
	}

	notModifiedRequest := httptest.NewRequest(
		http.MethodGet,
		"/api/config?channel=stable",
		nil,
	)
	notModifiedRequest.Header.Set(
		"If-None-Match",
		`"`+published.EnvelopeSHA256+`"`,
	)
	notModifiedResponse := httptest.NewRecorder()
	handler.Snapshot(notModifiedResponse, notModifiedRequest)
	if notModifiedResponse.Code != http.StatusNotModified ||
		notModifiedResponse.Body.Len() != 0 {
		t.Fatalf("unexpected conditional response: %+v", notModifiedResponse.Result())
	}
}
