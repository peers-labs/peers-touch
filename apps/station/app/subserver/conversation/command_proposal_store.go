package conversation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/google/uuid"
	envinf "github.com/peers-labs/peers-touch/station/app/subserver/envelope/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxCommandProposalBytes                   = 9 << 20
	maxPendingCommandProposalsGlobal          = 10_000
	maxPendingCommandProposalsPerActor        = 256
	maxPendingCommandProposalsPerConversation = 64
)

type commandProposalAdmissionError struct {
	code chat.ConversationCommandRejectCode
}

func (e *commandProposalAdmissionError) Error() string {
	return e.code.String()
}

type conversationCommandProposalModel struct {
	ID                uint       `gorm:"column:id;primaryKey"`
	ConversationID    string     `gorm:"column:conversation_id;size:128;uniqueIndex:uidx_home_command_proposal"`
	CommandID         string     `gorm:"column:command_id;size:128;uniqueIndex:uidx_home_command_proposal"`
	ActorPtid         string     `gorm:"column:actor_ptid;size:255;index"`
	ActorDeviceID     string     `gorm:"column:actor_device_id;size:255"`
	AuthorityStation  string     `gorm:"column:authority_station_peer_id;size:255;index"`
	CommandSHA256     []byte     `gorm:"column:command_sha256;type:bytea"`
	ProposalBytes     []byte     `gorm:"column:proposal_bytes;type:bytea"`
	State             int32      `gorm:"column:state;index"`
	ResultBytes       []byte     `gorm:"column:result_bytes;type:bytea"`
	RetryCount        int32      `gorm:"column:retry_count"`
	NextRetryAt       time.Time  `gorm:"column:next_retry_at;index"`
	LastError         string     `gorm:"column:last_error;type:text"`
	ExpiresAt         time.Time  `gorm:"column:expires_at;index"`
	CreatedAt         time.Time  `gorm:"column:created_at;index"`
	UpdatedAt         time.Time  `gorm:"column:updated_at"`
	AuthorityResultAt *time.Time `gorm:"column:authority_result_at"`
}

func (*conversationCommandProposalModel) TableName() string {
	return "conversation_command_proposals"
}

type commandProposalStore struct {
	db *gorm.DB
}

func newCommandProposalStore(db *gorm.DB) *commandProposalStore {
	return &commandProposalStore{db: db}
}

func (s *commandProposalStore) accept(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) (*conversationCommandProposalModel, bool, error) {
	proposalBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(proposal)
	if err != nil {
		return nil, false, err
	}
	if len(proposalBytes) > maxCommandProposalBytes {
		return nil, false, &commandProposalAdmissionError{
			code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_PAYLOAD_TOO_LARGE,
		}
	}
	existing, err := s.get(ctx, proposal.Command.ConversationId, proposal.Command.CommandId)
	if err == nil {
		if !bytes.Equal(existing.CommandSHA256, proposal.CommandSha256) {
			return nil, false, transitionError(
				"COMMAND_CONFLICT",
				"command_id already accepted by Home Station with different content",
			)
		}
		return existing, false, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, false, err
	}
	if err := s.checkAdmission(ctx, proposal); err != nil {
		return nil, false, err
	}
	now := time.Now()
	model := &conversationCommandProposalModel{
		ConversationID:   proposal.Command.ConversationId,
		CommandID:        proposal.Command.CommandId,
		ActorPtid:        proposal.ActorPtid,
		ActorDeviceID:    proposal.ActorDeviceId,
		AuthorityStation: proposal.AuthorityStationPeerId,
		CommandSHA256:    append([]byte(nil), proposal.CommandSha256...),
		ProposalBytes:    proposalBytes,
		State:            int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_HOME_ACCEPTED),
		NextRetryAt:      now,
		ExpiresAt:        time.UnixMilli(proposal.ExpiresAtUnixMs),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	result := s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "conversation_id"}, {Name: "command_id"}},
			DoNothing: true,
		}).
		Create(model)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return model, true, nil
	}
	existing, err = s.get(ctx, proposal.Command.ConversationId, proposal.Command.CommandId)
	if err != nil {
		return nil, false, err
	}
	if !bytes.Equal(existing.CommandSHA256, proposal.CommandSha256) {
		return nil, false, transitionError(
			"COMMAND_CONFLICT",
			"command_id already accepted by Home Station with different content",
		)
	}
	return existing, false, nil
}

