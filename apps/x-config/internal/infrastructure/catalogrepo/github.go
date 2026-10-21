package catalogrepo

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	githubrepository "github.com/peers-labs/peers-touch/github-repository"
	xconfig "github.com/peers-labs/peers-touch/station/frame/touch/model/xconfig"
	"github.com/peers-labs/peers-touch/x-config/internal/domain/catalog"
	publicationpkg "github.com/peers-labs/peers-touch/x-config/internal/publication"
	"google.golang.org/protobuf/proto"
	"gopkg.in/yaml.v3"
)

type GitRepository struct {
	client *githubrepository.Client
	clock  func() time.Time
}

func NewGitRepository(client *githubrepository.Client) (*GitRepository, error) {
	if client == nil {
		return nil, errors.New("invalid_catalog_repository")
	}
	return &GitRepository{
		client: client,
		clock:  func() time.Time { return time.Now().UTC() },
	}, nil
}

func (r *GitRepository) LoadDraft(
	ctx context.Context,
	channel string,
) (*catalog.Draft, error) {
	snapshot, err := r.client.Snapshot(ctx)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	return r.loadDraftFromSnapshot(ctx, snapshot, channel)
}

func (r *GitRepository) LoadDraftAtRevision(
	ctx context.Context,
	channel string,
	revision string,
) (*catalog.Draft, error) {
	snapshot, err := r.client.SnapshotAtCommit(ctx, revision)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	return r.loadDraftFromSnapshot(ctx, snapshot, channel)
}

func (r *GitRepository) SaveDraft(
	ctx context.Context,
	baseRevision string,
	draft catalog.Draft,
) (*catalog.Draft, error) {
	raw, err := yaml.Marshal(draft.Catalog)
	if err != nil {
		return nil, catalog.ErrValidationFailed
	}
	if _, err := publicationpkg.ParseCatalog(raw); err != nil {
		return nil, catalog.ErrValidationFailed
	}
	digest := sha256.Sum256(raw)
	if draft.ContentSHA256 != hex.EncodeToString(digest[:]) {
		return nil, catalog.ErrValidationFailed
	}
	revision, err := r.client.UpdateRevision(
		ctx,
		"x-config: save "+draft.Catalog.Channel+" catalog",
		func(snapshot *githubrepository.Snapshot) (map[string][]byte, error) {
			existing, found, err := snapshot.Read(
				ctx,
				catalogPath(draft.Catalog.Channel),
			)
			if err != nil {
				return nil, err
			}
			noOp, err := resolveDraftWrite(
				baseRevision,
				snapshot.Revision(),
				found,
				existing,
				raw,
			)
			if err != nil {
				return nil, catalog.ErrDraftConflict
			}
			if noOp {
				return map[string][]byte{}, nil
			}
			return map[string][]byte{
				catalogPath(draft.Catalog.Channel): raw,
			}, nil
		},
	)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	draft.Revision = revision
	draft.LoadedAt = r.clock()
	return &draft, nil
}

func resolveDraftWrite(
	baseRevision string,
	snapshotRevision string,
	found bool,
	existing []byte,
	next []byte,
) (bool, error) {
	if snapshotRevision == baseRevision {
		return false, nil
	}
	if found && bytes.Equal(existing, next) {
		return true, nil
	}
	if baseRevision == "" && !found {
		return false, nil
	}
	return false, catalog.ErrDraftConflict
}

func (r *GitRepository) Publish(
	ctx context.Context,
	baseRevision string,
	channel string,
	build catalog.PublicationBuilder,
) (*catalog.Publication, error) {
	if !validChannel(channel) || build == nil {
		return nil, catalog.ErrValidationFailed
	}
	var published catalog.Publication
	revision, err := r.client.UpdateRevision(
		ctx,
		"x-config: publish "+channel,
		func(snapshot *githubrepository.Snapshot) (map[string][]byte, error) {
			if snapshot.Revision() != baseRevision {
				existing, matched, err := r.matchPublishedRetry(
					ctx,
					snapshot,
					baseRevision,
					channel,
					build,
				)
				if err != nil {
					return nil, err
				}
				if !matched {
					return nil, catalog.ErrDraftConflict
				}
				published = *existing
				return map[string][]byte{}, nil
			}
			sequence := uint64(1)
			currentRaw, found, err := snapshot.Read(
				ctx,
				publicationCurrentPath(channel),
			)
			if err != nil {
				return nil, err
			}
			if found {
				current, err := decodePublication(currentRaw)
				if err != nil || current.Channel != channel {
					return nil, catalog.ErrRepositoryUnavailable
				}
				sequence = current.Sequence + 1
			}
			next, err := build(sequence)
			if err != nil {
				return nil, err
			}
			if !validPublication(next, baseRevision, channel, sequence) {
				return nil, catalog.ErrValidationFailed
			}
			if len(next.EnvelopeBytes) == 0 {
				return nil, catalog.ErrValidationFailed
			}
			envelopeDigest := sha256.Sum256(next.EnvelopeBytes)
			if next.EnvelopeSHA256 != hex.EncodeToString(envelopeDigest[:]) {
				return nil, catalog.ErrValidationFailed
			}
			record := next
			record.RepositoryRevision = ""
			record.EnvelopeBytes = nil
			recordRaw, err := json.Marshal(record)
			if err != nil {
				return nil, catalog.ErrValidationFailed
			}
			published = clonePublication(next)
			return map[string][]byte{
				publicationCurrentPath(channel):            recordRaw,
				publicationSequencePath(channel, sequence): recordRaw,
				snapshotPath(channel, sequence):            next.EnvelopeBytes,
			}, nil
		},
	)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	published.RepositoryRevision = revision
	return &published, nil
}

