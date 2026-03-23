package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/errcode"
	dbModel "github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_chat/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

func CreateSession(ctx context.Context, req *model.CreateSessionRequest) (*model.ChatSession, error) {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}

	now := time.Now()
	metaJSON, _ := json.Marshal(req.GetMeta())
	sessionID := fmt.Sprintf("session_%d", now.UnixNano())
	dbSession := &dbModel.Session{
		ID:          sessionID,
		Title:       req.GetTitle(),
		ProviderID:  req.GetProviderId(),
		UserID:      subject.ID,
		CreatedAt:   now,
		UpdatedAt:   now,
		Meta:        metaJSON,
		ConfigJSON:  []byte(req.GetConfigJson()),
		Description: nil,
		ModelName:   nil,
	}
	if req.GetDescription() != "" {
		v := req.GetDescription()
		dbSession.Description = &v
	}
	if req.GetModelName() != "" {
		v := req.GetModelName()
		dbSession.ModelName = &v
	}
	if err := rds.Create(dbSession).Error; err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to create session", err)
	}
	return toProtoSession(dbSession), nil
}

func ListSessions(ctx context.Context, req *model.ListSessionsRequest) ([]*model.ChatSession, error) {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	pageSize := int(req.GetPageSize())
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	var sessions []dbModel.Session
	if err := rds.Where("user_id = ?", subject.ID).Order("updated_at desc").Limit(pageSize).Find(&sessions).Error; err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to list sessions", err)
	}
	result := make([]*model.ChatSession, 0, len(sessions))
	for i := range sessions {
		result = append(result, toProtoSession(&sessions[i]))
	}
	return result, nil
}

func GetSession(ctx context.Context, sessionID string) (*model.ChatSession, error) {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	var session dbModel.Session
	if err := rds.Where("id = ? AND user_id = ?", sessionID, subject.ID).First(&session).Error; err != nil {
		return nil, errcode.New(errcode.AIChatNotFound, http.StatusNotFound, "session not found", err)
	}
	return toProtoSession(&session), nil
}

func UpdateSession(ctx context.Context, req *model.UpdateSessionRequest) (*model.ChatSession, error) {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	var session dbModel.Session
	if err := rds.Where("id = ? AND user_id = ?", req.GetSessionId(), subject.ID).First(&session).Error; err != nil {
		return nil, errcode.New(errcode.AIChatNotFound, http.StatusNotFound, "session not found", err)
	}
	if req.Title != nil {
		session.Title = req.GetTitle()
	}
	if req.Description != nil {
		v := req.GetDescription()
		session.Description = &v
	}
	if req.Pinned != nil {
		v := req.GetPinned()
		session.Pinned = &v
	}
	if req.ModelName != nil {
		v := req.GetModelName()
		session.ModelName = &v
	}
	if req.ProviderId != nil {
		session.ProviderID = req.GetProviderId()
	}
	if req.ConfigJson != nil {
		session.ConfigJSON = []byte(req.GetConfigJson())
	}
	session.UpdatedAt = time.Now()
	if err := rds.Save(&session).Error; err != nil {
		return nil, errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to update session", err)
	}
	return toProtoSession(&session), nil
}

func DeleteSession(ctx context.Context, sessionID string) error {
	rds, err := store.GetRDS(ctx, store.WithRDSDBName("ai_chat"))
	if err != nil {
		return errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to open ai_chat db", err)
	}
	subject := auth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return errcode.New(errcode.AIChatUnauthorized, http.StatusUnauthorized, "user id not found in context", nil)
	}
	if err := rds.Where("id = ? AND user_id = ?", sessionID, subject.ID).Delete(&dbModel.Session{}).Error; err != nil {
		return errcode.New(errcode.AIChatInternal, http.StatusInternalServerError, "failed to delete session", err)
	}
	return nil
}

func toProtoSession(s *dbModel.Session) *model.ChatSession {
	out := &model.ChatSession{
		Id:         s.ID,
		UserId:     s.UserID,
		ProviderId: s.ProviderID,
		Title:      s.Title,
		CreatedAt:  s.CreatedAt.UnixMilli(),
		UpdatedAt:  s.UpdatedAt.UnixMilli(),
	}
	if s.Description != nil {
		out.Description = *s.Description
	}
	if s.ModelName != nil {
		out.ModelName = *s.ModelName
	}
	if s.Pinned != nil {
		out.Pinned = *s.Pinned
	}
	if s.GroupName != nil {
		out.Group = *s.GroupName
	}
	out.ConfigJson = string(s.ConfigJSON)
	meta := map[string]string{}
	_ = json.Unmarshal(s.Meta, &meta)
	out.Meta = meta
	return out
}
