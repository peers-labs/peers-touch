package service

import (
    "context"

    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
    "github.com/peers-touch/peers-touch/station/frame/touch/message/repo"
)

type ConversationService struct {
    convRepo   *repo.ConversationRepo
    memberRepo *repo.MemberRepo
}

func NewConversationService() *ConversationService {
    return &ConversationService{convRepo: repo.NewConversationRepo(), memberRepo: repo.NewMemberRepo()}
}

type CreateConvReq struct {
    ConvID    string
    Type      string
    Title     string
    AvatarCID string
    Policy    string
}

func (s *ConversationService) Create(ctx context.Context, req *CreateConvReq) (*m.Conversation, error) {
    c := &m.Conversation{ConvID: req.ConvID, Type: m.ConversationType(req.Type), Title: req.Title, AvatarCID: req.AvatarCID, Policy: req.Policy, Epoch: 0}
    if err := s.convRepo.Create(ctx, c); err != nil { return nil, err }
    return c, nil
}

func (s *ConversationService) Get(ctx context.Context, convID string) (*m.Conversation, error) {
    return s.convRepo.GetByConvID(ctx, convID)
}

func (s *ConversationService) Members(ctx context.Context, convID uint64) ([]*m.ConvMember, error) {
    return s.memberRepo.List(ctx, convID)
}

func (s *ConversationService) AddMembers(ctx context.Context, convID uint64, dids []string, role m.Role) error {
    for _, d := range dids {
        if err := s.memberRepo.Add(ctx, convID, d, role); err != nil { return err }
    }
    return nil
}

func (s *ConversationService) RemoveMembers(ctx context.Context, convID uint64, dids []string) error {
    for _, d := range dids {
        if err := s.memberRepo.Remove(ctx, convID, d); err != nil { return err }
    }
    return nil
}

func (s *ConversationService) KeyRotate(ctx context.Context, convID string) error {
    return s.convRepo.IncEpoch(ctx, convID)
}