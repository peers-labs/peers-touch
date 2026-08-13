// Changelog:
// 2026-04-11 — Wired MemoryHandlers to MemoryService: replaced 501 stubs with
//   real service calls for HandleListMemories and HandleGetSnapshot.
// 2026-04-15 — Request/response types from generated model (memory.pb.go).

package handler

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// MemoryHandlers exposes HTTP handlers for the memory subsystem.
// Delegates all domain logic to MemoryService.
type MemoryHandlers struct {
	memoryService *service.MemoryService
}

func NewMemoryHandlers(memoryService *service.MemoryService) *MemoryHandlers {
	return &MemoryHandlers{memoryService: memoryService}
}

var domainToModelMemoryLayer = map[domain.MemoryLayer]model.MemoryLayer{
	domain.MemoryLayerIdentity:   model.MemoryLayer_MEMORY_LAYER_IDENTITY,
	domain.MemoryLayerPreference: model.MemoryLayer_MEMORY_LAYER_PREFERENCE,
	domain.MemoryLayerContext:    model.MemoryLayer_MEMORY_LAYER_CONTEXT,
	domain.MemoryLayerExperience: model.MemoryLayer_MEMORY_LAYER_EXPERIENCE,
	domain.MemoryLayerActivity:   model.MemoryLayer_MEMORY_LAYER_ACTIVITY,
}

var modelToDomainMemoryLayer = map[model.MemoryLayer]domain.MemoryLayer{
	model.MemoryLayer_MEMORY_LAYER_IDENTITY:   domain.MemoryLayerIdentity,
	model.MemoryLayer_MEMORY_LAYER_PREFERENCE: domain.MemoryLayerPreference,
	model.MemoryLayer_MEMORY_LAYER_CONTEXT:    domain.MemoryLayerContext,
	model.MemoryLayer_MEMORY_LAYER_EXPERIENCE: domain.MemoryLayerExperience,
	model.MemoryLayer_MEMORY_LAYER_ACTIVITY:   domain.MemoryLayerActivity,
}

func domainMemoryLayerToModel(layer domain.MemoryLayer) model.MemoryLayer {
	if m, ok := domainToModelMemoryLayer[layer]; ok {
		return m
	}
	return model.MemoryLayer_MEMORY_LAYER_UNSPECIFIED
}

func modelMemoryLayerToDomain(layer model.MemoryLayer) domain.MemoryLayer {
	if d, ok := modelToDomainMemoryLayer[layer]; ok {
		return d
	}
	return ""
}

// HandleListMemories retrieves all memory entries for a given agent and target.
func (h *MemoryHandlers) HandleListMemories(ctx context.Context, req *model.ListMemoriesRequest) (*model.ListMemoriesResponse, error) {
	since, until, err := resolveMemoryTimeRange(req.GetSince(), req.GetUntil(), req.GetPeriod())
	if err != nil {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, err.Error(), nil))
	}

	items, total, err := h.memoryService.ListWithOptions(ctx, domain.MemoryListOptions{
		AgentID:  req.GetAgentId(),
		Target:   req.GetTarget(),
		Layer:    modelMemoryLayerToDomain(req.GetLayer()),
		Page:     int(req.GetPage()),
		PageSize: int(req.GetPageSize()),
		OrderBy:  req.GetOrderBy(),
		Since:    since,
		Until:    until,
	})
	if err != nil {
		logger.Errorf(ctx, "HandleListMemories failed: agent_id=%s, target=%s, err=%v",
			req.GetAgentId(), req.GetTarget(), err)
		return nil, toHandlerError(err)
	}

	resp := &model.ListMemoriesResponse{
		Items: make([]*model.MemoryItem, 0, len(items)),
	}
	for i := range items {
		resp.Items = append(resp.Items, memoryItemToProto(&items[i]))
	}
	resp.Total = int32(total)

	return resp, nil
}

// HandleGetSnapshot builds a frozen memory snapshot for prompt injection.
func (h *MemoryHandlers) HandleGetSnapshot(ctx context.Context, req *model.GetMemorySnapshotRequest) (*model.GetMemorySnapshotResponse, error) {
	if req.GetAgentId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "agent_id is required", nil))
	}

	snapshot, err := h.memoryService.BuildSnapshot(ctx, req.GetAgentId())
	if err != nil {
		logger.Errorf(ctx, "HandleGetSnapshot failed: agent_id=%s, err=%v", req.GetAgentId(), err)
		return nil, toHandlerError(err)
	}

	return &model.GetMemorySnapshotResponse{
		Snapshot: memorySnapshotToProto(snapshot),
	}, nil
}

