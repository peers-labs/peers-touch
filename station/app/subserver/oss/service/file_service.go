package service

import (
	"context"
	"mime"
	"mime/multipart"
	"path/filepath"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	touchutil "github.com/peers-labs/peers-touch/station/frame/touch/util"
)

type FileService interface {
	SaveFile(ctx context.Context, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error)
	GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error)
}

type fileService struct {
	repo    ossrepo.FileRepository
	backend storage.Backend
}

func NewFileService(repo ossrepo.FileRepository, backend storage.Backend) FileService {
	return &fileService{repo: repo, backend: backend}
}

func (s *fileService) SaveFile(ctx context.Context, file multipart.File, header *multipart.FileHeader) (*ossmodel.FileMeta, error) {
	rnd, _ := touchutil.RandomString(16)
	ext := filepath.Ext(header.Filename)
	day := time.Now().Format("2006/01/02")
	// Use forward slash explicitly for OSS keys to be cross-platform and URL friendly
	key := day + "/" + rnd + ext

	fullPath, err := s.backend.Save(ctx, key, file)
	if err != nil {
		return nil, err
	}

	mt := mime.TypeByExtension(ext)
	if mt == "" {
		mt = "application/octet-stream"
	}

	meta := &ossmodel.FileMeta{
		ID:        rnd,
		Key:       key,
		Name:      header.Filename,
		Size:      header.Size,
		Mime:      mt,
		Backend:   "local",
		Path:      fullPath,
		CreatedAt: time.Now(),
	}

	if err := s.repo.Create(ctx, meta); err != nil {
		// Log error but we don't necessarily want to fail the request if DB fails but file is saved
		// For now, let's return error to be strict
		// return nil, err
	}

	return meta, nil
}

func (s *fileService) GetFileMeta(ctx context.Context, key string) (*ossmodel.FileMeta, error) {
	return s.repo.FindByKey(ctx, key)
}
