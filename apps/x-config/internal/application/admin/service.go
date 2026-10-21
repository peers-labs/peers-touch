package admin

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	"github.com/peers-labs/peers-touch/x-config/internal/publication"
	"gopkg.in/yaml.v3"
)

const (
	catalogValidationTimeout = 10 * time.Second
	catalogValidationWorkers = 8
)

type Clock interface {
	Now() time.Time
}

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now().UTC() }

type EndpointValidator interface {
	Validate(
		ctx context.Context,
		endpoint catalog.CatalogEndpoint,
	) []catalog.Finding
}

type Service struct {
	Repository       catalog.Repository
	Validator        EndpointValidator
	Signer           publication.Signer
	Clock            Clock
	SnapshotLifetime time.Duration
}

type ValidationResult struct {
	Valid         bool              `json:"valid"`
	ContentSHA256 string            `json:"content_sha256"`
	SourceBytes   []byte            `json:"-"`
	Findings      []catalog.Finding `json:"findings"`
}

func (s Service) LoadDraft(
	ctx context.Context,
	channel string,
) (*catalog.Draft, error) {
	return s.Repository.LoadDraft(ctx, channel)
}

func (s Service) Validate(
	ctx context.Context,
	value catalog.Catalog,
) ValidationResult {
	result := ValidationResult{
		Findings: []catalog.Finding{},
	}
	if s.Clock == nil {
		result.Findings = append(result.Findings, finding(
			"",
			"validation_unavailable",
			"Validation clock is unavailable.",
			"x-config",
		))
		return result
	}
	raw, err := yaml.Marshal(value)
	if err != nil {
		result.Findings = append(result.Findings, finding(
			"",
			"catalog_encoding_invalid",
			"Catalog cannot be encoded.",
			"x-config",
		))
		return result
	}
	result.SourceBytes = raw
	digest := sha256.Sum256(raw)
	result.ContentSHA256 = hex.EncodeToString(digest[:])
	parsed, err := publication.ParseCatalog(raw)
	if err != nil {
		result.Findings = append(result.Findings, finding(
			"",
			"catalog_contract_invalid",
			"Catalog fields do not satisfy the closed schema.",
			"x-config",
		))
		return result
	}
	now := s.Clock.Now().UTC().Truncate(time.Millisecond)
	if _, _, err := publication.BuildStatement(
		parsed,
		1,
		now,
		now.Add(time.Hour),
	); err != nil {
		result.Findings = append(result.Findings, finding(
			"",
			"catalog_trust_invalid",
			"Catalog endpoint consent, trust material, release metadata, or lifetime is invalid.",
			"node-connectivity",
		))
	}
	if s.Validator != nil {
		result.Findings = append(
			result.Findings,
			s.validateEndpoints(ctx, value.Endpoints)...,
		)
	}
	result.Valid = len(result.Findings) == 0
	return result
}

func (s Service) validateEndpoints(
	ctx context.Context,
	endpoints []catalog.CatalogEndpoint,
) []catalog.Finding {
	if len(endpoints) == 0 {
		return nil
	}
	validationCtx, cancel := context.WithTimeout(
		ctx,
		catalogValidationTimeout,
	)
	defer cancel()
	type job struct {
		index    int
		endpoint catalog.CatalogEndpoint
	}
	jobs := make(chan job)
	results := make([][]catalog.Finding, len(endpoints))
	workers := min(catalogValidationWorkers, len(endpoints))
	var group sync.WaitGroup
	group.Add(workers)
	for range workers {
		go func() {
			defer group.Done()
			for item := range jobs {
				findings := s.Validator.Validate(
					validationCtx,
					item.endpoint,
				)
				if len(findings) == 0 && validationCtx.Err() != nil {
					findings = []catalog.Finding{finding(
						"",
						"endpoint_validation_timeout",
						"Endpoint validation exceeded the catalog deadline.",
						"node-connectivity",
					)}
				}
				results[item.index] = normalizeEndpointFindings(
					item.endpoint,
					findings,
				)
			}
		}()
	}
	for index, endpoint := range endpoints {
		jobs <- job{index: index, endpoint: endpoint}
	}
	close(jobs)
	group.Wait()
	var flattened []catalog.Finding
	for _, findings := range results {
		flattened = append(flattened, findings...)
	}
	return flattened
}