func (h *MemoryHandlers) HandleGetMemory(ctx context.Context, req *model.GetMemoryRequest) (*model.GetMemoryResponse, error) {
	if req.GetId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "id is required", nil))
	}
	item, err := h.memoryService.GetMemory(ctx, req.GetId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetMemoryResponse{Item: memoryItemToProto(item)}, nil
}

func (h *MemoryHandlers) HandleDeleteMemory(ctx context.Context, req *model.DeleteMemoryRequest) (*model.DeleteMemoryResponse, error) {
	if req.GetId() == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "id is required", nil))
	}
	agentID := req.GetAgentId()
	if agentID == "" {
		item, err := h.memoryService.GetMemory(ctx, req.GetId())
		if err != nil {
			return nil, toHandlerError(err)
		}
		agentID = item.AgentID
	}
	if err := h.memoryService.DeleteMemoryByID(ctx, agentID, req.GetId()); err != nil {
		return nil, toHandlerError(err)
	}
	return &model.DeleteMemoryResponse{Ok: true}, nil
}

func (h *MemoryHandlers) HandleUpdateMemory(ctx context.Context, req *model.WriteMemoryRequest) (*model.WriteMemoryResponse, error) {
	memoryID := req.GetOldContent()
	if memoryID == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "old_content field used as memory_id is required", nil))
	}
	newContent := req.GetContent()
	if newContent == "" {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "content is required", nil))
	}
	item, err := h.memoryService.UpdateMemoryByID(ctx, memoryID, newContent)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.WriteMemoryResponse{
		Item:    memoryItemToProto(item),
		Success: true,
		Message: "updated",
	}, nil
}

func (h *MemoryHandlers) HandleSearchMemories(ctx context.Context, req *model.SearchMemoriesRequest) (*model.SearchMemoriesResponse, error) {
	since, until, err := resolveMemoryTimeRange(req.GetSince(), req.GetUntil(), req.GetPeriod())
	if err != nil {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, err.Error(), nil))
	}
	layers := make([]domain.MemoryLayer, 0, len(req.GetLayers()))
	for _, layer := range req.GetLayers() {
		if layer != model.MemoryLayer_MEMORY_LAYER_UNSPECIFIED {
			if d := modelMemoryLayerToDomain(layer); d != "" {
				layers = append(layers, d)
			}
		}
	}
	results, err := h.memoryService.Search(ctx, domain.MemorySearchOptions{
		AgentID: req.GetAgentId(),
		Query:   req.GetQuery(),
		Layers:  layers,
		Limit:   int(req.GetLimit()),
		Effort:  req.GetEffort(),
		Since:   since,
		Until:   until,
	})
	if err != nil {
		return nil, toHandlerError(err)
	}
	resp := &model.SearchMemoriesResponse{Results: make([]*model.ScoredMemory, 0, len(results))}
	for i := range results {
		resp.Results = append(resp.Results, scoredMemoryToProto(&results[i]))
	}
	return resp, nil
}

func (h *MemoryHandlers) HandleGetPersona(ctx context.Context, req *model.GetMemoryPersonaRequest) (*model.GetMemoryPersonaResponse, error) {
	persona, err := h.memoryService.GetPersona(ctx, req.GetAgentId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.GetMemoryPersonaResponse{Persona: memoryPersonaToProto(persona)}, nil
}

func (h *MemoryHandlers) HandleGetStats(ctx context.Context, req *model.GetMemoryStatsRequest) (*model.GetMemoryStatsResponse, error) {
	stats, err := h.memoryService.Stats(ctx, req.GetAgentId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	byLayer := make(map[string]int32, len(stats.ByLayer))
	for layer, count := range stats.ByLayer {
		byLayer[string(layer)] = int32(count)
	}
	return &model.GetMemoryStatsResponse{
		Total:        int32(stats.Total),
		ByLayer:      byLayer,
		StorageBytes: stats.StorageBytes,
	}, nil
}

func (h *MemoryHandlers) HandleListEvents(ctx context.Context, req *model.ListMemoryEventsRequest) (*model.ListMemoryEventsResponse, error) {
	since, until, err := resolveMemoryTimeRange(req.GetSince(), req.GetUntil(), req.GetPeriod())
	if err != nil {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, err.Error(), nil))
	}
	events, err := h.memoryService.QueryEvents(ctx, domain.MemoryEventQueryOptions{
		Type:    domain.MemoryEventType(req.GetType()),
		AgentID: req.GetAgentId(),
		Limit:   int(req.GetLimit()),
		Offset:  int(req.GetOffset()),
		Since:   since,
		Until:   until,
	})
	if err != nil {
		return nil, toHandlerError(err)
	}
	resp := &model.ListMemoryEventsResponse{Events: make([]*model.MemoryEvent, 0, len(events))}
	for i := range events {
		resp.Events = append(resp.Events, memoryEventToProto(&events[i]))
	}
	return resp, nil
}

