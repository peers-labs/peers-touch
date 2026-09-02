package service

import (
	"context"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

// ThreadService owns durable Thread (sub-conversation) lifecycle. A thread is
// forked from a source message inside a conversation; its messages carry the
// matching thread_id. This is the Station-owned truth behind the Desktop
// ThreadView (R11), replacing the prior in-memory `messages.slice` projection.
type ThreadService struct{}

func NewThreadService() *ThreadService {
	return &ThreadService{}
}

func (s *ThreadService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName("agent"))
}

// CreateThread forks a new thread from a source message. It records the source
// message's seq so the thread can be ordered relative to the main timeline.
func (s *ThreadService) CreateThread(ctx context.Context, conversationID, sourceMessageID, title string) (*domain.Thread, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	sourceMessageID = strings.TrimSpace(sourceMessageID)
	if conversationID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}
	if sourceMessageID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "source_message_id is required", nil)
	}

	// Resolve the source message's seq for ordering (best-effort).
	var src persistence.AgentMessage
	if err := db.WithContext(ctx).
		Where("id = ? AND conversation_id = ?", sourceMessageID, conversationID).
		First(&src).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusNotFound, "source message not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to resolve source message", err)
	}

	row := &persistence.AgentThread{
		ID:              generateID("thrd"),
		ConversationID:  conversationID,
		SourceMessageID: sourceMessageID,
		Title:           strings.TrimSpace(title),
		SourceSeq:       src.Seq,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create thread", err)
	}
	return persistenceThreadToDomain(row), nil
}

// ListThreads returns all threads forked within a conversation, oldest first.
func (s *ThreadService) ListThreads(ctx context.Context, conversationID string) ([]*domain.Thread, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}
	var rows []persistence.AgentThread
	if err := db.WithContext(ctx).
		Where("conversation_id = ?", conversationID).
		Order("source_seq ASC, created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list threads", err)
	}
	out := make([]*domain.Thread, 0, len(rows))
	for i := range rows {
		out = append(out, persistenceThreadToDomain(&rows[i]))
	}
	return out, nil
}

// ListThreadMessages returns messages belonging to a thread, ordered by seq,
// supporting cursor replay via afterSeq.
func (s *ThreadService) ListThreadMessages(ctx context.Context, threadID string, afterSeq int64) ([]*domain.Message, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "thread_id is required", nil)
	}
	query := db.WithContext(ctx).Model(&persistence.AgentMessage{}).Where("thread_id = ?", threadID)
	if afterSeq > 0 {
		query = query.Where("seq > ?", afterSeq)
	}
	var rows []persistence.AgentMessage
	if err := query.Order("seq ASC").Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list thread messages", err)
	}
	out := make([]*domain.Message, 0, len(rows))
	for i := range rows {
		out = append(out, persistenceAgentMessageToDomain(&rows[i]))
	}
	return out, nil
}

func persistenceThreadToDomain(row *persistence.AgentThread) *domain.Thread {
	return &domain.Thread{
		ThreadID:        row.ID,
		ConversationID:  row.ConversationID,
		SourceMessageID: row.SourceMessageID,
		Title:           row.Title,
		SourceSeq:       row.SourceSeq,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
}
