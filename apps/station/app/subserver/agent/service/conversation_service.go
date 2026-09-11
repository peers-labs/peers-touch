package service

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	defaultMaxTurnEventSubscribersPerTurn  = 8
	defaultMaxTurnEventSubscribersPerActor = 32
	defaultMaxTurnEventSubscribersGlobal   = 1024
)

type turnEventSubscriptionLimits struct {
	perTurn  int
	perActor int
	global   int
}

type turnEventSubscription struct {
	actorID       string
	notifications chan struct{}
}

type ConversationService struct {
	subscriptionsMu    sync.Mutex
	subscriptions      map[string]map[*turnEventSubscription]struct{}
	actorSubscriptions map[string]int
	subscriptionCount  int
	subscriptionLimits turnEventSubscriptionLimits
}

func NewConversationService() *ConversationService {
	return newConversationServiceWithSubscriptionLimits(turnEventSubscriptionLimits{
		perTurn:  defaultMaxTurnEventSubscribersPerTurn,
		perActor: defaultMaxTurnEventSubscribersPerActor,
		global:   defaultMaxTurnEventSubscribersGlobal,
	})
}

func newConversationServiceWithSubscriptionLimits(limits turnEventSubscriptionLimits) *ConversationService {
	return &ConversationService{
		subscriptions:      make(map[string]map[*turnEventSubscription]struct{}),
		actorSubscriptions: make(map[string]int),
		subscriptionLimits: limits,
	}
}

// SubscribeTurnEvents registers an edge-triggered notification before callers
// replay durable events. The returned boundary is captured while publication
// is excluded: events committed before it are replayed through the boundary,
// while events committed after it must notify the installed subscription.
func (s *ConversationService) SubscribeTurnEvents(
	ctx context.Context,
	ptid string,
	conversationID string,
	turnID string,
) (<-chan struct{}, int64, *TurnEventReplayFence, func(), error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, nil, nil, err
	}
	ptid = strings.TrimSpace(ptid)
	conversationID = strings.TrimSpace(conversationID)
	turnID = strings.TrimSpace(turnID)
	var count int64
	if err := db.WithContext(ctx).Table("agent_turns AS turn").
		Joins("JOIN agent_conversations AS conversation ON conversation.id = turn.conversation_id").
		Where(
			"turn.id = ? AND turn.conversation_id = ? AND conversation.actor_ptid = ?",
			turnID,
			conversationID,
			ptid,
		).
		Count(&count).Error; err != nil {
		return nil, 0, nil, nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"authorize turn event subscription",
			err,
		)
	}
	if count != 1 {
		return nil, 0, nil, nil, errcode.New(
			errcode.AgentNotFound,
			http.StatusNotFound,
			"turn not found",
			nil,
		)
	}

	key := turnEventSubscriptionKey(conversationID, turnID)
	s.subscriptionsMu.Lock()
	defer s.subscriptionsMu.Unlock()

	if s.subscriptions == nil {
		s.subscriptions = make(map[string]map[*turnEventSubscription]struct{})
	}
	if s.actorSubscriptions == nil {
		s.actorSubscriptions = make(map[string]int)
	}
	if s.subscriptionCount >= s.subscriptionLimits.global {
		return nil, 0, nil, nil, turnEventSubscriptionLimitError("global")
	}
	if s.actorSubscriptions[ptid] >= s.subscriptionLimits.perActor {
		return nil, 0, nil, nil, turnEventSubscriptionLimitError("actor")
	}
	if len(s.subscriptions[key]) >= s.subscriptionLimits.perTurn {
		return nil, 0, nil, nil, turnEventSubscriptionLimitError("turn")
	}

	fence, err := loadCurrentTurnEventFence(db.WithContext(ctx), turnID)
	if err != nil {
		return nil, 0, nil, nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"capture turn event attempt fence",
			err,
		)
	}
	var boundary struct{ MaxSequence int64 }
	boundaryQuery := db.WithContext(ctx).Model(&persistence.TurnEvent{}).
		Where("conversation_id = ? AND turn_id = ?", conversationID, turnID).
		Select("COALESCE(MAX(event_seq), 0) AS max_sequence")
	boundaryQuery = applyTurnEventFence(boundaryQuery, "agent_turn_events", fence)
	if err := boundaryQuery.
		Scan(&boundary).Error; err != nil {
		return nil, 0, nil, nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"capture turn event replay boundary",
			err,
		)
	}

	subscription := &turnEventSubscription{
		actorID:       ptid,
		notifications: make(chan struct{}, 1),
	}
	if s.subscriptions[key] == nil {
		s.subscriptions[key] = make(map[*turnEventSubscription]struct{})
	}
	s.subscriptions[key][subscription] = struct{}{}
	s.actorSubscriptions[ptid]++
	s.subscriptionCount++

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			s.subscriptionsMu.Lock()
			defer s.subscriptionsMu.Unlock()

			if _, exists := s.subscriptions[key][subscription]; !exists {
				return
			}
			delete(s.subscriptions[key], subscription)
			if len(s.subscriptions[key]) == 0 {
				delete(s.subscriptions, key)
			}
			s.actorSubscriptions[subscription.actorID]--
			if s.actorSubscriptions[subscription.actorID] == 0 {
				delete(s.actorSubscriptions, subscription.actorID)
			}
			s.subscriptionCount--
		})
	}
	return subscription.notifications, boundary.MaxSequence, fence, cancel, nil
}

