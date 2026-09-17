package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestPackageCatalogHandlerReturnsExactGeneratedEnvelope(t *testing.T) {
	handler := NewPackageCatalogHandlers()
	response, err := handler.HandleOfficial(
		context.Background(),
		&model.GetOfficialPackageCatalogRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetMediaType() != catalog.OfficialPackageCatalogMediaType {
		t.Fatalf("media type = %q", response.GetMediaType())
	}
	if response.GetDistributionId() != catalog.OfficialPackageCatalogDistributionID {
		t.Fatalf("distribution id = %q", response.GetDistributionId())
	}
	expected := catalog.OfficialPackageCatalogEnvelope()
	if !bytes.Equal(response.GetEnvelopeJson(), expected) {
		t.Fatal("handler changed the generated catalog envelope")
	}
	digest := sha256.Sum256(response.GetEnvelopeJson())
	if got := hex.EncodeToString(digest[:]); got != response.GetEnvelopeSha256() {
		t.Fatalf("response digest = %s, want %s", response.GetEnvelopeSha256(), got)
	}

	response.EnvelopeJson[0] ^= 0xff
	second, err := handler.HandleOfficial(
		context.Background(),
		&model.GetOfficialPackageCatalogRequest{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(response.GetEnvelopeJson(), second.GetEnvelopeJson()) {
		t.Fatal("handler responses must not share mutable envelope bytes")
	}
}
