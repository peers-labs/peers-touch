package application

import (
	"context"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/domain"
	"github.com/peers-labs/peers-touch/apps/applets/note/service/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Clock func() time.Time

type Service struct {
	repo  domain.Repository
	clock Clock
}

func NewService(repo domain.Repository) *Service {
	return &Service{
		repo:  repo,
		clock: time.Now,
	}
}

func NewServiceWithClock(repo domain.Repository, clock Clock) *Service {
	if clock == nil {
		clock = time.Now
	}
	return &Service{repo: repo, clock: clock}
}

func (s *Service) Create(ctx context.Context, ownerPtid string, req *model.CreateNoteRequest) (*model.CreateNoteResponse, error) {
	if err := requireOwner(ownerPtid); err != nil {
		return nil, err
	}
	title := strings.TrimSpace(req.GetTitle())
	content := strings.TrimSpace(req.GetContent())
	if title == "" && content == "" {
		return nil, domain.ErrEmptyContent
	}
	now := timestamppb.New(s.clock().UTC())
	note := &model.Note{
		NoteId:    ulid.Make().String(),
		OwnerPtid: ownerPtid,
		Title:     title,
		Content:   content,
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := s.repo.Create(ctx, note)
	if err != nil {
		return nil, err
	}
	return &model.CreateNoteResponse{Item: created}, nil
}

func (s *Service) Get(ctx context.Context, ownerPtid string, req *model.GetNoteRequest) (*model.GetNoteResponse, error) {
	if err := requireOwner(ownerPtid); err != nil {
		return nil, err
	}
	if err := requireNoteID(req.GetNoteId()); err != nil {
		return nil, err
	}
	note, err := s.repo.Get(ctx, ownerPtid, req.GetNoteId(), req.GetIncludeDeleted())
	if err != nil {
		return nil, err
	}
	return &model.GetNoteResponse{Item: note}, nil
}

func (s *Service) List(ctx context.Context, ownerPtid string, req *model.ListNotesRequest) (*model.ListNotesResponse, error) {
	if err := requireOwner(ownerPtid); err != nil {
		return nil, err
	}
	page, err := s.repo.List(ctx, domain.ListQuery{
		OwnerPTID:      ownerPtid,
		PageSize:       req.GetPageSize(),
		PageToken:      req.GetPageToken(),
		OrderBy:        req.GetOrderBy(),
		IncludeDeleted: req.GetIncludeDeleted(),
	})
	if err != nil {
		return nil, err
	}
	return &model.ListNotesResponse{Items: page.Items, NextPageToken: page.NextPageToken}, nil
}

func (s *Service) Update(ctx context.Context, ownerPtid string, req *model.UpdateNoteRequest) (*model.UpdateNoteResponse, error) {
	if err := requireOwner(ownerPtid); err != nil {
		return nil, err
	}
	if err := requireNoteID(req.GetNoteId()); err != nil {
		return nil, err
	}
	patch := domain.UpdatePatch{Title: req.Title, Content: req.Content}
	if patch.Title == nil && patch.Content == nil {
		return nil, domain.ErrNoUpdateFields
	}
	if patch.Title != nil {
		value := strings.TrimSpace(*patch.Title)
		patch.Title = &value
	}
	if patch.Content != nil {
		value := strings.TrimSpace(*patch.Content)
		patch.Content = &value
	}
	if patch.Title != nil && patch.Content != nil && *patch.Title == "" && *patch.Content == "" {
		return nil, domain.ErrEmptyContent
	}
	updated, err := s.repo.Update(ctx, ownerPtid, req.GetNoteId(), patch)
	if err != nil {
		return nil, err
	}
	return &model.UpdateNoteResponse{Item: updated}, nil
}

func (s *Service) Delete(ctx context.Context, ownerPtid string, req *model.DeleteNoteRequest) (*model.DeleteNoteResponse, error) {
	if err := requireOwner(ownerPtid); err != nil {
		return nil, err
	}
	if err := requireNoteID(req.GetNoteId()); err != nil {
		return nil, err
	}
	deleted, err := s.repo.Delete(ctx, ownerPtid, req.GetNoteId())
	if err != nil {
		return nil, err
	}
	return &model.DeleteNoteResponse{Deleted: deleted}, nil
}

func (s *Service) Restore(ctx context.Context, ownerPtid string, req *model.RestoreNoteRequest) (*model.RestoreNoteResponse, error) {
	if err := requireOwner(ownerPtid); err != nil {
		return nil, err
	}
	if err := requireNoteID(req.GetNoteId()); err != nil {
		return nil, err
	}
	restored, err := s.repo.Restore(ctx, ownerPtid, req.GetNoteId())
	if err != nil {
		return nil, err
	}
	return &model.RestoreNoteResponse{Item: restored}, nil
}

func (s *Service) Search(ctx context.Context, ownerPtid string, req *model.SearchNotesRequest) (*model.SearchNotesResponse, error) {
	if err := requireOwner(ownerPtid); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetQuery()) == "" {
		return nil, domain.ErrSearchQueryEmpty
	}
	page, err := s.repo.Search(ctx, domain.SearchQuery{
		OwnerPTID: ownerPtid,
		Query:     req.GetQuery(),
		PageSize:  req.GetPageSize(),
		PageToken: req.GetPageToken(),
		OrderBy:   req.GetOrderBy(),
	})
	if err != nil {
		return nil, err
	}
	return &model.SearchNotesResponse{Items: page.Items, NextPageToken: page.NextPageToken}, nil
}

func requireOwner(ownerPtid string) error {
	if strings.TrimSpace(ownerPtid) == "" {
		return domain.ErrOwnerRequired
	}
	return nil
}

func requireNoteID(noteID string) error {
	if strings.TrimSpace(noteID) == "" {
		return domain.ErrNoteIDRequired
	}
	return nil
}