func turnEventSubscriptionLimitError(scope string) error {
	return errcode.New(
		errcode.AgentQueueFull,
		http.StatusTooManyRequests,
		"turn event subscriber limit exceeded: "+scope,
		nil,
	)
}

func (s *ConversationService) notifyTurnEvent(conversationID string, turnID string) {
	key := turnEventSubscriptionKey(conversationID, turnID)
	s.subscriptionsMu.Lock()
	defer s.subscriptionsMu.Unlock()
	for subscription := range s.subscriptions[key] {
		select {
		case subscription.notifications <- struct{}{}:
		default:
		}
	}
}

func turnEventSubscriptionKey(conversationID string, turnID string) string {
	return strings.TrimSpace(conversationID) + "\x00" + strings.TrimSpace(turnID)
}

func (s *ConversationService) getDB(ctx context.Context) (*gorm.DB, error) {
	return store.GetRDS(ctx, store.WithRDSDBName("agent"))
}

func (s *ConversationService) ListConversations(ctx context.Context, agentID, ptid, statusFilter string, page, pageSize int) ([]*domain.Conversation, int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, err
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return nil, 0, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agent_id is required", nil)
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	ptid = strings.TrimSpace(ptid)
	if ptid == "" {
		return nil, 0, errcode.New(errcode.AgentUnauthorized, http.StatusUnauthorized, "ptid is required", nil)
	}
	query := db.WithContext(ctx).Model(&persistence.Conversation{}).
		Where("agent_id = ? AND actor_ptid = ?", agentID, ptid)
	status := strings.TrimSpace(statusFilter)
	if status != "" {
		query = query.Where("status = ?", status)
	} else {
		query = query.Where("status != ?", "deleted")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to count conversations", err)
	}

	var rows []persistence.Conversation
	if err := query.Order("updated_at DESC").
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list conversations", err)
	}

	result := make([]*domain.Conversation, 0, len(rows))
	for i := range rows {
		conversation, conversionErr := persistenceConversationToDomain(&rows[i])
		if conversionErr != nil {
			return nil, 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
				"failed to decode conversation runtime binding", conversionErr)
		}
		result = append(result, conversation)
	}
	return result, total, nil
}

func (s *ConversationService) GetConversation(ctx context.Context, ptid, conversationID string) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	ptid = strings.TrimSpace(ptid)
	if conversationID == "" || ptid == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "ptid and conversation_id are required", nil)
	}
	var ownership persistence.Conversation
	if err := db.WithContext(ctx).
		Select("actor_ptid").
		Where("id = ?", conversationID).
		Take(&ownership).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", err)
		}
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to inspect conversation ownership",
			err,
		)
	}
	if ownership.ActorPTID != ptid {
		return nil, errcode.NewOwnershipForbiddenActor("conversation", conversationID)
	}
	var row persistence.Conversation
	if err := db.WithContext(ctx).Where("id = ? AND actor_ptid = ?", conversationID, ptid).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", err)
		}
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to get conversation", err)
	}
	conversation, conversionErr := persistenceConversationToDomain(&row)
	if conversionErr != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to decode conversation runtime binding", conversionErr)
	}
	return conversation, nil
}

func (s *ConversationService) CreateConversation(ctx context.Context, agentID, ptid, title, description, modelName, providerID string) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	agentID = strings.TrimSpace(agentID)
	ptid = strings.TrimSpace(ptid)
	if agentID == "" || ptid == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agent_id and ptid are required", nil)
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "New Chat"
	}

	now := time.Now()
	row := &persistence.Conversation{
		ID:         generateID("conv"),
		AgentID:    agentID,
		ActorPTID:  ptid,
		Title:      title,
		ProviderID: firstNonEmpty(providerID, ""),
		Status:     string(domain.ConversationStatusActive),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if description != "" {
		row.Description = &description
	}
	if modelName != "" {
		row.ModelName = &modelName
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create conversation", err)
	}
	logger.Infof(ctx, "conversation created: conv_id=%s agent_id=%s ptid=%s", row.ID, agentID, ptid)
	conversation, conversionErr := persistenceConversationToDomain(row)
	if conversionErr != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to decode conversation runtime binding", conversionErr)
	}
	return conversation, nil
}

func (s *ConversationService) CreateConversationWithID(ctx context.Context, conversationID, agentID, ptid, title, description, modelName, providerID string) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	agentID = strings.TrimSpace(agentID)
	ptid = strings.TrimSpace(ptid)
	if conversationID == "" {
		return s.CreateConversation(ctx, agentID, ptid, title, description, modelName, providerID)
	}
	if agentID == "" || ptid == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "agent_id and ptid are required", nil)
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = "New Chat"
	}
	now := time.Now()
	row := &persistence.Conversation{
		ID:         conversationID,
		AgentID:    agentID,
		ActorPTID:  ptid,
		Title:      title,
		ProviderID: firstNonEmpty(providerID, ""),
		Status:     string(domain.ConversationStatusActive),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if description != "" {
		row.Description = &description
	}
	if modelName != "" {
		row.ModelName = &modelName
	}
	if err := db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to create conversation", err)
	}
	logger.Infof(ctx, "conversation created with id: conv_id=%s agent_id=%s ptid=%s", row.ID, agentID, ptid)
	conversation, conversionErr := persistenceConversationToDomain(row)
	if conversionErr != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to decode conversation runtime binding", conversionErr)
	}
	return conversation, nil
}

