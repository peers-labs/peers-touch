package service

import (
    "context"
    "time"

    m "github.com/peers-touch/peers-touch/station/frame/touch/model/db"
    "github.com/peers-touch/peers-touch/station/frame/touch/message/repo"
)

type MessageService struct {
    msgRepo *repo.MessageRepo
}

func NewMessageService() *MessageService { return &MessageService{msgRepo: repo.NewMessageRepo()} }

type AppendReq struct {
    ULID       string
    ConvID     string
    SenderDID  string
    TS         int64
    Type       string
    ParentID   string
    ThreadID   string
    ContentCID string
    TTLMillis  int64
}

func (s *MessageService) Append(ctx context.Context, req *AppendReq) (*m.Message, error) {
    msg := &m.Message{ULID: req.ULID, ConvID: req.ConvID, SenderDID: req.SenderDID, TS: req.TS, Type: m.MessageType(req.Type), ParentID: req.ParentID, ThreadID: req.ThreadID, ContentCID: req.ContentCID}
    if req.TTLMillis > 0 { msg.TTLAt = time.UnixMilli(req.TTLMillis) }
    if err := s.msgRepo.Append(ctx, msg); err != nil { return nil, err }
    return msg, nil
}

func (s *MessageService) List(ctx context.Context, convID string, afterTS int64, limit int) ([]*m.Message, error) {
    return s.msgRepo.List(ctx, convID, afterTS, limit)
}