func (r *GitRepository) ListPublications(
	ctx context.Context,
	channel string,
	limit int,
) ([]catalog.Publication, error) {
	if !validChannel(channel) {
		return nil, catalog.ErrValidationFailed
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	snapshot, err := r.client.Snapshot(ctx)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	paths := snapshot.Paths(publicationRoot(channel))
	paths = filterPublicationSequencePaths(paths)
	sort.Sort(sort.Reverse(sort.StringSlice(paths)))
	if len(paths) > limit {
		paths = paths[:limit]
	}
	publications := make([]catalog.Publication, 0, len(paths))
	for _, path := range paths {
		raw, found, err := snapshot.Read(ctx, path)
		if err != nil {
			return nil, mapRepositoryError(err)
		}
		if !found {
			return nil, catalog.ErrRepositoryUnavailable
		}
		publication, err := decodePublication(raw)
		if err != nil || publication.Channel != channel {
			return nil, catalog.ErrRepositoryUnavailable
		}
		publications = append(publications, publication)
	}
	return publications, nil
}

func (r *GitRepository) LoadPublishedSnapshot(
	ctx context.Context,
	channel string,
	sequence uint64,
) (*catalog.Publication, error) {
	if !validChannel(channel) {
		return nil, catalog.ErrValidationFailed
	}
	snapshot, err := r.client.Snapshot(ctx)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	recordPath := publicationCurrentPath(channel)
	if sequence != 0 {
		recordPath = publicationSequencePath(channel, sequence)
	}
	raw, found, err := snapshot.Read(ctx, recordPath)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	if !found {
		return nil, catalog.ErrPublicationNotFound
	}
	publication, err := decodePublication(raw)
	if err != nil ||
		publication.Channel != channel ||
		(sequence != 0 && publication.Sequence != sequence) {
		return nil, catalog.ErrRepositoryUnavailable
	}
	envelope, found, err := snapshot.Read(
		ctx,
		snapshotPath(channel, publication.Sequence),
	)
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	if !found {
		return nil, catalog.ErrRepositoryUnavailable
	}
	digest := sha256.Sum256(envelope)
	if publication.EnvelopeSHA256 != hex.EncodeToString(digest[:]) ||
		!validEnvelope(publication, envelope) {
		return nil, catalog.ErrRepositoryUnavailable
	}
	publication.EnvelopeBytes = envelope
	return &publication, nil
}

func (r *GitRepository) matchPublishedRetry(
	ctx context.Context,
	snapshot *githubrepository.Snapshot,
	baseRevision string,
	channel string,
	build catalog.PublicationBuilder,
) (*catalog.Publication, bool, error) {
	raw, found, err := snapshot.Read(ctx, publicationCurrentPath(channel))
	if err != nil || !found {
		return nil, false, err
	}
	existing, err := decodePublication(raw)
	if err != nil || existing.SourceRevision != baseRevision {
		return nil, false, err
	}
	expected, err := build(existing.Sequence)
	if err != nil {
		return nil, false, err
	}
	envelope, found, err := snapshot.Read(
		ctx,
		snapshotPath(channel, existing.Sequence),
	)
	if err != nil || !found {
		return nil, false, err
	}
	if !samePublication(existing, expected) ||
		!bytes.Equal(envelope, expected.EnvelopeBytes) {
		return nil, false, nil
	}
	existing.EnvelopeBytes = envelope
	existing.RepositoryRevision = snapshot.Revision()
	return &existing, true, nil
}

func (r *GitRepository) loadDraftFromSnapshot(
	ctx context.Context,
	snapshot *githubrepository.Snapshot,
	channel string,
) (*catalog.Draft, error) {
	if !validChannel(channel) {
		return nil, catalog.ErrValidationFailed
	}
	raw, found, err := snapshot.Read(ctx, catalogPath(channel))
	if err != nil {
		return nil, mapRepositoryError(err)
	}
	if !found {
		return nil, catalog.ErrDraftNotFound
	}
	parsed, err := publicationpkg.ParseCatalog(raw)
	if err != nil || parsed.Channel != channel {
		return nil, catalog.ErrRepositoryUnavailable
	}
	digest := sha256.Sum256(raw)
	return &catalog.Draft{
		Revision:      snapshot.Revision(),
		ContentSHA256: hex.EncodeToString(digest[:]),
		Catalog:       *parsed,
		LoadedAt:      r.clock(),
	}, nil
}

func catalogPath(channel string) string {
	return "x-config/catalogs/" + channel + ".yaml"
}

func publicationRoot(channel string) string {
	return "x-config/publications/" + channel + "/"
}

func publicationCurrentPath(channel string) string {
	return publicationRoot(channel) + "current.json"
}

func publicationSequencePath(channel string, sequence uint64) string {
	return publicationRoot(channel) + fmt.Sprintf("%020d.json", sequence)
}

func snapshotPath(channel string, sequence uint64) string {
	return "x-config/snapshots/" + channel + "/" +
		fmt.Sprintf("%020d.pb", sequence)
}

func filterPublicationSequencePaths(paths []string) []string {
	filtered := make([]string, 0, len(paths))
	for _, recordPath := range paths {
		name := strings.TrimSuffix(path.Base(recordPath), ".json")
		if len(name) == 20 && allDecimalDigits(name) {
			filtered = append(filtered, recordPath)
		}
	}
	return filtered
}

func allDecimalDigits(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return value != ""
}

func decodePublication(raw []byte) (catalog.Publication, error) {
	var publication catalog.Publication
	if err := json.Unmarshal(raw, &publication); err != nil ||
		!validPublication(
			publication,
			publication.SourceRevision,
			publication.Channel,
			publication.Sequence,
		) {
		return catalog.Publication{}, catalog.ErrRepositoryUnavailable
	}
	catalogRaw, err := yaml.Marshal(publication.Catalog)
	if err != nil {
		return catalog.Publication{}, catalog.ErrRepositoryUnavailable
	}
	parsed, err := publicationpkg.ParseCatalog(catalogRaw)
	if err != nil || parsed.Channel != publication.Channel {
		return catalog.Publication{}, catalog.ErrRepositoryUnavailable
	}
	digest := sha256.Sum256(catalogRaw)
	if publication.ContentSHA256 != hex.EncodeToString(digest[:]) {
		return catalog.Publication{}, catalog.ErrRepositoryUnavailable
	}
	return publication, nil
}

func samePublication(
	left catalog.Publication,
	right catalog.Publication,
) bool {
	left.RepositoryRevision = ""
	left.EnvelopeBytes = nil
	right.RepositoryRevision = ""
	right.EnvelopeBytes = nil
	leftRaw, leftErr := json.Marshal(left)
	rightRaw, rightErr := json.Marshal(right)
	return leftErr == nil &&
		rightErr == nil &&
		bytes.Equal(leftRaw, rightRaw)
}

func validEnvelope(
	publication catalog.Publication,
	envelopeBytes []byte,
) bool {
	envelopeDigest := sha256.Sum256(envelopeBytes)
	if publication.EnvelopeSHA256 != hex.EncodeToString(envelopeDigest[:]) {
		return false
	}
	var envelope xconfig.SignedXConfigSnapshot
	if err := proto.Unmarshal(envelopeBytes, &envelope); err != nil {
		return false
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(&envelope)
	if err != nil ||
		!bytes.Equal(canonical, envelopeBytes) ||
		envelope.GetSigningKeyId() != publication.SigningKeyID ||
		len(envelope.GetEd25519Signature()) != ed25519.SignatureSize {
		return false
	}
	statementDigest := sha256.Sum256(envelope.GetStatementBytes())
	return publication.StatementSHA256 ==
		hex.EncodeToString(statementDigest[:])
}

func validPublication(
	publication catalog.Publication,
	sourceRevision string,
	channel string,
	sequence uint64,
) bool {
	return publication.SchemaVersion == 1 &&
		publication.PublicationID == fmt.Sprintf(
			"publication-%020d",
			sequence,
		) &&
		publication.Channel == channel &&
		publication.Sequence == sequence &&
		publication.SourceRevision == sourceRevision &&
		strings.TrimSpace(publication.SourceRevision) != "" &&
		validSHA256Hex(publication.ContentSHA256) &&
		strings.TrimSpace(publication.SigningKeyID) != "" &&
		validSHA256Hex(publication.StatementSHA256) &&
		validSHA256Hex(publication.EnvelopeSHA256) &&
		strings.TrimSpace(publication.PublishedBy) != "" &&
		!publication.PublishedAt.IsZero() &&
		publication.ExpiresAt.After(publication.PublishedAt) &&
		publication.Catalog.Channel == channel
}

func validSHA256Hex(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil &&
		len(decoded) == sha256.Size &&
		value == strings.ToLower(value)
}

func validChannel(channel string) bool {
	return channel != "" &&
		len(channel) <= 32 &&
		channel == strings.TrimSpace(channel) &&
		!strings.ContainsAny(channel, "/\\ \t\r\n")
}

func mapRepositoryError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, catalog.ErrDraftConflict):
		return catalog.ErrDraftConflict
	case errors.Is(err, catalog.ErrValidationFailed):
		return catalog.ErrValidationFailed
	case errors.Is(err, githubrepository.ErrConflict):
		return catalog.ErrDraftConflict
	default:
		return catalog.ErrRepositoryUnavailable
	}
}