func (s *ConversationService) UpdateConversation(
	ctx context.Context,
	ptid string,
	conversationID string,
	expectedVersion uint64,
	title string,
	description string,
	modelName string,
	meta map[string]string,
	activeBranchMessageID *string,
) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	ptid = strings.TrimSpace(ptid)
	conversationID = strings.TrimSpace(conversationID)
	if ptid == "" || conversationID == "" || expectedVersion == 0 {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "ptid, conversation_id and expected_version are required", nil)
	}

	updates := map[string]interface{}{
		"updated_at": time.Now(),
		"version":    gorm.Expr("version + 1"),
	}
	if strings.TrimSpace(title) != "" {
		updates["title"] = title
	}
	if description != "" {
		updates["description"] = description
	}
	if strings.TrimSpace(modelName) != "" {
		updates["model_name"] = modelName
	}
	if len(meta) > 0 {
		var row persistence.Conversation
		if err := db.WithContext(ctx).
			Select("meta").
			Where("id = ? AND actor_ptid = ? AND version = ?", conversationID, ptid, expectedVersion).
			First(&row).Error; err != nil {
			return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
				"conversation missing, not owned, or version changed", err)
		}
		mergedMeta := make(map[string]string, len(meta))
		if len(row.Meta) > 0 {
			_ = json.Unmarshal(row.Meta, &mergedMeta)
		}
		for key, value := range meta {
			mergedMeta[key] = value
		}
		metaJSON, _ := json.Marshal(mergedMeta)
		updates["meta"] = metaJSON
	}
	if activeBranchMessageID != nil {
		updates["active_branch_message_id"] = strings.TrimSpace(*activeBranchMessageID)
	}

	result := db.WithContext(ctx).Model(&persistence.Conversation{}).
		Where("id = ? AND actor_ptid = ? AND version = ?", conversationID, ptid, expectedVersion).
		Updates(updates)
	if result.Error != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update conversation", result.Error)
	}
	if result.RowsAffected != 1 {
		return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict, "conversation missing, not owned, or version changed", nil)
	}
	return s.GetConversation(ctx, ptid, conversationID)
}

// SetMessageTranslation persists a translation for an existing message by
// merging it into the message's metadata_json column (R10). Passing an empty
// translation clears it. No proto/schema change — translation lives in metadata.
func (s *ConversationService) SetMessageTranslation(ctx context.Context, ptid, messageID, translation string) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	ptid = strings.TrimSpace(ptid)
	messageID = strings.TrimSpace(messageID)
	if ptid == "" || messageID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "ptid and message_id are required", nil)
	}

	var row persistence.AgentMessage
	if err := db.WithContext(ctx).Table("agent_messages AS message").
		Select("message.*").
		Joins("JOIN agent_conversations AS conversation ON conversation.id = message.conversation_id").
		Where("message.id = ? AND conversation.actor_ptid = ?", messageID, ptid).
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusNotFound, "message not found", err)
		}
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load message", err)
	}

	meta := map[string]interface{}{}
	if len(row.MetadataJSON) > 0 {
		_ = json.Unmarshal(row.MetadataJSON, &meta)
	}
	if strings.TrimSpace(translation) == "" {
		delete(meta, "translation")
	} else {
		meta["translation"] = translation
	}
	metaJSON, _ := json.Marshal(meta)

	if err := db.WithContext(ctx).Model(&persistence.AgentMessage{}).Where("id = ?", messageID).
		Updates(map[string]interface{}{"metadata_json": metaJSON, "updated_at": time.Now()}).Error; err != nil {
		return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to update message translation", err)
	}
	return nil
}

func (s *ConversationService) ArchiveConversation(ctx context.Context, ptid, conversationID string, permanent bool, expectedVersion uint64) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	ptid = strings.TrimSpace(ptid)
	conversationID = strings.TrimSpace(conversationID)
	if ptid == "" || conversationID == "" || expectedVersion == 0 {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "ptid, conversation_id and expected_version are required", nil)
	}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conversation persistence.Conversation
		if queryErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND actor_ptid = ? AND version = ?", conversationID, ptid, expectedVersion).
			First(&conversation).Error; queryErr != nil {
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"conversation missing, not owned, or version changed",
				queryErr,
			)
		}
		if conversation.Status == string(domain.ConversationStatusDeleted) {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"deleted conversation cannot be mutated",
				nil,
			)
		}
		status := string(domain.ConversationStatusArchived)
		if permanent {
			if dependencyErr := rejectConversationDeletionDependencies(tx, conversation.ID); dependencyErr != nil {
				return dependencyErr
			}
			status = string(domain.ConversationStatusDeleted)
		}
		if updateErr := tx.Model(&conversation).Updates(map[string]interface{}{
			"status":     status,
			"updated_at": time.Now(),
			"version":    gorm.Expr("version + 1"),
		}).Error; updateErr != nil {
			return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to archive conversation", updateErr)
		}
		return nil
	})
	if err != nil {
		return err
	}
	logger.Infof(ctx, "conversation archived: conv_id=%s permanent=%v", conversationID, permanent)
	return nil
}