func (h *MemoryHandlers) HandleExport(ctx context.Context, req *model.ExportMemoriesRequest) (*model.ExportMemoriesResponse, error) {
	items, persona, err := h.memoryService.Export(ctx, req.GetAgentId(), domain.MemoryLayer(req.GetLayer()))
	if err != nil {
		return nil, toHandlerError(err)
	}
	resp := &model.ExportMemoriesResponse{
		Version:    "1.0",
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Persona:    memoryPersonaToProto(persona),
		Memories:   make([]*model.MemoryItem, 0, len(items)),
	}
	for i := range items {
		resp.Memories = append(resp.Memories, memoryItemToProto(&items[i]))
	}
	return resp, nil
}

func (h *MemoryHandlers) HandleImport(ctx context.Context, req *model.ImportMemoriesRequest) (*model.ImportMemoriesResponse, error) {
	if req.GetData() == nil {
		return nil, toHandlerError(errcode.New(errcode.AgentInvalidRequest, 400, "data is required", nil))
	}
	items := make([]domain.MemoryItem, 0, len(req.GetData().GetMemories()))
	for _, item := range req.GetData().GetMemories() {
		items = append(items, memoryItemFromProto(item))
	}
	imported, skipped, failed := h.memoryService.Import(ctx, items, req.GetSkipDuplicates())
	return &model.ImportMemoriesResponse{
		Imported: int32(imported),
		Skipped:  int32(skipped),
		Failed:   int32(failed),
		Total:    int32(len(items)),
	}, nil
}

func (h *MemoryHandlers) HandleEmbeddingStatus(ctx context.Context, _ *model.EmbeddingStatusRequest) (*model.EmbeddingStatusResponse, error) {
	provider, modelName, dimensions, vectorCount := h.memoryService.EmbeddingStatus(ctx)
	return &model.EmbeddingStatusResponse{
		Provider:    provider,
		Model:       modelName,
		Dimensions:  int32(dimensions),
		VectorCount: int32(vectorCount),
	}, nil
}

func (h *MemoryHandlers) HandleReEmbed(ctx context.Context, _ *model.ReEmbedRequest) (*model.ReEmbedResponse, error) {
	count, err := h.memoryService.ReEmbed(ctx)
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ReEmbedResponse{Ok: true, ReembeddedCount: int32(count)}, nil
}

func (h *MemoryHandlers) HandleFeedback(ctx context.Context, req *model.MemoryFeedbackRequest) (*model.MemoryFeedbackResponse, error) {
	item, err := h.memoryService.RecordFeedback(ctx, req.GetMemoryId(), req.GetHelpful(), req.GetReason())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.MemoryFeedbackResponse{
		MemoryId:   item.MemoryID,
		TrustScore: item.TrustScore,
		Helpful:    req.GetHelpful(),
	}, nil
}

func memoryItemToProto(item *domain.MemoryItem) *model.MemoryItem {
	if item == nil {
		return nil
	}
	mi := &model.MemoryItem{
		MemoryId:     item.MemoryID,
		AgentId:      item.AgentID,
		Target:       item.Target,
		Content:      item.Content,
		SourceTurnId: item.SourceTurnID,
		Layer:        domainMemoryLayerToModel(item.Layer),
		SessionId:    item.SessionID,
		Source:       item.Source,
		Summary:      item.Summary,
		Relevance:    item.Relevance,
		AccessCount:  int32(item.RetrievalCount),
		TrustScore:   item.TrustScore,
		HelpfulCount: int32(item.HelpfulCount),
		HarmfulCount: int32(item.HarmfulCount),
		IsFrozen:     item.IsFrozen,
	}
	if !item.CreatedAt.IsZero() {
		mi.CreatedAt = timestamppb.New(item.CreatedAt)
	}
	if !item.UpdatedAt.IsZero() {
		mi.UpdatedAt = timestamppb.New(item.UpdatedAt)
	}
	if item.LastAccessedAt != nil && !item.LastAccessedAt.IsZero() {
		mi.LastAccessedAt = timestamppb.New(*item.LastAccessedAt)
	}
	return mi
}

