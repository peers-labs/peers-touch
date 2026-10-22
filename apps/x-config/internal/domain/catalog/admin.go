package catalog

import (
	"context"
	"errors"
	"time"
)

var (
	ErrDraftNotFound         = errors.New("x_config_draft_not_found")
	ErrDraftConflict         = errors.New("x_config_draft_conflict")
	ErrValidationFailed      = errors.New("x_config_validation_failed")
	ErrPublicationNotFound   = errors.New("x_config_publication_not_found")
	ErrRepositoryUnavailable = errors.New("x_config_repository_unavailable")
)

type Finding struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Owner   string `json:"owner"`
}

type Draft struct {
	Revision      string    `json:"revision"`
	ContentSHA256 string    `json:"content_sha256"`
	Catalog       Catalog   `json:"catalog"`
	LoadedAt      time.Time `json:"loaded_at"`
}

type Publication struct {
	SchemaVersion      int       `json:"schema_version"`
	PublicationID      string    `json:"publication_id"`
	Channel            string    `json:"channel"`
	Sequence           uint64    `json:"sequence"`
	SourceRevision     string    `json:"source_revision"`
	ContentSHA256      string    `json:"content_sha256"`
	SigningKeyID       string    `json:"signing_key_id"`
	StatementSHA256    string    `json:"statement_sha256"`
	EnvelopeSHA256     string    `json:"envelope_sha256"`
	PublishedBy        string    `json:"published_by"`
	PublishedAt        time.Time `json:"published_at"`
	ExpiresAt          time.Time `json:"expires_at"`
	RepositoryRevision string    `json:"repository_revision,omitempty"`
	Catalog            Catalog   `json:"catalog"`
	EnvelopeBytes      []byte    `json:"-"`
}

type PublicationBuilder func(sequence uint64) (Publication, error)

type Repository interface {
	LoadDraft(ctx context.Context, channel string) (*Draft, error)
	LoadDraftAtRevision(
		ctx context.Context,
		channel string,
		revision string,
	) (*Draft, error)
	SaveDraft(
		ctx context.Context,
		baseRevision string,
		draft Draft,
	) (*Draft, error)
	Publish(
		ctx context.Context,
		baseRevision string,
		channel string,
		build PublicationBuilder,
	) (*Publication, error)
	ListPublications(
		ctx context.Context,
		channel string,
		limit int,
	) ([]Publication, error)
	LoadPublishedSnapshot(
		ctx context.Context,
		channel string,
		sequence uint64,
	) (*Publication, error)
}