func (s *ConversationService) RestoreConversation(
	ctx context.Context,
	ptid string,
	conversationID string,
	expectedVersion uint64,
) (*domain.Conversation, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	ptid = strings.TrimSpace(ptid)
	conversationID = strings.TrimSpace(conversationID)
	if ptid == "" || conversationID == "" || expectedVersion == 0 {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"ptid, conversation_id and expected_version are required",
			nil,
		)
	}
	result := db.WithContext(ctx).Model(&persistence.Conversation{}).
		Where(
			"id = ? AND actor_ptid = ? AND version = ? AND status = ?",
			conversationID,
			ptid,
			expectedVersion,
			string(domain.ConversationStatusArchived),
		).
		Updates(map[string]interface{}{
			"status":     string(domain.ConversationStatusActive),
			"updated_at": time.Now(),
			"version":    gorm.Expr("version + 1"),
		})
	if result.Error != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to restore conversation",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"conversation is not archived or version changed",
			nil,
		)
	}
	return s.GetConversation(ctx, ptid, conversationID)
}

func rejectConversationDeletionDependencies(tx *gorm.DB, conversationID string) error {
	var activeTurns int64
	if err := tx.Model(&persistence.AgentTurn{}).
		Where(
			"conversation_id = ? AND status IN ?",
			conversationID,
			[]string{
				string(domain.TurnStatusRunning),
				string(domain.TurnStatusWaitingLocalTool),
			},
		).
		Count(&activeTurns).Error; err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"count active conversation turns",
			err,
		)
	}
	var pendingTurns int64
	if err := tx.Model(&persistence.TurnQueueEntry{}).
		Where("conversation_id = ? AND status = ?", conversationID, queueStatusPending).
		Count(&pendingTurns).Error; err != nil {
		return errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"count pending conversation turns",
			err,
		)
	}
	if activeTurns > 0 || pendingTurns > 0 {
		return errcode.New(
			errcode.AgentActiveDependency,
			http.StatusConflict,
			"conversation has active or queued turns",
			nil,
		)
	}
	return nil
}

func (s *ConversationService) ListMessages(ctx context.Context, ptid, conversationID string, afterSeq, beforeSeq int64, limit int) ([]*domain.Message, int64, bool, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, 0, false, err
	}
	ptid = strings.TrimSpace(ptid)
	conversationID = strings.TrimSpace(conversationID)
	if ptid == "" || conversationID == "" {
		return nil, 0, false, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "ptid and conversation_id are required", nil)
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	var conversation persistence.Conversation
	if err := db.WithContext(ctx).
		Select("active_branch_message_id").
		Where("id = ? AND actor_ptid = ? AND status != ?", conversationID, ptid, "deleted").
		First(&conversation).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, 0, false, nil
		}
		return nil, 0, false, errcode.New(errcode.AgentInternal, http.StatusInternalServerError,
			"failed to load conversation projection", err)
	}

	var rows []persistence.AgentMessage
	if err := db.WithContext(ctx).
		Where("conversation_id = ? AND tombstoned_at IS NULL", conversationID).
		Order("seq ASC").
		Find(&rows).Error; err != nil {
		return nil, 0, false, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to list messages", err)
	}

	messageValues := make([]domain.Message, 0, len(rows))
	for i := range rows {
		messageValues = append(messageValues, *persistenceAgentMessageToDomain(&rows[i]))
	}
	if conversation.ActiveBranchMessageID != "" {
		messageValues = projectMessageBranch(messageValues, conversation.ActiveBranchMessageID)
	}
	filtered := make([]domain.Message, 0, len(messageValues))
	for _, message := range messageValues {
		if afterSeq > 0 && message.Seq <= afterSeq {
			continue
		}
		if beforeSeq > 0 && message.Seq >= beforeSeq {
			continue
		}
		filtered = append(filtered, message)
	}
	hasMore := len(filtered) > limit
	if hasMore {
		filtered = filtered[:limit]
	}
	nextCursor := int64(0)
	if len(filtered) > 0 {
		nextCursor = filtered[len(filtered)-1].Seq
	}
	if !hasMore {
		nextCursor = 0
	}
	result := make([]*domain.Message, len(filtered))
	for i := range filtered {
		result[i] = &filtered[i]
	}
	return result, nextCursor, hasMore, nil
}

func (s *ConversationService) PersistTurnEvent(ctx context.Context, conversationID, turnID, eventType string, payload map[string]interface{}) (int64, error) {
	return s.PersistTurnAttemptEvent(ctx, conversationID, turnID, "", eventType, payload)
}

func (s *ConversationService) PersistTurnAttemptEvent(
	ctx context.Context,
	conversationID string,
	turnID string,
	attemptID string,
	eventType string,
	payload map[string]interface{},
) (int64, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, err
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return 0, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"failed to encode turn event",
			err,
		)
	}
	var seq int64
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var persistErr error
		seq, persistErr = s.persistTurnEventTx(
			tx,
			conversationID,
			turnID,
			attemptID,
			eventType,
			payloadBytes,
			time.Now(),
		)
		return persistErr
	}); err != nil {
		return 0, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to persist turn event", err)
	}
	s.notifyTurnEvent(conversationID, turnID)
	return seq, nil
}

