package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
)

const (
	turnQueueCapacity    = uint32(8)
	queueStatusPending   = "pending"
	queueStatusAdmitted  = "admitted"
	queueStatusCancelled = "cancelled"
)

type TurnAdmissionService struct {
	db               *gorm.DB
	now              func() time.Time
	requestPreflight func(context.Context, string, *model.ExecuteTurnRequest) error
}

type AdmittedTurn struct {
	Admission *model.TurnAdmission
	Request   *model.ExecuteTurnRequest
}

type PendingTurnConversation struct {
	ActorID        string
	ConversationID string
}

type NewConversationAdmission struct {
	ConversationID string
	Title          string
	ProviderID     string
	ModelName      string
}

func NewTurnAdmissionService() *TurnAdmissionService {
	return &TurnAdmissionService{
		now: func() time.Time { return time.Now().UTC() },
	}
}

func newTurnAdmissionServiceWithDB(db *gorm.DB) *TurnAdmissionService {
	return &TurnAdmissionService{
		db:  db,
		now: func() time.Time { return time.Now().UTC() },
		requestPreflight: func(
			context.Context,
			string,
			*model.ExecuteTurnRequest,
		) error {
			return nil
		},
	}
}

func (s *TurnAdmissionService) SetRequestPreflight(
	preflight func(context.Context, string, *model.ExecuteTurnRequest) error,
) {
	s.requestPreflight = preflight
}

// AdmitNewConversation atomically creates a Conversation and its first
// admitted Turn. The caller must provide a deterministic conversation ID so a
// repeated actor-scoped Home command can recover the original result.
func (s *TurnAdmissionService) AdmitNewConversation(
	ctx context.Context,
	actorID string,
	request *model.ExecuteTurnRequest,
	spec NewConversationAdmission,
	commandPayloadHash string,
) (*model.TurnAdmission, bool, error) {
	actorID = strings.TrimSpace(actorID)
	spec.ConversationID = strings.TrimSpace(spec.ConversationID)
	if actorID == "" || request == nil ||
		spec.ConversationID == "" ||
		strings.TrimSpace(request.GetAgentId()) == "" ||
		strings.TrimSpace(request.GetUserInput()) == "" ||
		strings.TrimSpace(request.GetClientIdempotencyKey()) == "" {
		return nil, false, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"actor, conversation_id, agent_id, user_input, and client_idempotency_key are required",
			nil,
		)
	}
	request.ConversationId = spec.ConversationID
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return nil, false, admissionInternal("encode first turn admission payload", err)
	}
	payloadHash := sha256BytesHex(payload)
	if strings.TrimSpace(commandPayloadHash) != "" {
		payloadHash = strings.TrimSpace(commandPayloadHash)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, false, err
	}

	if replay, found, replayErr := findNewConversationAdmissionReplay(
		db.WithContext(ctx),
		actorID,
		request,
		payloadHash,
	); replayErr != nil || found {
		return replay, false, replayErr
	}
	if s.requestPreflight == nil {
		return nil, false, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"turn admission preflight is unavailable",
			nil,
		)
	}
	if err := s.requestPreflight(ctx, actorID, request); err != nil {
		return nil, false, err
	}

	var admission *model.TurnAdmission
	created := false
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replay, found, replayErr := findNewConversationAdmissionReplay(
			tx,
			actorID,
			request,
			payloadHash,
		)
		if replayErr != nil || found {
			admission = replay
			return replayErr
		}

		now := s.now()
		title := strings.TrimSpace(spec.Title)
		if title == "" {
			title = "New Chat"
		}
		conversation := &persistence.Conversation{
			ID:         spec.ConversationID,
			AgentID:    strings.TrimSpace(request.GetAgentId()),
			ActorPTID:  actorID,
			Title:      title,
			ProviderID: strings.TrimSpace(spec.ProviderID),
			Status:     string(domain.ConversationStatusActive),
			Version:    2,
			CreatedAt:  now,
			UpdatedAt:  now,
		}
		if modelName := strings.TrimSpace(spec.ModelName); modelName != "" {
			conversation.ModelName = &modelName
		}
		if err := tx.Create(conversation).Error; err != nil {
			return admissionInternal("create admitted Home conversation", err)
		}

		key := request.GetClientIdempotencyKey()
		turn := &persistence.AgentTurn{
			ID:                   NewTurnID(),
			ConversationID:       conversation.ID,
			AgentID:              request.GetAgentId(),
			ClientIdempotencyKey: &key,
			AdmissionPayloadHash: payloadHash,
			UserInput:            stringPointerValue(request.GetUserInput()),
			Status:               string(domain.TurnStatusRunning),
			StartedAt:            now,
		}
		if err := tx.Create(turn).Error; err != nil {
			return admissionInternal("create admitted Home turn", err)
		}
		admission = &model.TurnAdmission{
			Status:              model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED,
			TurnId:              turn.ID,
			QueueCapacity:       turnQueueCapacity,
			ConversationVersion: conversation.Version,
		}
		created = true
		return nil
	})
	if err != nil {
		replay, found, replayErr := findNewConversationAdmissionReplay(
			db.WithContext(ctx),
			actorID,
			request,
			payloadHash,
		)
		if replayErr == nil && found {
			return replay, false, nil
		}
		return nil, false, err
	}
	return admission, created, nil
}