func memoryItemFromProto(item *model.MemoryItem) domain.MemoryItem {
	if item == nil {
		return domain.MemoryItem{}
	}
	return domain.MemoryItem{
		MemoryID:       item.GetMemoryId(),
		AgentID:        item.GetAgentId(),
		Target:         item.GetTarget(),
		Layer:          domain.MemoryLayer(item.GetLayer()),
		SessionID:      item.GetSessionId(),
		Content:        item.GetContent(),
		SourceTurnID:   item.GetSourceTurnId(),
		Source:         item.GetSource(),
		Summary:        item.GetSummary(),
		Relevance:      item.GetRelevance(),
		IsFrozen:       item.GetIsFrozen(),
		TrustScore:     item.GetTrustScore(),
		RetrievalCount: int(item.GetAccessCount()),
		HelpfulCount:   int(item.GetHelpfulCount()),
		HarmfulCount:   int(item.GetHarmfulCount()),
	}
}

func memorySnapshotToProto(s *domain.MemorySnapshot) *model.MemorySnapshot {
	if s == nil {
		return nil
	}
	out := &model.MemorySnapshot{
		AgentId:        s.AgentID,
		MemoryContent:  s.MemoryContent,
		UserContent:    s.UserContent,
		PersonaContent: s.PersonaContent,
	}
	for i := range s.RelevantItems {
		out.RelevantItems = append(out.RelevantItems, memoryItemToProto(&s.RelevantItems[i]))
	}
	if !s.CapturedAt.IsZero() {
		out.CapturedAt = timestamppb.New(s.CapturedAt)
	}
	return out
}

func scoredMemoryToProto(item *domain.ScoredMemory) *model.ScoredMemory {
	if item == nil {
		return nil
	}
	return &model.ScoredMemory{
		Memory: memoryItemToProto(&item.Memory),
		Score:  item.Score,
		Explain: &model.MemoryScoreExplain{
			VectorScore:   item.Explain.VectorScore,
			KeywordScore:  item.Explain.KeywordScore,
			WeightedScore: item.Explain.WeightedScore,
			DecayFactor:   item.Explain.DecayFactor,
			AfterDecay:    item.Explain.AfterDecay,
			AfterRerank:   item.Explain.AfterRerank,
			FinalScore:    item.Explain.FinalScore,
			TrustFactor:   item.Explain.TrustFactor,
		},
	}
}

func memoryPersonaToProto(persona *domain.MemoryPersona) *model.MemoryPersona {
	if persona == nil {
		return nil
	}
	out := &model.MemoryPersona{
		Tagline:   persona.Tagline,
		Narrative: persona.Narrative,
	}
	if !persona.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(persona.UpdatedAt)
	}
	return out
}

func memoryEventToProto(event *domain.MemoryEvent) *model.MemoryEvent {
	if event == nil {
		return nil
	}
	out := &model.MemoryEvent{
		Id:         event.ID,
		Type:       string(event.Type),
		MemoryId:   event.MemoryID,
		SessionId:  event.SessionID,
		AgentId:    event.AgentID,
		Layer:      domainMemoryLayerToModel(event.Layer),
		DetailJson: event.Detail,
		LatencyMs:  event.LatencyMs,
	}
	if !event.Timestamp.IsZero() {
		out.Timestamp = timestamppb.New(event.Timestamp)
	}
	return out
}

func resolveMemoryTimeRange(sinceRaw, untilRaw, period string) (*time.Time, *time.Time, error) {
	since, err := parseMemoryTimeValue(sinceRaw)
	if err != nil {
		return nil, nil, err
	}
	until, err := parseMemoryTimeValue(untilRaw)
	if err != nil {
		return nil, nil, err
	}
	if since == nil {
		since, err = periodStart(period)
		if err != nil {
			return nil, nil, err
		}
	}
	return since, until, nil
}

func parseMemoryTimeValue(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if millis, err := strconv.ParseInt(value, 10, 64); err == nil && millis > 1000000000000 {
		t := time.UnixMilli(millis)
		return &t, nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02", "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return &parsed, nil
		}
	}
	return nil, errcode.New(errcode.AgentInvalidRequest, 400, "invalid time value "+value, nil)
}

func periodStart(period string) (*time.Time, error) {
	switch strings.TrimSpace(period) {
	case "":
		return nil, nil
	case "24h":
		t := time.Now().Add(-24 * time.Hour)
		return &t, nil
	case "7d":
		t := time.Now().AddDate(0, 0, -7)
		return &t, nil
	case "30d":
		t := time.Now().AddDate(0, 0, -30)
		return &t, nil
	case "90d":
		t := time.Now().AddDate(0, 0, -90)
		return &t, nil
	default:
		return nil, errcode.New(errcode.AgentInvalidRequest, 400, "invalid period "+period, nil)
	}
}