func (s *ConversationService) PersistTurnTextEvent(
	ctx context.Context,
	conversationID string,
	turnID string,
	attemptID string,
	assistantMessageID string,
	modelName string,
	branchID string,
	parentMessageID string,
	replacesMessageID string,
	payload interface{},
	text string,
) (int64, string, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return 0, "", err
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return 0, "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to encode turn text event", err)
	}
	var seq int64
	persistedAssistantMessageID := strings.TrimSpace(assistantMessageID)
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var turn persistence.AgentTurn
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND conversation_id = ?", turnID, conversationID).
			First(&turn).Error; err != nil {
			return err
		}
		if turn.Status != string(domain.TurnStatusRunning) &&
			turn.Status != string(domain.TurnStatusWaitingLocalTool) {
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"terminal turn rejects text projection",
				nil,
			)
		}
		var persistErr error
		seq, persistErr = s.persistTurnEventTx(
			tx,
			conversationID,
			turnID,
			attemptID,
			"text",
			payloadBytes,
			time.Now(),
		)
		if persistErr != nil {
			return persistErr
		}
		if persistedAssistantMessageID == "" {
			var conversation persistence.Conversation
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", conversationID).
				First(&conversation).Error; err != nil {
				return err
			}
			var maxSeq struct{ MaxSeq int64 }
			if err := tx.Model(&persistence.AgentMessage{}).
				Where("conversation_id = ?", conversationID).
				Select("COALESCE(MAX(seq), 0) AS max_seq").
				Scan(&maxSeq).Error; err != nil {
				return err
			}
			persistedAssistantMessageID = generateID("msg")
			effectiveParentID := strings.TrimSpace(parentMessageID)
			if effectiveParentID == "" {
				effectiveParentID = conversation.ActiveBranchMessageID
			}
			message := persistence.AgentMessage{
				ID:                persistedAssistantMessageID,
				ConversationID:    conversationID,
				TurnID:            optionalString(turnID),
				ModelName:         optionalString(modelName),
				Role:              string(domain.MessageRoleAssistant),
				Status:            "pending",
				Content:           optionalString(text),
				Seq:               maxSeq.MaxSeq + 1,
				BranchID:          optionalString(branchID),
				ParentMessageID:   optionalString(effectiveParentID),
				ReplacesMessageID: optionalString(replacesMessageID),
				CreatedAt:         time.Now(),
				UpdatedAt:         time.Now(),
			}
			if err := tx.Create(&message).Error; err != nil {
				return err
			}
			return tx.Model(&conversation).Updates(map[string]interface{}{
				"active_branch_message_id": message.ID,
				"updated_at":               time.Now(),
				"version":                  gorm.Expr("version + 1"),
			}).Error
		}
		result := tx.Model(&persistence.AgentMessage{}).
			Where(
				"id = ? AND conversation_id = ? AND turn_id = ? AND role = ? AND status = ?",
				persistedAssistantMessageID,
				conversationID,
				turnID,
				string(domain.MessageRoleAssistant),
				"pending",
			).
			Update("content", gorm.Expr("COALESCE(content, '') || ?", text))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"pending assistant message changed before text projection",
				nil,
			)
		}
		return nil
	}); err != nil {
		return 0, "", errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to persist turn text projection", err)
	}
	s.notifyTurnEvent(conversationID, turnID)
	return seq, persistedAssistantMessageID, nil
}

func (s *ConversationService) persistTurnEventTx(
	tx *gorm.DB,
	conversationID string,
	turnID string,
	attemptID string,
	eventType string,
	payload []byte,
	now time.Time,
) (int64, error) {
	var turn persistence.AgentTurn
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND conversation_id = ?", turnID, conversationID).
		First(&turn).Error; err != nil {
		if err != gorm.ErrRecordNotFound {
			return 0, err
		}
		var conversation persistence.Conversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", conversationID).
			First(&conversation).Error; err != nil {
			return 0, err
		}
	}
	var maxSeq struct{ MaxSeq int64 }
	if err := tx.Model(&persistence.TurnEvent{}).
		Where("turn_id = ?", turnID).
		Select("COALESCE(MAX(event_seq), 0) AS max_seq").
		Scan(&maxSeq).Error; err != nil {
		return 0, err
	}
	seq := maxSeq.MaxSeq + 1
	return seq, tx.Create(&persistence.TurnEvent{
		ID:             generateID("tevt"),
		ConversationID: conversationID,
		TurnID:         turnID,
		AttemptID:      strings.TrimSpace(attemptID),
		EventSeq:       seq,
		EventType:      eventType,
		Payload:        string(payload),
		CreatedAt:      now,
	}).Error
}

func (s *ConversationService) PersistUserMessage(ctx context.Context, conversationID, content, turnID string) (*domain.Message, error) {
	return s.persistMessage(ctx, conversationID, "user", content, "", turnID)
}

func (s *ConversationService) PersistAssistantMessage(ctx context.Context, conversationID, content, modelName, turnID string) (*domain.Message, error) {
	return s.persistMessage(ctx, conversationID, "assistant", content, modelName, turnID)
}

