package admin

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"

	peer "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"github.com/peers-labs/peers-touch/x-config/internal/infrastructure/catalogrepo"
	"github.com/peers-labs/peers-touch/x-config/internal/publication"
	"google.golang.org/protobuf/proto"
)

func TestAdminDraftPublicationAndRestoreUseCAS(t *testing.T) {
	now := time.Date(
		2026,
		10,
		18,
		19,
		0,
		0,
		123_456_789,
		time.UTC,
	)
	repository := catalogrepo.NewMemoryRepository()
	privateKey := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	signer, err := publication.NewEd25519Signer("publisher-test", privateKey)
	if err != nil {
		t.Fatal(err)
	}
	service := Service{
		Repository: repository,
		Clock:      adminClock{now: now},
		Signer:     signer,
	}
	firstCatalog := validCatalog(t, now, "Public Relay")
	first, findings, err := service.SaveDraft(
		context.Background(),
		"",
		firstCatalog,
	)
	if err != nil || len(findings) != 0 {
		t.Fatalf("save first draft: draft=%+v findings=%+v err=%v", first, findings, err)
	}
	if _, _, err := service.SaveDraft(
		context.Background(),
		"stale-revision",
		firstCatalog,
	); !errors.Is(err, catalog.ErrDraftConflict) {
		t.Fatalf("stale draft write was accepted: %v", err)
	}
	if _, err := service.Publish(
		context.Background(),
		"stable",
		first.Revision,
		"wrong-digest",
		"github:subject-42",
	); !errors.Is(err, catalog.ErrDraftConflict) {
		t.Fatalf("unacknowledged diff was accepted: %v", err)
	}
	published, err := service.Publish(
		context.Background(),
		"stable",
		first.Revision,
		first.ContentSHA256,
		"github:subject-42",
	)
	if err != nil {
		t.Fatalf("publish catalog: %v", err)
	}
	if published.Sequence != 1 ||
		published.SourceRevision != first.Revision ||
		published.RepositoryRevision == first.Revision {
		t.Fatalf("unexpected publication: %+v", published)
	}
	var envelope xconfig.SignedXConfigSnapshot
	if err := proto.Unmarshal(published.EnvelopeBytes, &envelope); err != nil {
		t.Fatalf("decode published envelope: %v", err)
	}
	signingInput := append(
		[]byte(publication.SnapshotSignatureDomain),
		envelope.GetStatementBytes()...,
	)
	if envelope.GetSigningKeyId() != signer.KeyID() ||
		!ed25519.Verify(
			privateKey.Public().(ed25519.PublicKey),
			signingInput,
			envelope.GetEd25519Signature(),
		) {
		t.Fatal("published envelope signature is invalid")
	}
	var statement xconfig.XConfigSnapshotStatement
	if err := proto.Unmarshal(envelope.GetStatementBytes(), &statement); err != nil {
		t.Fatalf("decode published statement: %v", err)
	}
	if statement.GetIssuedAt().GetNanos()%1_000_000 != 0 ||
		statement.GetExpiresAt().GetNanos()%1_000_000 != 0 {
		t.Fatalf(
			"published timestamps are not millisecond canonical: issued=%v expires=%v",
			statement.GetIssuedAt(),
			statement.GetExpiresAt(),
		)
	}
	publications, err := service.ListPublications(
		context.Background(),
		"stable",
		10,
	)
	if err != nil || len(publications) != 1 {
		t.Fatalf("list publications: %+v err=%v", publications, err)
	}
	readback, err := repository.LoadPublishedSnapshot(
		context.Background(),
		"stable",
		0,
	)
	if err != nil ||
		readback.EnvelopeSHA256 != published.EnvelopeSHA256 ||
		!proto.Equal(&envelope, mustEnvelope(t, readback.EnvelopeBytes)) {
		t.Fatalf("published readback mismatch: %+v err=%v", readback, err)
	}

	secondCatalog := validCatalog(t, now, "Changed Relay")
	second, _, err := service.SaveDraft(
		context.Background(),
		published.RepositoryRevision,
		secondCatalog,
	)
	if err != nil {
		t.Fatalf("save second draft: %v", err)
	}
	restored, findings, err := service.RestoreAsNew(
		context.Background(),
		"stable",
		first.Revision,
		second.Revision,
	)
	if err != nil || len(findings) != 0 {
		t.Fatalf("restore as new: findings=%+v err=%v", findings, err)
	}
	if restored.Revision == first.Revision ||
		restored.Revision == second.Revision ||
		restored.Catalog.Endpoints[0].DisplayName != "Public Relay" {
		t.Fatalf("restore did not allocate a new revision: %+v", restored)
	}
}