func (s *TurnAdmissionService) Admit(
	ctx context.Context,
	actorID string,
	request *model.ExecuteTurnRequest,
	preferredTurnID ...string,
) (*model.TurnAdmission, error) {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || request == nil ||
		strings.TrimSpace(request.GetConversationId()) == "" ||
		strings.TrimSpace(request.GetAgentId()) == "" ||
		strings.TrimSpace(request.GetUserInput()) == "" ||
		strings.TrimSpace(request.GetClientIdempotencyKey()) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"actor, conversation_id, agent_id, user_input, and client_idempotency_key are required",
			nil,
		)
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return nil, errcode.New(
			errcode.AgentInternal,
			http.StatusInternalServerError,
			"encode turn admission payload",
			err,
		)
	}
	payloadHash := sha256BytesHex(payload)
	now := s.now()
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var existing *model.TurnAdmission
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		conversation, lockErr := lockAdmissionConversation(
			tx,
			actorID,
			request.GetConversationId(),
			request.GetAgentId(),
		)
		if lockErr != nil {
			return lockErr
		}
		replay, replayErr := findAdmissionReplay(
			tx,
			conversation,
			request.GetClientIdempotencyKey(),
			payloadHash,
		)
		existing = replay
		return replayErr
	})
	if err != nil || existing != nil {
		return existing, err
	}
	if s.requestPreflight == nil {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"turn admission preflight is unavailable",
			nil,
		)
	}
	if err := s.requestPreflight(ctx, actorID, request); err != nil {
		return nil, err
	}

	var admission *model.TurnAdmission
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		conversation, lockErr := lockAdmissionConversation(
			tx,
			actorID,
			request.GetConversationId(),
			request.GetAgentId(),
		)
		if lockErr != nil {
			return lockErr
		}
		if replay, replayErr := findAdmissionReplay(
			tx,
			conversation,
			request.GetClientIdempotencyKey(),
			payloadHash,
		); replayErr != nil || replay != nil {
			admission = replay
			return replayErr
		}

		var activeCount int64
		if countErr := tx.Model(&persistence.AgentTurn{}).
			Where(
				"conversation_id = ? AND status IN ?",
				conversation.ID,
				[]string{
					string(domain.TurnStatusRunning),
					string(domain.TurnStatusWaitingLocalTool),
				},
			).
			Count(&activeCount).Error; countErr != nil {
			return admissionInternal("count active conversation turns", countErr)
		}

		nextVersion := conversation.Version + 1
		if activeCount == 0 {
			key := request.GetClientIdempotencyKey()
			turnID := ""
			if len(preferredTurnID) > 0 {
				turnID = strings.TrimSpace(preferredTurnID[0])
			}
			if turnID == "" {
				turnID = NewTurnID()
			}
			turn := &persistence.AgentTurn{
				ID:                   turnID,
				ConversationID:       conversation.ID,
				AgentID:              request.GetAgentId(),
				ClientIdempotencyKey: &key,
				AdmissionPayloadHash: payloadHash,
				UserInput:            stringPointerValue(request.GetUserInput()),
				Status:               string(domain.TurnStatusRunning),
				StartedAt:            now,
			}
			if createErr := tx.Create(turn).Error; createErr != nil {
				return admissionInternal("create admitted turn", createErr)
			}
			if updateErr := tx.Model(conversation).Updates(map[string]interface{}{
				"version":    nextVersion,
				"updated_at": now,
			}).Error; updateErr != nil {
				return admissionInternal("advance conversation admission version", updateErr)
			}
			admission = &model.TurnAdmission{
				Status:              model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED,
				TurnId:              turn.ID,
				QueueCapacity:       turnQueueCapacity,
				ConversationVersion: nextVersion,
			}
			return nil
		}

		var pendingCount int64
		if countErr := tx.Model(&persistence.TurnQueueEntry{}).
			Where("conversation_id = ? AND status = ?", conversation.ID, queueStatusPending).
			Count(&pendingCount).Error; countErr != nil {
			return admissionInternal("count queued turns", countErr)
		}
		if pendingCount >= int64(turnQueueCapacity) {
			return errcode.NewQueueFull(conversation.ID, turnQueueCapacity)
		}
		var maxSequence uint64
		if sequenceErr := tx.Model(&persistence.TurnQueueEntry{}).
			Where("conversation_id = ?", conversation.ID).
			Select("COALESCE(MAX(queue_sequence), 0)").
			Scan(&maxSequence).Error; sequenceErr != nil {
			return admissionInternal("allocate turn queue sequence", sequenceErr)
		}
		entry := &persistence.TurnQueueEntry{
			ID:                   generateID("queue"),
			ConversationID:       conversation.ID,
			AgentID:              request.GetAgentId(),
			Ptid:                 actorID,
			ClientIdempotencyKey: request.GetClientIdempotencyKey(),
			AdmissionPayloadHash: payloadHash,
			RequestPayload:       payload,
			QueueSequence:        maxSequence + 1,
			Status:               queueStatusPending,
			CreatedAt:            now,
			UpdatedAt:            now,
		}
		if createErr := tx.Create(entry).Error; createErr != nil {
			return admissionInternal("enqueue turn", createErr)
		}
		if updateErr := tx.Model(conversation).Updates(map[string]interface{}{
			"queued_turn_count": pendingCount + 1,
			"version":           nextVersion,
			"updated_at":        now,
		}).Error; updateErr != nil {
			return admissionInternal("update queued turn projection", updateErr)
		}
		admission = &model.TurnAdmission{
			Status: model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_QUEUED,
			QueueEntry: queueEntryToProto(
				entry,
				uint32(pendingCount+1),
			),
			QueueCapacity:       turnQueueCapacity,
			ConversationVersion: nextVersion,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return admission, nil
}

