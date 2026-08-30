package domain

import (
	"context"

	"github.com/peers-labs/peers-touch/apps/applets/note/service/model"
)

const (
	DefaultPageSize = 20
	MaxPageSize     = 100
)

type ListQuery struct {
	OwnerPTID      string
	PageSize       int32
	PageToken      string
	OrderBy        string
	IncludeDeleted bool
}

type SearchQuery struct {
	OwnerPTID string
	Query     string
	PageSize  int32
	PageToken string
	OrderBy   string
}

type UpdatePatch struct {
	Title   *string
	Content *string
}

type Page struct {
	Items         []*model.Note
	NextPageToken string
}

type Repository interface {
	AutoMigrate(ctx context.Context) error
	Create(ctx context.Context, note *model.Note) (*model.Note, error)
	Get(ctx context.Context, ownerPtid string, noteID string, includeDeleted bool) (*model.Note, error)
	List(ctx context.Context, query ListQuery) (Page, error)
	Update(ctx context.Context, ownerPtid string, noteID string, patch UpdatePatch) (*model.Note, error)
	Delete(ctx context.Context, ownerPtid string, noteID string) (bool, error)
	Restore(ctx context.Context, ownerPtid string, noteID string) (*model.Note, error)
	Search(ctx context.Context, query SearchQuery) (Page, error)
}
