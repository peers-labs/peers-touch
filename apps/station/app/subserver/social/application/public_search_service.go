package application

import (
	"context"
	"crypto/cipher"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	searchpb "github.com/peers-labs/peers-touch/station/app/model/search"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"gorm.io/gorm"
)

type PublicSearchError struct {
	Code searchpb.SearchErrorCode
}

func (e *PublicSearchError) Error() string { return e.Code.String() }

func publicSearchError(code searchpb.SearchErrorCode) error { return &PublicSearchError{Code: code} }

type PublicSearchService struct {
	repository   *infrastructure.PublicSearchRepository
	cursorCipher cipher.AEAD
}

func NewPublicSearchService(database *gorm.DB) (*PublicSearchService, error) {
	cursorCipher, err := newPublicSearchCursorCipher()
	if err != nil {
		return nil, err
	}
	return &PublicSearchService{
		repository: infrastructure.NewPublicSearchRepository(database), cursorCipher: cursorCipher,
	}, nil
}

func (s *PublicSearchService) readSnapshot(
	ctx context.Context, fn func(*gorm.DB, string) error,
) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err := s.repository.Snapshot(ctx, fn)
	if err == nil {
		return nil
	}
	var searchErr *PublicSearchError
	if errors.As(err, &searchErr) {
		return err
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_TIMEOUT)
	}
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) {
		return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CANCELLED)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "57014" {
		return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_TIMEOUT)
	}
	return publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_UNAVAILABLE)
}

func validatePublicSearchQuery(request *searchpb.QueryIntent) (posts, comments bool, err error) {
	if request == nil || !utf8.ValidString(request.Text) || len(request.Text) > 2048 ||
		strings.TrimSpace(request.Text) == "" || strings.ContainsRune(request.Text, 0) ||
		request.Limit > 100 || len(request.Locale) > 64 || request.Suggestions ||
		request.ConversationId != "" || request.AttachmentNamesOnly ||
		len(request.Kinds) > 10 || len(request.Scopes) > 3 {
		return false, false, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_INVALID_QUERY)
	}
	station := len(request.Scopes) == 0
	for _, scope := range request.Scopes {
		switch scope {
		case searchpb.SearchScope_SEARCH_SCOPE_STATION:
			station = true
		case searchpb.SearchScope_SEARCH_SCOPE_DEVICE:
		default:
			return false, false, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SCOPE_OUTSIDE_SEARCH_DOMAIN)
		}
	}
	if !station {
		return false, false, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SCOPE_OUTSIDE_SEARCH_DOMAIN)
	}
	posts, comments = len(request.Kinds) == 0, len(request.Kinds) == 0
	for _, kind := range request.Kinds {
		if kind < searchpb.SearchKind_SEARCH_KIND_PERSON || kind > searchpb.SearchKind_SEARCH_KIND_SOCIAL_COMMENT {
			return false, false, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_INVALID_QUERY)
		}
		posts = posts || kind == searchpb.SearchKind_SEARCH_KIND_SOCIAL_POST
		comments = comments || kind == searchpb.SearchKind_SEARCH_KIND_SOCIAL_COMMENT
	}
	return posts, comments, nil
}

func (s *PublicSearchService) Query(ctx context.Context, viewer string, request *searchpb.QueryIntent) (*searchpb.SourcePage, error) {
	posts, comments, err := validatePublicSearchQuery(request)
	if err != nil {
		return nil, err
	}
	if viewer == "" {
		return nil, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_PROTOCOL)
	}
	cursor := publicSearchCursor{
		Binding: publicSearchBinding(viewer, request), ExpiresAt: time.Now().Add(5 * time.Minute).UnixMilli(),
	}
	if request.Cursor != "" {
		cursor, err = s.decodeCursor(request.Cursor, cursor.Binding)
		if err != nil {
			return nil, err
		}
	}
	var page *searchpb.SourcePage
	err = s.readSnapshot(ctx, func(tx *gorm.DB, observation string) error {
		var err error
		page, err = s.queryPage(tx.Statement.Context, tx, observation, viewer, request, cursor, posts, comments)
		return err
	})
	if err != nil {
		return nil, err
	}
	return page, nil
}

func (s *PublicSearchService) queryPage(
	ctx context.Context, tx *gorm.DB, observation, viewer string, request *searchpb.QueryIntent,
	cursor publicSearchCursor, posts, comments bool,
) (*searchpb.SourcePage, error) {
	revision := publicSearchHash([]byte(observation))
	if cursor.Observation != "" && cursor.Observation != revision {
		return nil, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_SOURCE_CHANGED)
	}
	if time.Now().UnixMilli() >= cursor.ExpiresAt {
		return nil, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CURSOR_EXPIRED)
	}
	repository := infrastructure.NewPublicSearchRepository(tx)
	positions, more, err := repository.Scan(ctx, posts, comments, cursor.After)
	if err != nil {
		return nil, err
	}
	matches, err := repository.Match(ctx, positions, request.Text)
	if err != nil {
		return nil, err
	}
	postIDs, commentIDs := make([]uint64, 0), make([]uint64, 0)
	for _, position := range positions {
		if matches[position] {
			if position.Kind == "social-post" {
				postIDs = append(postIDs, position.ID)
			} else {
				commentIDs = append(commentIDs, position.ID)
			}
		}
	}
	batch, err := NewPublicReadPort(infrastructure.NewRepos(tx)).Read(ctx, viewer, postIDs, commentIDs)
	if err != nil {
		return nil, err
	}
	page := &searchpb.SourcePage{
		Cache: publicSearchCache(viewer, observation, ""), ExpiresAtUnixMs: cursor.ExpiresAt,
		Coverage: &searchpb.SourceCoverage{
			SourceId: PublicSearchSourceID, State: searchpb.SourceState_SOURCE_STATE_READY,
			Extent:    searchpb.CoverageExtent_COVERAGE_EXTENT_DECLARED_SCOPE,
			DetailKey: "search.coverage.social_public",
		},
	}
	limit := int(request.Limit)
	if limit == 0 {
		limit = 20
	}
	var last infrastructure.PublicSearchPosition
	for index, position := range positions {
		last = position
		if !matches[position] {
			continue
		}
		result := publicSearchResult(batch, position.Kind, position.ID, viewer, observation)
		if result == nil {
			continue
		}
		page.Candidates = append(page.Candidates, &searchpb.SourceCandidate{Resource: result.Resource, SourceRank: 1})
		if len(page.Candidates) == limit {
			more = more || index+1 < len(positions)
			break
		}
	}
	if more {
		page.Coverage.State = searchpb.SourceState_SOURCE_STATE_PARTIAL
		page.Coverage.DetailKey = "search.coverage.social_public_partial"
		cursor.Observation, cursor.After = revision, last
		page.NextCursor, err = s.encodeCursor(cursor)
		if err != nil {
			return nil, err
		}
	}
	if time.Now().UnixMilli() >= cursor.ExpiresAt {
		return nil, publicSearchError(searchpb.SearchErrorCode_SEARCH_ERROR_CODE_CURSOR_EXPIRED)
	}
	return page, nil
}