func mustEnvelope(
	t *testing.T,
	raw []byte,
) *xconfig.SignedXConfigSnapshot {
	t.Helper()
	var value xconfig.SignedXConfigSnapshot
	if err := proto.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	return &value
}

func TestAdminValidationPreservesOwnerFindings(t *testing.T) {
	now := time.Date(2026, 10, 18, 19, 0, 0, 0, time.UTC)
	service := Service{
		Repository: catalogrepo.NewMemoryRepository(),
		Validator: validationStub{findings: []catalog.Finding{
			{
				Field:   "connection_material_base64",
				Code:    "endpoint_identity_invalid",
				Message: "Identity mismatch.",
				Owner:   "node-connectivity",
			},
		}},
		Clock: adminClock{now: now},
	}
	result := service.Validate(
		context.Background(),
		validCatalog(t, now, "Public Relay"),
	)
	if result.Valid ||
		len(result.Findings) != 1 ||
		result.Findings[0].Owner != "node-connectivity" {
		t.Fatalf("owner finding was not preserved: %+v", result)
	}
}

func TestAdminValidationEncodesNoFindingsAsArray(t *testing.T) {
	now := time.Date(2026, 10, 19, 11, 0, 0, 0, time.UTC)
	service := Service{
		Repository: catalogrepo.NewMemoryRepository(),
		Clock:      adminClock{now: now},
	}
	result := service.Validate(
		context.Background(),
		catalog.Catalog{
			SchemaVersion: 1,
			Channel:       "stable",
		},
	)
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Findings []catalog.Finding `json:"findings"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Findings == nil {
		t.Fatalf("successful validation did not encode findings as []: %s", raw)
	}
}

func validCatalog(
	t *testing.T,
	now time.Time,
	displayName string,
) catalog.Catalog {
	t.Helper()
	material := &peer.PublicEndpointConnectionMaterial{
		SchemaVersion:            1,
		CanonicalDiscoveryOrigin: "https://relay.example:443",
		ExpectedEndpointRole:     peer.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY,
		ExpectedEndpointIdentity: "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW",
		IssuedAtUnixMs:           now.Add(-time.Minute).UnixMilli(),
		ExpiresAtUnixMs:          now.Add(24 * time.Hour).UnixMilli(),
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(material)
	if err != nil {
		t.Fatal(err)
	}
	return catalog.Catalog{
		SchemaVersion: 1,
		Channel:       "stable",
		Endpoints: []catalog.CatalogEndpoint{
			{
				SeedID:                   "relay-public",
				Kind:                     "relay",
				DisplayName:              displayName,
				ConnectionMaterialBase64: base64.StdEncoding.EncodeToString(raw),
				Regions:                  []string{"global"},
				AvailableUntil: now.Add(time.Hour).Format(
					time.RFC3339,
				),
			},
		},
	}
}

type adminClock struct {
	now time.Time
}

func (c adminClock) Now() time.Time {
	return c.now
}

type validationStub struct {
	findings []catalog.Finding
}

func (v validationStub) Validate(
	_ context.Context,
	_ catalog.CatalogEndpoint,
) []catalog.Finding {
	return append([]catalog.Finding(nil), v.findings...)
}