func (s *commandProposalStore) checkAdmission(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) error {
	activeStates := []int32{
		int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_HOME_ACCEPTED),
		int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_SUBMITTED),
		int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_RETRY_WAIT),
	}
	check := func(query *gorm.DB, limit int64) error {
		var count int64
		if err := query.Count(&count).Error; err != nil {
			return err
		}
		if count >= limit {
			return &commandProposalAdmissionError{
				code: chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_RATE_LIMITED,
			}
		}
		return nil
	}
	base := s.db.WithContext(ctx).
		Model(&conversationCommandProposalModel{}).
		Where("state IN ?", activeStates)
	if err := check(base.Session(&gorm.Session{}), maxPendingCommandProposalsGlobal); err != nil {
		return err
	}
	if err := check(
		base.Session(&gorm.Session{}).Where("actor_ptid = ?", proposal.ActorPtid),
		maxPendingCommandProposalsPerActor,
	); err != nil {
		return err
	}
	return check(
		base.Session(&gorm.Session{}).Where(
			"conversation_id = ?",
			proposal.Command.ConversationId,
		),
		maxPendingCommandProposalsPerConversation,
	)
}

func (s *commandProposalStore) get(
	ctx context.Context,
	conversationID string,
	commandID string,
) (*conversationCommandProposalModel, error) {
	var model conversationCommandProposalModel
	err := s.db.WithContext(ctx).
		Where("conversation_id = ? AND command_id = ?", conversationID, commandID).
		First(&model).Error
	return &model, err
}

func (s *commandProposalStore) pending(
	ctx context.Context,
	now time.Time,
	limit int,
) ([]*conversationCommandProposalModel, error) {
	var rows []*conversationCommandProposalModel
	err := s.db.WithContext(ctx).
		Where(
			"state IN ? AND next_retry_at <= ? AND expires_at > ?",
			[]int32{
				int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_HOME_ACCEPTED),
				int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_SUBMITTED),
				int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_RETRY_WAIT),
			},
			now,
			now,
		).
		Order("next_retry_at ASC, created_at ASC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	// One item per conversation per pass preserves FIFO without allowing one
	// noisy conversation to consume the whole worker batch.
	selected := make([]*conversationCommandProposalModel, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, row := range rows {
		if _, ok := seen[row.ConversationID]; ok {
			continue
		}
		seen[row.ConversationID] = struct{}{}
		selected = append(selected, row)
		if len(selected) == limit {
			break
		}
	}
	return selected, nil
}

func (s *commandProposalStore) markSubmitted(
	ctx context.Context,
	conversationID string,
	commandID string,
) error {
	return s.db.WithContext(ctx).
		Model(&conversationCommandProposalModel{}).
		Where("conversation_id = ? AND command_id = ?", conversationID, commandID).
		Updates(map[string]any{
			"state":       int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_SUBMITTED),
			"retry_count": gorm.Expr("retry_count + 1"),
			"updated_at":  time.Now(),
		}).Error
}

func (s *commandProposalStore) markRetry(
	ctx context.Context,
	conversationID string,
	commandID string,
	nextRetryAt time.Time,
	lastError string,
) error {
	return s.db.WithContext(ctx).
		Model(&conversationCommandProposalModel{}).
		Where("conversation_id = ? AND command_id = ?", conversationID, commandID).
		Updates(map[string]any{
			"state":         int32(chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_RETRY_WAIT),
			"next_retry_at": nextRetryAt,
			"last_error":    lastError,
			"updated_at":    time.Now(),
		}).Error
}

