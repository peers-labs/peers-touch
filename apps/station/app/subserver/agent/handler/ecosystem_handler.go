// Changelog:
// 2026-08-14 — M11 localStorage→Station migration: HTTP handlers for ecosystem
//   entities (AgentGroups, TopicComments, EvalDatasets, CustomPlugins).

package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// EcosystemHandlers exposes HTTP handlers for ecosystem CRUD operations.
type EcosystemHandlers struct {
	svc *service.EcosystemService
}

func NewEcosystemHandlers(svc *service.EcosystemService) *EcosystemHandlers {
	return &EcosystemHandlers{svc: svc}
}

// --- Agent Groups ---

func (h *EcosystemHandlers) HandleCreateAgentGroup(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		Name              string `json:"name"`
		Description       string `json:"description"`
		MemberAgentIDs    string `json:"member_agent_ids"`
		OrchestrationMode string `json:"orchestration_mode"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	actorID := subjectActorID(ctx)
	group := &persistence.EcosystemAgentGroup{
		Name:              input.Name,
		Description:       input.Description,
		MemberAgentIDs:    input.MemberAgentIDs,
		OrchestrationMode: input.OrchestrationMode,
		OwnerActorID:      actorID,
	}
	if err := h.svc.CreateAgentGroup(ctx, group); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "group": group})
	return nil
}

func (h *EcosystemHandlers) HandleUpdateAgentGroup(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID                string `json:"id"`
		Name              string `json:"name"`
		Description       string `json:"description"`
		MemberAgentIDs    string `json:"member_agent_ids"`
		OrchestrationMode string `json:"orchestration_mode"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id is required"})
		return nil
	}
	group := &persistence.EcosystemAgentGroup{
		ID:                input.ID,
		Name:              input.Name,
		Description:       input.Description,
		MemberAgentIDs:    input.MemberAgentIDs,
		OrchestrationMode: input.OrchestrationMode,
	}
	if err := h.svc.UpdateAgentGroup(ctx, group); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *EcosystemHandlers) HandleDeleteAgentGroup(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id is required"})
		return nil
	}
	if err := h.svc.DeleteAgentGroup(ctx, input.ID); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *EcosystemHandlers) HandleListAgentGroups(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := subjectActorID(ctx)
	groups, err := h.svc.ListAgentGroups(ctx, actorID)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "groups": groups})
	return nil
}

// --- Topic Comments ---

func (h *EcosystemHandlers) HandleCreateTopicComment(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		TopicKey string `json:"topic_key"`
		Content  string `json:"content"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.TopicKey == "" || input.Content == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "topic_key and content are required"})
		return nil
	}
	actorID := subjectActorID(ctx)
	comment := &persistence.EcosystemTopicComment{
		TopicKey: input.TopicKey,
		Content:  input.Content,
		AuthorID: actorID,
	}
	if err := h.svc.CreateTopicComment(ctx, comment); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "comment": comment})
	return nil
}

func (h *EcosystemHandlers) HandleDeleteTopicComment(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		TopicKey  string `json:"topic_key"`
		CommentID string `json:"comment_id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.TopicKey == "" || input.CommentID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "topic_key and comment_id are required"})
		return nil
	}
	if err := h.svc.DeleteTopicComment(ctx, input.TopicKey, input.CommentID); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *EcosystemHandlers) HandleListTopicComments(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		TopicKey string `json:"topic_key"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.TopicKey == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "topic_key is required"})
		return nil
	}
	comments, err := h.svc.ListTopicComments(ctx, input.TopicKey)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "comments": comments})
	return nil
}

// --- Eval Datasets ---

func (h *EcosystemHandlers) HandleCreateEvalDataset(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		ItemsJSON   string `json:"items_json"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	actorID := subjectActorID(ctx)
	dataset := &persistence.EcosystemEvalDataset{
		Name:         input.Name,
		Description:  input.Description,
		ItemsJSON:    input.ItemsJSON,
		OwnerActorID: actorID,
	}
	if err := h.svc.CreateEvalDataset(ctx, dataset); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "dataset": dataset})
	return nil
}

func (h *EcosystemHandlers) HandleUpdateEvalDataset(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		ItemsJSON   string `json:"items_json"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id is required"})
		return nil
	}
	dataset := &persistence.EcosystemEvalDataset{
		ID:          input.ID,
		Name:        input.Name,
		Description: input.Description,
		ItemsJSON:   input.ItemsJSON,
	}
	if err := h.svc.UpdateEvalDataset(ctx, dataset); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *EcosystemHandlers) HandleDeleteEvalDataset(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id is required"})
		return nil
	}
	if err := h.svc.DeleteEvalDataset(ctx, input.ID); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *EcosystemHandlers) HandleListEvalDatasets(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := subjectActorID(ctx)
	datasets, err := h.svc.ListEvalDatasets(ctx, actorID)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "datasets": datasets})
	return nil
}

// --- Custom Plugins ---

func (h *EcosystemHandlers) HandleCreateCustomPlugin(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		Endpoint     string `json:"endpoint"`
		Method       string `json:"method"`
		AuthType     string `json:"auth_type"`
		InputSchema  string `json:"input_schema"`
		OutputSchema string `json:"output_schema"`
		Enabled      bool   `json:"enabled"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.Endpoint == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "endpoint is required"})
		return nil
	}
	actorID := subjectActorID(ctx)
	plugin := &persistence.EcosystemCustomPlugin{
		Name:         input.Name,
		Description:  input.Description,
		Endpoint:     input.Endpoint,
		Method:       input.Method,
		AuthType:     input.AuthType,
		InputSchema:  input.InputSchema,
		OutputSchema: input.OutputSchema,
		Enabled:      input.Enabled,
		OwnerActorID: actorID,
	}
	if err := h.svc.CreateCustomPlugin(ctx, plugin); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "plugin": plugin})
	return nil
}

func (h *EcosystemHandlers) HandleUpdateCustomPlugin(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Description  string `json:"description"`
		Endpoint     string `json:"endpoint"`
		Method       string `json:"method"`
		AuthType     string `json:"auth_type"`
		InputSchema  string `json:"input_schema"`
		OutputSchema string `json:"output_schema"`
		Enabled      bool   `json:"enabled"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id is required"})
		return nil
	}
	plugin := &persistence.EcosystemCustomPlugin{
		ID:           input.ID,
		Name:         input.Name,
		Description:  input.Description,
		Endpoint:     input.Endpoint,
		Method:       input.Method,
		AuthType:     input.AuthType,
		InputSchema:  input.InputSchema,
		OutputSchema: input.OutputSchema,
		Enabled:      input.Enabled,
	}
	if err := h.svc.UpdateCustomPlugin(ctx, plugin); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *EcosystemHandlers) HandleDeleteCustomPlugin(ctx context.Context, req server.Request, resp server.Response) error {
	var input struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(req.Body(), &input); err != nil {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request"})
		return nil
	}
	if input.ID == "" {
		writeJSON(resp, http.StatusBadRequest, map[string]any{"ok": false, "error": "id is required"})
		return nil
	}
	if err := h.svc.DeleteCustomPlugin(ctx, input.ID); err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (h *EcosystemHandlers) HandleListCustomPlugins(ctx context.Context, req server.Request, resp server.Response) error {
	actorID := subjectActorID(ctx)
	plugins, err := h.svc.ListCustomPlugins(ctx, actorID)
	if err != nil {
		writeJSON(resp, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return nil
	}
	writeJSON(resp, http.StatusOK, map[string]any{"ok": true, "plugins": plugins})
	return nil
}
