package service

import (
    "context"
    "time"

    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
    "github.com/peers-touch/peers-touch/station/frame/touch/message/repo"
)

type ReceiptService struct {
    rcptRepo *repo.ReceiptRepo
}

func NewReceiptService() *ReceiptService { return &ReceiptService{rcptRepo: repo.NewReceiptRepo()} }

type PostReceiptReq struct {
    MsgULID   string
    MemberDID string
    Delivered bool
    Read      bool
}

func (s *ReceiptService) Post(ctx context.Context, req *PostReceiptReq) (*m.Receipt, error) {
    r := &m.Receipt{MsgULID: req.MsgULID, MemberDID: req.MemberDID}
    if req.Delivered { r.DeliveredAt = time.Now() }
    if req.Read { r.ReadAt = time.Now() }
    if err := s.rcptRepo.Add(ctx, r); err != nil { return nil, err }
    return r, nil
}

func (s *ReceiptService) List(ctx context.Context, convID string, after int64) ([]*m.Receipt, error) {
    return s.rcptRepo.ListAfter(ctx, convID, after)
}