func (s *ConversationService) persistMessage(ctx context.Context, conversationID, role, content, modelName, turnID string) (*domain.Message, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "conversation_id is required", nil)
	}

	row := &persistence.AgentMessage{}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conversation persistence.Conversation
		if err := tx.First(&conversation, "id = ?", conversationID).Error; err != nil {
			return err
		}
		var maxSeq struct{ MaxSeq int64 }
		if err := tx.Model(&persistence.AgentMessage{}).
			Where("conversation_id = ?", conversationID).
			Select("COALESCE(MAX(seq), 0) as max_seq").
			Scan(&maxSeq).Error; err != nil {
			return err
		}
		*row = persistence.AgentMessage{
			ID:              generateID("amsg"),
			ConversationID:  conversationID,
			Role:            role,
			Status:          "completed",
			Content:         &content,
			Seq:             maxSeq.MaxSeq + 1,
			ParentMessageID: optionalString(conversation.ActiveBranchMessageID),
		}
		if modelName != "" {
			row.ModelName = &modelName
		}
		if turnID != "" {
			row.TurnID = &turnID
		}
		if err := tx.Create(row).Error; err != nil {
			return err
		}
		return tx.Model(&conversation).Updates(map[string]interface{}{
			"active_branch_message_id": row.ID,
			"updated_at":               time.Now(),
			"version":                  gorm.Expr("version + 1"),
		}).Error
	}); err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to persist message", err)
	}
	return persistenceAgentMessageToDomain(row), nil
}

func (s *ConversationService) ReplayTurnEvents(ctx context.Context, ptid, conversationID, turnID string, afterSeq int64) ([]*persistence.TurnEvent, error) {
	return s.ReplayTurnEventsThrough(ctx, ptid, conversationID, turnID, afterSeq, math.MaxInt64)
}

func (s *ConversationService) ReplayTurnEventsThrough(
	ctx context.Context,
	ptid string,
	conversationID string,
	turnID string,
	afterSeq int64,
	throughSeq int64,
) ([]*persistence.TurnEvent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	ptid = strings.TrimSpace(ptid)
	conversationID = strings.TrimSpace(conversationID)
	turnID = strings.TrimSpace(turnID)
	if ptid == "" || conversationID == "" || turnID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "ptid, conversation_id, and turn_id are required", nil)
	}
	if throughSeq < afterSeq {
		return []*persistence.TurnEvent{}, nil
	}
	fence, err := loadCurrentTurnEventFence(db.WithContext(ctx), turnID)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load current turn attempt fence", err)
	}
	return s.replayTurnEventsThroughFence(
		ctx,
		ptid,
		conversationID,
		turnID,
		afterSeq,
		throughSeq,
		fence,
	)
}

func (s *ConversationService) ReplayTurnEventsThroughFence(
	ctx context.Context,
	ptid string,
	conversationID string,
	turnID string,
	afterSeq int64,
	throughSeq int64,
	fence *TurnEventReplayFence,
) ([]*persistence.TurnEvent, error) {
	return s.replayTurnEventsThroughFence(
		ctx,
		ptid,
		conversationID,
		turnID,
		afterSeq,
		throughSeq,
		fence,
	)
}

func (s *ConversationService) replayTurnEventsThroughFence(
	ctx context.Context,
	ptid string,
	conversationID string,
	turnID string,
	afterSeq int64,
	throughSeq int64,
	fence *TurnEventReplayFence,
) ([]*persistence.TurnEvent, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	ptid = strings.TrimSpace(ptid)
	conversationID = strings.TrimSpace(conversationID)
	turnID = strings.TrimSpace(turnID)
	if ptid == "" || conversationID == "" || turnID == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "ptid, conversation_id, and turn_id are required", nil)
	}
	if throughSeq < afterSeq {
		return []*persistence.TurnEvent{}, nil
	}
	var rows []persistence.TurnEvent
	query := db.WithContext(ctx).Table("agent_turn_events AS event").
		Select("event.*").
		Joins("JOIN agent_conversations AS conversation ON conversation.id = event.conversation_id").
		Where(
			"event.conversation_id = ? AND event.turn_id = ? AND event.event_seq <= ? AND conversation.actor_ptid = ?",
			conversationID,
			turnID,
			throughSeq,
			ptid,
		)
	query = applyTurnEventFence(query, "event", fence)
	if afterSeq > 0 {
		query = query.Where("event.event_seq > ?", afterSeq)
	}
	if err := query.Order("event.event_seq ASC").Find(&rows).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to replay turn events", err)
	}
	result := make([]*persistence.TurnEvent, len(rows))
	for i := range rows {
		result[i] = &rows[i]
	}
	return result, nil
}

type TurnEventSnapshot struct {
	TurnID         string
	ConversationID string
	AgentID        string
	Status         string
	Text           string
	LastSequence   int64
	TerminalReason string
	UpdatedAt      time.Time
}

func (s *ConversationService) GetTurnEventSnapshot(ctx context.Context, ptid, conversationID, turnID string) (*TurnEventSnapshot, error) {
	return s.GetTurnEventSnapshotAt(ctx, ptid, conversationID, turnID, math.MaxInt64)
}

func (s *ConversationService) GetTurnEventSnapshotAt(
	ctx context.Context,
	ptid string,
	conversationID string,
	turnID string,
	throughSeq int64,
) (*TurnEventSnapshot, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	fence, err := loadCurrentTurnEventFence(db.WithContext(ctx), turnID)
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load current turn attempt fence", err)
	}
	return s.getTurnEventSnapshotAtFence(
		ctx,
		ptid,
		conversationID,
		turnID,
		throughSeq,
		fence,
	)
}