func (s *TurnAdmissionService) List(
	ctx context.Context,
	actorID string,
	conversationID string,
) (*model.ListQueuedTurnsResponse, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var conversation persistence.Conversation
	if err := db.WithContext(ctx).
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(conversationID), strings.TrimSpace(actorID)).
		First(&conversation).Error; err != nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", err)
	}
	var records []persistence.TurnQueueEntry
	if err := db.WithContext(ctx).
		Where("conversation_id = ? AND status = ?", conversation.ID, queueStatusPending).
		Order("queue_sequence ASC").
		Find(&records).Error; err != nil {
		return nil, admissionInternal("list queued turns", err)
	}
	entries := make([]*model.TurnQueueEntry, 0, len(records))
	for index := range records {
		entries = append(entries, queueEntryToProto(&records[index], uint32(index+1)))
	}
	return &model.ListQueuedTurnsResponse{
		Entries:             entries,
		QueueCapacity:       turnQueueCapacity,
		ConversationVersion: conversation.Version,
	}, nil
}

func (s *TurnAdmissionService) Cancel(
	ctx context.Context,
	actorID string,
	request *model.CancelQueuedTurnRequest,
) (*model.CancelQueuedTurnResponse, error) {
	if request == nil || strings.TrimSpace(request.GetIdempotencyKey()) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"cancel queue idempotency_key is required",
			nil,
		)
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var response *model.CancelQueuedTurnResponse
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		conversation, lockErr := lockAdmissionConversation(
			tx,
			actorID,
			request.GetConversationId(),
			"",
		)
		if lockErr != nil {
			return lockErr
		}
		var entry persistence.TurnQueueEntry
		if findErr := tx.Where(
			"id = ? AND conversation_id = ? AND ptid = ?",
			request.GetQueueEntryId(),
			conversation.ID,
			actorID,
		).First(&entry).Error; findErr != nil {
			return errcode.New(errcode.AgentNotFound, http.StatusNotFound, "queued turn not found", findErr)
		}
		if entry.Status == queueStatusCancelled {
			if entry.CancelIdempotencyKey != request.GetIdempotencyKey() {
				return errcode.New(
					errcode.AgentIdempotencyConflict,
					http.StatusConflict,
					"queued turn cancellation idempotency conflict",
					nil,
				)
			}
			response = &model.CancelQueuedTurnResponse{
				Entry:               queueEntryToProto(&entry, 0),
				ConversationVersion: conversation.Version,
				Replayed:            true,
			}
			return nil
		}
		if conversation.Version != request.GetExpectedConversationVersion() {
			return errcode.New(
				errcode.AgentVersionConflict,
				http.StatusConflict,
				"conversation version conflict",
				nil,
			)
		}
		if entry.Status != queueStatusPending {
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"queued turn is no longer pending",
				nil,
			)
		}
		entry.Status = queueStatusCancelled
		entry.CancelIdempotencyKey = request.GetIdempotencyKey()
		entry.CancelledAt = &now
		entry.UpdatedAt = now
		if updateErr := tx.Save(&entry).Error; updateErr != nil {
			return admissionInternal("cancel queued turn", updateErr)
		}
		nextVersion := conversation.Version + 1
		if updateErr := tx.Model(conversation).Updates(map[string]interface{}{
			"queued_turn_count": gorm.Expr(
				"CASE WHEN queued_turn_count > 0 THEN queued_turn_count - 1 ELSE 0 END",
			),
			"version":    nextVersion,
			"updated_at": now,
		}).Error; updateErr != nil {
			return admissionInternal("update cancelled queue projection", updateErr)
		}
		response = &model.CancelQueuedTurnResponse{
			Entry:               queueEntryToProto(&entry, 0),
			ConversationVersion: nextVersion,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return response, nil
}