func (s *commandProposalStore) complete(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
	result *chat.ConversationCommandProposalResult,
) (*chat.DeviceInboxItem, error) {
	if proposal == nil || proposal.Command == nil || result == nil {
		return nil, fmt.Errorf("conversation: command proposal completion is incomplete")
	}
	state := chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED
	if result.Accepted {
		state = chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_ACCEPTED
	} else if result.Retryable {
		return nil, fmt.Errorf("conversation: retryable result cannot complete a proposal")
	}
	resultBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
	if err != nil {
		return nil, err
	}
	delivery := &chat.ConversationCommandResultDelivery{
		ConversationId: proposal.Command.ConversationId,
		CommandId:      proposal.Command.CommandId,
		State:          state,
		Result:         result,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(delivery)
	if err != nil {
		return nil, err
	}
	payloadHash := sha256.Sum256(payloadBytes)
	now := time.Now()
	envelope := &chat.StationEnvelope{
		EnvelopeId:                 uuid.NewString(),
		ConversationId:             proposal.Command.ConversationId,
		SenderHomeStationPeerId:    proposal.HomeStationPeerId,
		RecipientPtid:              proposal.ActorPtid,
		RecipientDeviceId:          proposal.ActorDeviceId,
		RecipientHomeStationPeerId: proposal.HomeStationPeerId,
		IdempotencyKey:             "command-result:" + proposal.Command.ConversationId + ":" + proposal.Command.CommandId,
		PayloadType:                chat.EnvelopePayloadType_ENVELOPE_PAYLOAD_TYPE_CONVERSATION_COMMAND_RESULT,
		PayloadBytes:               payloadBytes,
		PayloadSha256:              payloadHash[:],
		IssuedAt:                   timestamppb.New(now),
		AuthorityStationPeerId:     proposal.AuthorityStationPeerId,
		FederationId:               proposal.FederationId,
		AuthorityEpoch:             proposal.AuthorityEpoch,
	}
	item := &chat.DeviceInboxItem{
		InboxItemId:       uuid.NewString(),
		RecipientPtid:     proposal.ActorPtid,
		RecipientDeviceId: proposal.ActorDeviceId,
		Envelope:          envelope,
		Status:            chat.InboxItemStatus_INBOX_ITEM_STATUS_PENDING,
		FirstQueuedAt:     timestamppb.New(now),
	}
	envelopeBytes, err := proto.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		update := tx.Model(&conversationCommandProposalModel{}).
			Where(
				"conversation_id = ? AND command_id = ?",
				proposal.Command.ConversationId,
				proposal.Command.CommandId,
			).
			Updates(map[string]any{
				"state":               int32(state),
				"result_bytes":        resultBytes,
				"authority_result_at": now,
				"updated_at":          now,
				"last_error":          "",
			})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		inbox := &envinf.InboxModel{
			InboxItemID:       item.InboxItemId,
			RecipientPTID:     item.RecipientPtid,
			RecipientDeviceID: item.RecipientDeviceId,
			IdempotencyKey:    envelope.IdempotencyKey,
			EnvelopeBytes:     envelopeBytes,
			Status:            int32(chat.InboxItemStatus_INBOX_ITEM_STATUS_PENDING),
			FirstQueuedAt:     now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "idempotency_key"}},
			DoNothing: true,
		}).Create(inbox).Error; err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "idempotency_key"}},
			DoNothing: true,
		}).Create(&envinf.IdempotencyModel{
			IdempotencyKey: envelope.IdempotencyKey,
			CreatedAt:      now,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return item, nil
}

func commandProposalResponse(
	model *conversationCommandProposalModel,
) (*chat.SubmitConversationCommandProposalResponse, error) {
	if model == nil {
		return nil, gorm.ErrRecordNotFound
	}
	response := &chat.SubmitConversationCommandProposalResponse{
		ConversationId: model.ConversationID,
		CommandId:      model.CommandID,
		State:          chat.ConversationCommandSubmissionState(model.State),
	}
	if len(model.ResultBytes) > 0 {
		response.Result = &chat.ConversationCommandProposalResult{}
		if err := proto.Unmarshal(model.ResultBytes, response.Result); err != nil {
			return nil, err
		}
	}
	return response, nil
}