func (s *ConversationService) GetTurnEventSnapshotAtFence(
	ctx context.Context,
	ptid string,
	conversationID string,
	turnID string,
	throughSeq int64,
	fence *TurnEventReplayFence,
) (*TurnEventSnapshot, error) {
	return s.getTurnEventSnapshotAtFence(
		ctx,
		ptid,
		conversationID,
		turnID,
		throughSeq,
		fence,
	)
}

func (s *ConversationService) getTurnEventSnapshotAtFence(
	ctx context.Context,
	ptid string,
	conversationID string,
	turnID string,
	throughSeq int64,
	fence *TurnEventReplayFence,
) (*TurnEventSnapshot, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var turn persistence.AgentTurn
	if err := db.WithContext(ctx).Table("agent_turns AS turn").
		Select("turn.*").
		Joins("JOIN agent_conversations AS conversation ON conversation.id = turn.conversation_id").
		Where("turn.id = ? AND turn.conversation_id = ? AND conversation.actor_ptid = ?", turnID, conversationID, strings.TrimSpace(ptid)).
		First(&turn).Error; err != nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "turn snapshot not found", err)
	}
	var maxSeq struct{ MaxSeq int64 }
	maxSequenceQuery := db.WithContext(ctx).Model(&persistence.TurnEvent{}).
		Where("turn_id = ? AND event_seq <= ?", turnID, throughSeq)
	maxSequenceQuery = applyTurnEventFence(maxSequenceQuery, "agent_turn_events", fence)
	if err := maxSequenceQuery.
		Select("COALESCE(MAX(event_seq), 0) AS max_seq").
		Scan(&maxSeq).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load turn snapshot cursor", err)
	}
	var terminalEventCount int64
	terminalQuery := db.WithContext(ctx).Model(&persistence.TurnEvent{}).
		Where(
			"turn_id = ? AND event_seq <= ? AND event_type IN ?",
			turnID,
			maxSeq.MaxSeq,
			[]string{"done", "error", "cancelled"},
		)
	terminalQuery = applyTurnEventFence(terminalQuery, "agent_turn_events", fence)
	if err := terminalQuery.
		Count(&terminalEventCount).Error; err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load turn snapshot terminal state", err)
	}
	var terminalEvent persistence.TurnEvent
	if terminalEventCount > 0 {
		latestTerminalQuery := db.WithContext(ctx).Model(&persistence.TurnEvent{}).
			Where(
				"turn_id = ? AND event_seq <= ? AND event_type IN ?",
				turnID,
				maxSeq.MaxSeq,
				[]string{"done", "error", "cancelled"},
			)
		latestTerminalQuery = applyTurnEventFence(
			latestTerminalQuery,
			"agent_turn_events",
			fence,
		)
		if err := latestTerminalQuery.
			Order("event_seq DESC").
			First(&terminalEvent).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load fenced terminal turn event", err)
		}
	}
	status := turn.Status
	if fence != nil && fence.attemptID != "" {
		var attempt persistence.TurnAttempt
		if err := db.WithContext(ctx).
			Select("status").
			Where("id = ? AND turn_id = ?", fence.attemptID, turnID).
			First(&attempt).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load fenced turn attempt status", err)
		}
		status = attempt.Status
	}
	if terminalEventCount == 0 && isTerminalTurnDomainStatus(domain.TurnStatus(status)) {
		status = string(domain.TurnStatusRunning)
	}
	updatedAt := turn.StartedAt
	var lastEvent persistence.TurnEvent
	if maxSeq.MaxSeq > 0 {
		lastEventQuery := db.WithContext(ctx).
			Where("turn_id = ? AND event_seq = ?", turnID, maxSeq.MaxSeq).
			Model(&persistence.TurnEvent{})
		lastEventQuery = applyTurnEventFence(lastEventQuery, "agent_turn_events", fence)
		if err := lastEventQuery.
			First(&lastEvent).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to load turn snapshot timestamp", err)
		}
		updatedAt = lastEvent.CreatedAt
	}
	snapshot := &TurnEventSnapshot{
		TurnID:         turn.ID,
		ConversationID: turn.ConversationID,
		AgentID:        turn.AgentID,
		Status:         status,
		LastSequence:   maxSeq.MaxSeq,
		UpdatedAt:      updatedAt,
	}
	if fence == nil &&
		terminalEventCount > 0 &&
		turn.Status == string(domain.TurnStatusCompleted) &&
		turn.FinalResponse != nil {
		snapshot.Text = *turn.FinalResponse
	} else {
		var textEvents []persistence.TurnEvent
		textQuery := db.WithContext(ctx).Model(&persistence.TurnEvent{}).
			Where("turn_id = ? AND event_type = ? AND event_seq <= ?", turnID, "text", maxSeq.MaxSeq)
		textQuery = applyTurnEventFence(textQuery, "agent_turn_events", fence)
		if err := textQuery.
			Order("event_seq ASC").
			Find(&textEvents).Error; err != nil {
			return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "failed to fold turn snapshot text", err)
		}
		var text strings.Builder
		for i := range textEvents {
			var payload map[string]interface{}
			if json.Unmarshal([]byte(textEvents[i].Payload), &payload) != nil {
				continue
			}
			for _, key := range []string{"text", "content", "result"} {
				if value, ok := payload[key].(string); ok {
					text.WriteString(value)
					break
				}
			}
		}
		snapshot.Text = text.String()
	}
	if terminalEventCount > 0 && (status == string(domain.TurnStatusFailed) ||
		status == string(domain.TurnStatusCancelled) ||
		status == string(domain.TurnStatusInterrupted)) {
		if fence == nil {
			snapshot.TerminalReason = strings.TrimSpace(turn.TerminalReason)
		} else {
			var payload map[string]interface{}
			if err := json.Unmarshal([]byte(terminalEvent.Payload), &payload); err != nil {
				return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "decode fenced terminal turn event", err)
			}
			for _, key := range []string{"terminal_reason", "error", "stage"} {
				if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
					snapshot.TerminalReason = strings.TrimSpace(value)
					break
				}
			}
		}
		if snapshot.TerminalReason == "" {
			snapshot.TerminalReason = status
		}
	}
	return snapshot, nil
}