func normalizeEndpointFindings(
	endpoint catalog.CatalogEndpoint,
	findings []catalog.Finding,
) []catalog.Finding {
	for index := range findings {
		if findings[index].Field == "" {
			findings[index].Field = "endpoints[" +
				base64.RawURLEncoding.EncodeToString(
					[]byte(endpoint.SeedID),
				) + "]"
		}
		if findings[index].Owner == "" {
			findings[index].Owner = "node-connectivity"
		}
	}
	return findings
}

func (s Service) SaveDraft(
	ctx context.Context,
	baseRevision string,
	value catalog.Catalog,
) (*catalog.Draft, []catalog.Finding, error) {
	validation := s.Validate(ctx, value)
	if !validation.Valid {
		return nil, validation.Findings, catalog.ErrValidationFailed
	}
	draft, err := s.Repository.SaveDraft(
		ctx,
		baseRevision,
		catalog.Draft{
			ContentSHA256: validation.ContentSHA256,
			Catalog:       value,
			LoadedAt:      s.Clock.Now().UTC(),
		},
	)
	return draft, nil, err
}

func (s Service) Publish(
	ctx context.Context,
	channel string,
	baseRevision string,
	acknowledgedDigest string,
	publishedBy string,
) (*catalog.Publication, error) {
	draft, err := s.Repository.LoadDraft(ctx, channel)
	if err != nil {
		return nil, err
	}
	if draft.Revision != baseRevision ||
		draft.ContentSHA256 != acknowledgedDigest ||
		strings.TrimSpace(publishedBy) == "" {
		return nil, catalog.ErrDraftConflict
	}
	if s.Clock == nil || s.Signer == nil {
		return nil, catalog.ErrRepositoryUnavailable
	}
	now := s.Clock.Now().UTC().Truncate(time.Millisecond)
	lifetime := s.SnapshotLifetime
	if lifetime <= 0 {
		lifetime = 24 * time.Hour
	}
	if lifetime > publication.MaxSnapshotLifetime {
		return nil, catalog.ErrValidationFailed
	}
	expiresAt := now.Add(lifetime)
	return s.Repository.Publish(
		ctx,
		baseRevision,
		channel,
		func(sequence uint64) (catalog.Publication, error) {
			_, statementBytes, err := publication.BuildStatement(
				&draft.Catalog,
				sequence,
				now,
				expiresAt,
			)
			if err != nil {
				return catalog.Publication{}, catalog.ErrValidationFailed
			}
			envelopeBytes, err := publication.BuildSignedEnvelope(
				s.Signer,
				statementBytes,
			)
			if err != nil {
				return catalog.Publication{}, catalog.ErrRepositoryUnavailable
			}
			statementDigest := sha256.Sum256(statementBytes)
			envelopeDigest := sha256.Sum256(envelopeBytes)
			return catalog.Publication{
				SchemaVersion:   1,
				PublicationID:   fmt.Sprintf("publication-%020d", sequence),
				Channel:         channel,
				Sequence:        sequence,
				SourceRevision:  baseRevision,
				ContentSHA256:   acknowledgedDigest,
				SigningKeyID:    s.Signer.KeyID(),
				StatementSHA256: hex.EncodeToString(statementDigest[:]),
				EnvelopeSHA256:  hex.EncodeToString(envelopeDigest[:]),
				PublishedBy:     publishedBy,
				PublishedAt:     now,
				ExpiresAt:       expiresAt,
				Catalog:         draft.Catalog,
				EnvelopeBytes:   envelopeBytes,
			}, nil
		},
	)
}

func (s Service) RestoreAsNew(
	ctx context.Context,
	channel string,
	historicalRevision string,
	currentRevision string,
) (*catalog.Draft, []catalog.Finding, error) {
	historical, err := s.Repository.LoadDraftAtRevision(
		ctx,
		channel,
		historicalRevision,
	)
	if err != nil {
		return nil, nil, err
	}
	return s.SaveDraft(ctx, currentRevision, historical.Catalog)
}

func (s Service) ListPublications(
	ctx context.Context,
	channel string,
	limit int,
) ([]catalog.Publication, error) {
	return s.Repository.ListPublications(ctx, channel, limit)
}

func finding(field, code, message, owner string) catalog.Finding {
	return catalog.Finding{
		Field:   field,
		Code:    code,
		Message: message,
		Owner:   owner,
	}
}