func (s *TurnAdmissionService) AdmitNext(
	ctx context.Context,
	actorID string,
	conversationID string,
) (*AdmittedTurn, error) {
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var admitted *AdmittedTurn
	var rejected error
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		conversation, lockErr := lockAdmissionConversation(tx, actorID, conversationID, "")
		if lockErr != nil {
			return lockErr
		}
		var activeCount int64
		if countErr := tx.Model(&persistence.AgentTurn{}).
			Where(
				"conversation_id = ? AND status IN ?",
				conversation.ID,
				[]string{
					string(domain.TurnStatusRunning),
					string(domain.TurnStatusWaitingLocalTool),
				},
			).
			Count(&activeCount).Error; countErr != nil {
			return admissionInternal("count active turns before dequeue", countErr)
		}
		if activeCount > 0 {
			return nil
		}
		var entry persistence.TurnQueueEntry
		if findErr := tx.Where(
			"conversation_id = ? AND status = ?",
			conversation.ID,
			queueStatusPending,
		).Order("queue_sequence ASC").First(&entry).Error; findErr != nil {
			if errors.Is(findErr, gorm.ErrRecordNotFound) {
				return nil
			}
			return admissionInternal("load next queued turn", findErr)
		}
		var request model.ExecuteTurnRequest
		if decodeErr := proto.Unmarshal(entry.RequestPayload, &request); decodeErr != nil {
			return admissionInternal("decode queued turn request", decodeErr)
		}
		if s.requestPreflight == nil {
			rejected = errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"turn admission preflight is unavailable",
				nil,
			)
		} else {
			rejected = s.requestPreflight(ctx, actorID, &request)
		}
		if rejected != nil {
			entry.Status = queueStatusCancelled
			entry.CancelledAt = &now
			entry.UpdatedAt = now
			if updateErr := tx.Save(&entry).Error; updateErr != nil {
				return admissionInternal("reject invalid queued turn", updateErr)
			}
			return tx.Model(conversation).Updates(map[string]interface{}{
				"queued_turn_count": gorm.Expr(
					"CASE WHEN queued_turn_count > 0 THEN queued_turn_count - 1 ELSE 0 END",
				),
				"version":    conversation.Version + 1,
				"updated_at": now,
			}).Error
		}
		key := entry.ClientIdempotencyKey
		turn := &persistence.AgentTurn{
			ID:                   NewTurnID(),
			ConversationID:       conversation.ID,
			AgentID:              entry.AgentID,
			ClientIdempotencyKey: &key,
			AdmissionPayloadHash: entry.AdmissionPayloadHash,
			UserInput:            stringPointerValue(request.GetUserInput()),
			Status:               string(domain.TurnStatusRunning),
			StartedAt:            now,
		}
		if createErr := tx.Create(turn).Error; createErr != nil {
			return admissionInternal("create dequeued turn", createErr)
		}
		entry.Status = queueStatusAdmitted
		entry.AdmittedTurnID = turn.ID
		entry.UpdatedAt = now
		if updateErr := tx.Save(&entry).Error; updateErr != nil {
			return admissionInternal("mark queued turn admitted", updateErr)
		}
		nextVersion := conversation.Version + 1
		if updateErr := tx.Model(conversation).Updates(map[string]interface{}{
			"queued_turn_count": gorm.Expr(
				"CASE WHEN queued_turn_count > 0 THEN queued_turn_count - 1 ELSE 0 END",
			),
			"version":    nextVersion,
			"updated_at": now,
		}).Error; updateErr != nil {
			return admissionInternal("update dequeued turn projection", updateErr)
		}
		admitted = &AdmittedTurn{
			Admission: &model.TurnAdmission{
				Status:              model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED,
				TurnId:              turn.ID,
				QueueEntry:          queueEntryToProto(&entry, 0),
				QueueCapacity:       turnQueueCapacity,
				ConversationVersion: nextVersion,
			},
			Request: &request,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if rejected != nil {
		return nil, rejected
	}
	return admitted, nil
}