type TurnEventReplayFence struct {
	attemptID string
	startedAt time.Time
}

func loadCurrentTurnEventFence(db *gorm.DB, turnID string) (*TurnEventReplayFence, error) {
	var attempt persistence.TurnAttempt
	if err := db.
		Select("id", "started_at").
		Where("turn_id = ?", turnID).
		Order("attempt_index DESC").
		First(&attempt).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &TurnEventReplayFence{
		attemptID: strings.TrimSpace(attempt.ID),
		startedAt: attempt.StartedAt,
	}, nil
}

func applyTurnEventFence(query *gorm.DB, table string, fence *TurnEventReplayFence) *gorm.DB {
	if fence == nil || fence.attemptID == "" {
		return query
	}
	prefix := table + "."
	return query.Where(
		"("+prefix+"attempt_id = ? OR ("+prefix+"attempt_id = '' AND "+prefix+"created_at >= ?))",
		fence.attemptID,
		fence.startedAt,
	)
}

func isTerminalTurnDomainStatus(status domain.TurnStatus) bool {
	switch status {
	case domain.TurnStatusCompleted,
		domain.TurnStatusFailed,
		domain.TurnStatusCancelled,
		domain.TurnStatusInterrupted:
		return true
	default:
		return false
	}
}

func persistenceConversationToDomain(row *persistence.Conversation) (*domain.Conversation, error) {
	c := &domain.Conversation{
		ConversationID:        row.ID,
		AgentID:               row.AgentID,
		ActorPTID:             row.ActorPTID,
		Title:                 row.Title,
		ProviderID:            row.ProviderID,
		Status:                domain.ConversationStatus(row.Status),
		ActiveBranchMessageID: row.ActiveBranchMessageID,
		QueuedTurnCount:       row.QueuedTurnCount,
		Version:               row.Version,
		CreatedAt:             row.CreatedAt,
		UpdatedAt:             row.UpdatedAt,
	}
	if row.Description != nil {
		c.Description = *row.Description
	}
	if row.ModelName != nil {
		c.ModelName = *row.ModelName
	}
	if row.ParentID != nil {
		c.ParentID = *row.ParentID
	}
	if len(row.Meta) > 0 {
		_ = json.Unmarshal(row.Meta, &c.Meta)
	}
	if len(row.ConfigJSON) > 0 {
		c.ConfigJSON = row.ConfigJSON
	}
	binding, err := persistence.UnmarshalConversationRuntimeBinding(row.RuntimeBinding)
	if err != nil {
		return nil, err
	}
	c.RuntimeBinding = binding
	return c, nil
}

func persistenceAgentMessageToDomain(row *persistence.AgentMessage) *domain.Message {
	m := &domain.Message{
		MessageID:       row.ID,
		ConversationID:  row.ConversationID,
		ModelName:       "",
		Role:            domain.MessageRole(row.Role),
		Status:          row.Status,
		Content:         "",
		ReasoningJSON:   row.ReasoningJSON,
		ToolCallsJSON:   row.ToolCallsJSON,
		MetadataJSON:    row.MetadataJSON,
		ErrorJSON:       row.ErrorJSON,
		AttachmentsJSON: row.AttachmentsJSON,
		Seq:             row.Seq,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
	if row.TurnID != nil {
		m.TurnID = *row.TurnID
	}
	if row.ModelName != nil {
		m.ModelName = *row.ModelName
	}
	if row.Content != nil {
		m.Content = *row.Content
	}
	if row.BranchID != nil {
		m.BranchID = *row.BranchID
	}
	if row.ReplacesMessageID != nil {
		m.ReplacesMessageID = *row.ReplacesMessageID
	}
	if row.ParentMessageID != nil {
		m.ParentMessageID = *row.ParentMessageID
	}
	if row.ThreadID != nil {
		m.ThreadID = *row.ThreadID
	}
	if row.TombstonedAt != nil {
		m.TombstonedAt = row.TombstonedAt
	}
	if row.TombstonedByPtid != nil {
		m.TombstonedByPtid = *row.TombstonedByPtid
	}
	if row.TombstoneReason != nil {
		m.TombstoneReason = *row.TombstoneReason
	}
	return m
}
