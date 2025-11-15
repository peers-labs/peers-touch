package service

import (
	"context"

	"github.com/peers-labs/peers-touch/station/frame/touch/message/repo"
	m "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

type AttachmentService struct {
	attRepo *repo.AttachmentRepo
}

func NewAttachmentService() *AttachmentService {
	return &AttachmentService{attRepo: repo.NewAttachmentRepo()}
}

func (s *AttachmentService) Save(ctx context.Context, a *m.Attachment) error {
	return s.attRepo.Save(ctx, a)
}

func (s *AttachmentService) Get(ctx context.Context, cid string) (*m.Attachment, error) {
	return s.attRepo.Get(ctx, cid)
}