func (s *TurnAdmissionService) PendingConversations(
	ctx context.Context,
	limit int,
) ([]PendingTurnConversation, error) {
	if limit <= 0 {
		limit = 32
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		Ptid           string
		ConversationID string
	}
	if err := db.WithContext(ctx).
		Model(&persistence.TurnQueueEntry{}).
		Select("ptid, conversation_id").
		Where("status = ?", queueStatusPending).
		Group("ptid, conversation_id").
		Order("MIN(queue_sequence) ASC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, admissionInternal("list pending turn conversations", err)
	}
	result := make([]PendingTurnConversation, 0, len(rows))
	for _, row := range rows {
		result = append(result, PendingTurnConversation{
			ActorID:        row.Ptid,
			ConversationID: row.ConversationID,
		})
	}
	return result, nil
}

func findNewConversationAdmissionReplay(
	db *gorm.DB,
	actorID string,
	request *model.ExecuteTurnRequest,
	payloadHash string,
) (*model.TurnAdmission, bool, error) {
	var conversation persistence.Conversation
	err := db.Where("id = ?", request.GetConversationId()).First(&conversation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, admissionInternal("load Home conversation replay", err)
	}
	if conversation.ActorPTID != actorID ||
		conversation.AgentID != strings.TrimSpace(request.GetAgentId()) {
		return nil, true, errcode.NewAdmissionDuplicateConflict(
			request.GetClientIdempotencyKey(),
			conversation.ID,
		)
	}
	replay, replayErr := findAdmissionReplay(
		db,
		&conversation,
		request.GetClientIdempotencyKey(),
		payloadHash,
	)
	if replayErr != nil {
		return nil, true, replayErr
	}
	if replay == nil {
		return nil, true, errcode.NewAdmissionDuplicateConflict(
			request.GetClientIdempotencyKey(),
			conversation.ID,
		)
	}
	return replay, true, nil
}

func findAdmissionReplay(
	tx *gorm.DB,
	conversation *persistence.Conversation,
	idempotencyKey string,
	payloadHash string,
) (*model.TurnAdmission, error) {
	var turn persistence.AgentTurn
	turnErr := tx.Where(
		"conversation_id = ? AND client_idempotency_key = ?",
		conversation.ID,
		idempotencyKey,
	).First(&turn).Error
	if turnErr == nil {
		if turn.AdmissionPayloadHash != payloadHash {
			return nil, errcode.NewAdmissionDuplicateConflict(
				idempotencyKey,
				turn.ID,
			)
		}
		return &model.TurnAdmission{
			Status:              model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_REPLAYED,
			TurnId:              turn.ID,
			QueueCapacity:       turnQueueCapacity,
			ConversationVersion: conversation.Version,
		}, nil
	}
	if !errors.Is(turnErr, gorm.ErrRecordNotFound) {
		return nil, admissionInternal("load admitted turn replay", turnErr)
	}

	var entry persistence.TurnQueueEntry
	queueErr := tx.Where(
		"conversation_id = ? AND client_idempotency_key = ?",
		conversation.ID,
		idempotencyKey,
	).First(&entry).Error
	if queueErr == nil {
		if entry.AdmissionPayloadHash != payloadHash {
			return nil, errcode.NewAdmissionDuplicateConflict(
				idempotencyKey,
				entry.ID,
			)
		}
		var position int64
		if entry.Status == queueStatusPending {
			if err := tx.Model(&persistence.TurnQueueEntry{}).
				Where(
					"conversation_id = ? AND status = ? AND queue_sequence <= ?",
					conversation.ID,
					queueStatusPending,
					entry.QueueSequence,
				).Count(&position).Error; err != nil {
				return nil, admissionInternal("resolve queued turn replay position", err)
			}
		}
		return &model.TurnAdmission{
			Status:              model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_REPLAYED,
			TurnId:              entry.AdmittedTurnID,
			QueueEntry:          queueEntryToProto(&entry, uint32(position)),
			QueueCapacity:       turnQueueCapacity,
			ConversationVersion: conversation.Version,
		}, nil
	}
	if !errors.Is(queueErr, gorm.ErrRecordNotFound) {
		return nil, admissionInternal("load queued turn replay", queueErr)
	}
	return nil, nil
}

func lockAdmissionConversation(
	tx *gorm.DB,
	actorID string,
	conversationID string,
	agentID string,
) (*persistence.Conversation, error) {
	query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND actor_ptid = ?", strings.TrimSpace(conversationID), strings.TrimSpace(actorID))
	if strings.TrimSpace(agentID) != "" {
		query = query.Where("agent_id = ?", strings.TrimSpace(agentID))
	}
	var conversation persistence.Conversation
	if err := query.First(&conversation).Error; err != nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "conversation not found", err)
	}
	if conversation.Status != string(domain.ConversationStatusActive) {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"conversation is not active",
			nil,
		)
	}
	return &conversation, nil
}

func queueEntryToProto(
	entry *persistence.TurnQueueEntry,
	position uint32,
) *model.TurnQueueEntry {
	if entry == nil {
		return nil
	}
	status := model.TurnQueueStatus_TURN_QUEUE_STATUS_UNSPECIFIED
	switch entry.Status {
	case queueStatusPending:
		status = model.TurnQueueStatus_TURN_QUEUE_STATUS_PENDING
	case queueStatusAdmitted:
		status = model.TurnQueueStatus_TURN_QUEUE_STATUS_ADMITTED
	case queueStatusCancelled:
		status = model.TurnQueueStatus_TURN_QUEUE_STATUS_CANCELLED
	}
	return &model.TurnQueueEntry{
		QueueEntryId:         entry.ID,
		ConversationId:       entry.ConversationID,
		AgentId:              entry.AgentID,
		ClientIdempotencyKey: entry.ClientIdempotencyKey,
		Status:               status,
		QueueSequence:        entry.QueueSequence,
		QueuePosition:        position,
		AdmittedTurnId:       entry.AdmittedTurnID,
		CreatedAt:            timestamppb.New(entry.CreatedAt),
		UpdatedAt:            timestamppb.New(entry.UpdatedAt),
		UserInput:            queuedUserInput(entry.RequestPayload),
	}
}

func queuedUserInput(payload []byte) string {
	var request model.ExecuteTurnRequest
	if err := proto.Unmarshal(payload, &request); err != nil {
		return ""
	}
	return request.GetUserInput()
}

func (s *TurnAdmissionService) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, admissionInternal("open Agent database", err)
	}
	return db, nil
}

func admissionInternal(operation string, cause error) error {
	return errcode.New(
		errcode.AgentInternal,
		http.StatusInternalServerError,
		operation,
		cause,
	)
}

func sha256BytesHex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func stringPointerValue(value string) *string {
	return &value
}
