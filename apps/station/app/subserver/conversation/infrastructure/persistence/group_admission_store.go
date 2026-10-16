package persistence

import (
	"context"
	"errors"
	"fmt"
	"time"

	groupadmission "github.com/peers-labs/peers-touch/station/app/subserver/conversation/groupadmission"
	notificationinfra "github.com/peers-labs/peers-touch/station/app/subserver/notification/infrastructure"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	notificationmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/notification"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const defaultGroupAdmissionRevision = uint64(1)

type GroupAdmissionStore struct {
	db *gorm.DB
}

func NewGroupAdmissionStore(db *gorm.DB) *GroupAdmissionStore {
	return &GroupAdmissionStore{db: db}
}

func (s *GroupAdmissionStore) Execute(
	ctx context.Context,
	fn func(groupadmission.Transaction) error,
) error {
	if s == nil || s.db == nil || fn == nil {
		return fmt.Errorf("group admission store: database and transaction callback are required")
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return fn(&groupAdmissionTransaction{db: tx})
	})
}

func (s *GroupAdmissionStore) Read(
	ctx context.Context,
	fn func(groupadmission.Transaction) error,
) error {
	if s == nil || s.db == nil || fn == nil {
		return fmt.Errorf("group admission store: database and read callback are required")
	}
	return fn(&groupAdmissionTransaction{db: s.db.WithContext(ctx)})
}

type groupAdmissionTransaction struct {
	db *gorm.DB
}

func (t *groupAdmissionTransaction) GetOrCreatePreference(
	ctx context.Context,
	actorPTID string,
	at time.Time,
) (*chatmodel.GroupAdmissionPreference, error) {
	var model GroupAdmissionPreferenceModel
	err := t.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "actor_ptid = ?", actorPTID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		model = GroupAdmissionPreferenceModel{
			ActorPTID: actorPTID,
			Mode: int32(
				chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_DIRECT_ADD,
			),
			Revision:  defaultGroupAdmissionRevision,
			UpdatedAt: at.UTC(),
		}
		if err := t.db.WithContext(ctx).
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&model).Error; err != nil {
			return nil, fmt.Errorf("group admission store: create preference: %w", err)
		}
		if err := t.db.WithContext(ctx).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&model, "actor_ptid = ?", actorPTID).Error; err != nil {
			return nil, fmt.Errorf("group admission store: reload preference: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("group admission store: get preference: %w", err)
	}
	return preferenceFromModel(model), nil
}

func (t *groupAdmissionTransaction) SavePreference(
	ctx context.Context,
	preference *chatmodel.GroupAdmissionPreference,
) error {
	if preference == nil || preference.GetUpdatedAt() == nil {
		return fmt.Errorf("group admission store: preference is incomplete")
	}
	model := GroupAdmissionPreferenceModel{
		ActorPTID: preference.GetActorPtid(),
		Mode:      int32(preference.GetMode()),
		Revision:  preference.GetRevision(),
		UpdatedAt: preference.GetUpdatedAt().AsTime().UTC(),
	}
	result := t.db.WithContext(ctx).
		Model(&GroupAdmissionPreferenceModel{}).
		Where(
			"actor_ptid = ? AND revision = ?",
			model.ActorPTID,
			model.Revision-1,
		).
		Updates(map[string]any{
			"mode":       model.Mode,
			"revision":   model.Revision,
			"updated_at": model.UpdatedAt,
		})
	if result.Error != nil {
		return fmt.Errorf("group admission store: save preference: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("group admission store: preference revision changed")
	}
	return nil
}

func (t *groupAdmissionTransaction) ListRejectedGroups(
	ctx context.Context,
	actorPTID string,
) ([]*chatmodel.RejectedGroup, error) {
	var models []RejectedGroupModel
	if err := t.db.WithContext(ctx).
		Where("actor_ptid = ?", actorPTID).
		Order("rejected_at DESC, conversation_id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("group admission store: list rejected groups: %w", err)
	}
	result := make([]*chatmodel.RejectedGroup, 0, len(models))
	for _, model := range models {
		result = append(result, rejectedGroupFromModel(model))
	}
	return result, nil
}

func (t *groupAdmissionTransaction) GetRejectedGroup(
	ctx context.Context,
	actorPTID string,
	conversationID string,
) (*chatmodel.RejectedGroup, error) {
	var model RejectedGroupModel
	err := t.db.WithContext(ctx).
		First(
			&model,
			"actor_ptid = ? AND conversation_id = ?",
			actorPTID,
			conversationID,
		).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("group admission store: get rejected group: %w", err)
	}
	return rejectedGroupFromModel(model), nil
}

func (t *groupAdmissionTransaction) SaveRejectedGroup(
	ctx context.Context,
	actorPTID string,
	group *chatmodel.RejectedGroup,
) error {
	if group == nil || group.GetRejectedAt() == nil {
		return fmt.Errorf("group admission store: rejected group is incomplete")
	}
	model := RejectedGroupModel{
		ActorPTID:              actorPTID,
		ConversationID:         group.GetConversationId(),
		FederationID:           group.GetFederationId(),
		AuthorityStationPeerID: group.GetAuthorityStationPeerId(),
		GroupNameSnapshot:      group.GetGroupNameSnapshot(),
		PolicyRevision:         group.GetPolicyRevision(),
		RejectedAt:             group.GetRejectedAt().AsTime().UTC(),
		LeaveRejectOperationID: group.GetLeaveRejectOperationId(),
		LeaveRejectState:       int32(group.GetLeaveRejectState()),
		LeaveRejectFailureCode: group.GetLeaveRejectFailureCode(),
	}
	if err := t.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "actor_ptid"},
				{Name: "conversation_id"},
			},
			DoUpdates: clause.AssignmentColumns([]string{
				"federation_id",
				"authority_station_peer_id",
				"group_name_snapshot",
				"policy_revision",
				"rejected_at",
				"leave_reject_operation_id",
				"leave_reject_state",
				"leave_reject_failure_code",
			}),
		}).
		Create(&model).Error; err != nil {
		return fmt.Errorf("group admission store: save rejected group: %w", err)
	}
	return nil
}

func (t *groupAdmissionTransaction) UpdateRejectedGroupLeaveOperation(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	operationID string,
	state chatmodel.GroupLeaveRejectState,
	failureCode string,
) error {
	result := t.db.WithContext(ctx).
		Model(&RejectedGroupModel{}).
		Where(
			"actor_ptid = ? AND conversation_id = ? AND leave_reject_operation_id = ?",
			actorPTID,
			conversationID,
			operationID,
		).
		Updates(map[string]any{
			"leave_reject_state":        int32(state),
			"leave_reject_failure_code": failureCode,
		})
	if result.Error != nil {
		return fmt.Errorf(
			"group admission store: update rejected group leave operation: %w",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf(
			"group admission store: rejected group leave operation changed",
		)
	}
	return nil
}

func (t *groupAdmissionTransaction) DeleteRejectedGroup(
	ctx context.Context,
	actorPTID string,
	conversationID string,
) (bool, error) {
	result := t.db.WithContext(ctx).
		Delete(
			&RejectedGroupModel{},
			"actor_ptid = ? AND conversation_id = ?",
			actorPTID,
			conversationID,
		)
	if result.Error != nil {
		return false, fmt.Errorf("group admission store: delete rejected group: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

func (t *groupAdmissionTransaction) GetEvaluation(
	ctx context.Context,
	requestID string,
) (*groupadmission.EvaluationRecord, error) {
	var model GroupAdmissionEvaluationModel
	err := t.db.WithContext(ctx).
		First(&model, "request_id = ?", requestID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("group admission store: get evaluation: %w", err)
	}
	response := &chatmodel.GroupAdmissionEvaluationResponse{}
	if err := proto.Unmarshal(model.ResponseBytes, response); err != nil {
		return nil, fmt.Errorf("group admission store: decode evaluation response: %w", err)
	}
	request := &chatmodel.GroupAdmissionEvaluationRequest{}
	if err := proto.Unmarshal(model.RequestBytes, request); err != nil {
		return nil, fmt.Errorf("group admission store: decode evaluation request: %w", err)
	}
	return &groupadmission.EvaluationRecord{
		RequestSHA256: append([]byte(nil), model.RequestSHA256...),
		Request:       request,
		Response:      response,
	}, nil
}

func (t *groupAdmissionTransaction) SaveEvaluation(
	ctx context.Context,
	request *chatmodel.GroupAdmissionEvaluationRequest,
	requestHash []byte,
	response *chatmodel.GroupAdmissionEvaluationResponse,
) error {
	requestBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(request)
	if err != nil {
		return fmt.Errorf("group admission store: encode evaluation request: %w", err)
	}
	responseBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(response)
	if err != nil {
		return fmt.Errorf("group admission store: encode evaluation response: %w", err)
	}
	model := GroupAdmissionEvaluationModel{
		RequestID:                 request.GetRequestId(),
		RequestSHA256:             append([]byte(nil), requestHash...),
		RequestBytes:              requestBytes,
		ResponseBytes:             responseBytes,
		ConversationID:            request.GetConversationId(),
		InviteePTID:               request.GetInvitee().GetPtid(),
		AuthorityPlanID:           request.GetAuthorityPlanId(),
		InvitationActivationState: invitationActivationState(request, response),
		CreatedAt:                 time.Now().UTC(),
	}
	if err := t.db.WithContext(ctx).Create(&model).Error; err != nil {
		return fmt.Errorf("group admission store: save evaluation: %w", err)
	}
	return nil
}

func (t *groupAdmissionTransaction) ListDeferredInvitationEvaluations(
	ctx context.Context,
	authorityPlanID string,
	conversationID string,
) ([]*groupadmission.EvaluationRecord, error) {
	var models []GroupAdmissionEvaluationModel
	if err := t.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"authority_plan_id = ? AND conversation_id = ? AND invitation_activation_state = ?",
			authorityPlanID,
			conversationID,
			"pending",
		).
		Order("invitee_ptid ASC, request_id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf(
			"group admission store: list deferred invitation evaluations: %w",
			err,
		)
	}
	result := make([]*groupadmission.EvaluationRecord, 0, len(models))
	for _, model := range models {
		request := &chatmodel.GroupAdmissionEvaluationRequest{}
		if err := proto.Unmarshal(model.RequestBytes, request); err != nil {
			return nil, fmt.Errorf(
				"group admission store: decode deferred evaluation request: %w",
				err,
			)
		}
		response := &chatmodel.GroupAdmissionEvaluationResponse{}
		if err := proto.Unmarshal(model.ResponseBytes, response); err != nil {
			return nil, fmt.Errorf(
				"group admission store: decode deferred evaluation response: %w",
				err,
			)
		}
		result = append(result, &groupadmission.EvaluationRecord{
			RequestSHA256: append([]byte(nil), model.RequestSHA256...),
			Request:       request,
			Response:      response,
		})
	}
	return result, nil
}

func (t *groupAdmissionTransaction) MarkInvitationEvaluationActivated(
	ctx context.Context,
	requestID string,
	state string,
	at time.Time,
) error {
	if state != "activated" && state != "suppressed" {
		return fmt.Errorf("group admission store: invalid invitation activation state")
	}
	result := t.db.WithContext(ctx).
		Model(&GroupAdmissionEvaluationModel{}).
		Where(
			"request_id = ? AND invitation_activation_state = ?",
			requestID,
			"pending",
		).
		Updates(map[string]any{
			"invitation_activation_state": state,
			"invitation_activated_at":     at.UTC(),
		})
	if result.Error != nil {
		return fmt.Errorf(
			"group admission store: mark invitation evaluation activated: %w",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf(
			"group admission store: invitation evaluation activation changed",
		)
	}
	return nil
}

func (t *groupAdmissionTransaction) GetActiveInvitation(
	ctx context.Context,
	conversationID string,
	inviteePTID string,
) (*chatmodel.GroupInvitation, error) {
	var model GroupInvitationModel
	err := t.db.WithContext(ctx).
		Where(
			"conversation_id = ? AND invitee_ptid = ? AND state IN ?",
			conversationID,
			inviteePTID,
			[]int32{
				int32(chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_PENDING),
				int32(chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_ACCEPTED_WAITING_FOR_MLS),
			},
		).
		Order("created_at DESC").
		First(&model).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("group admission store: get active invitation: %w", err)
	}
	return invitationFromModel(model), nil
}

func (t *groupAdmissionTransaction) GetInvitation(
	ctx context.Context,
	invitationID string,
) (*chatmodel.GroupInvitation, error) {
	var model GroupInvitationModel
	err := t.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "invitation_id = ?", invitationID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("group admission store: get invitation: %w", err)
	}
	return invitationFromModel(model), nil
}

func (t *groupAdmissionTransaction) SaveInvitation(
	ctx context.Context,
	invitation *chatmodel.GroupInvitation,
	sourceRequestID string,
	policyRevision uint64,
) error {
	model := invitationModel(invitation, sourceRequestID, policyRevision)
	if err := t.db.WithContext(ctx).Create(&model).Error; err != nil {
		return fmt.Errorf("group admission store: save invitation: %w", err)
	}
	return nil
}

func (t *groupAdmissionTransaction) CompleteInvitation(
	ctx context.Context,
	invitation *chatmodel.GroupInvitation,
) error {
	if invitation == nil ||
		invitation.GetState() !=
			chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_JOINED ||
		invitation.GetFulfillmentTransitionId() == "" {
		return fmt.Errorf(
			"group admission store: completed invitation is incomplete",
		)
	}
	result := t.db.WithContext(ctx).
		Model(&GroupInvitationModel{}).
		Where(
			"invitation_id = ? AND state = ?",
			invitation.GetInvitationId(),
			int32(
				chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_ACCEPTED_WAITING_FOR_MLS,
			),
		).
		Updates(map[string]any{
			"state":                     int32(invitation.GetState()),
			"fulfillment_transition_id": invitation.GetFulfillmentTransitionId(),
		})
	if result.Error != nil {
		return fmt.Errorf(
			"group admission store: complete invitation: %w",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf(
			"group admission store: invitation completion state changed",
		)
	}
	return nil
}

func (t *groupAdmissionTransaction) RevokePendingInvitations(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	at time.Time,
) error {
	if err := t.db.WithContext(ctx).
		Model(&GroupInvitationModel{}).
		Where(
			"invitee_ptid = ? AND conversation_id = ? AND state IN ?",
			actorPTID,
			conversationID,
			[]int32{
				int32(chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_PENDING),
				int32(chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_ACCEPTED_WAITING_FOR_MLS),
			},
		).
		Updates(map[string]any{
			"state": int32(
				chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_REVOKED,
			),
			"decided_at": at.UTC(),
		}).Error; err != nil {
		return fmt.Errorf(
			"group admission store: revoke pending invitations: %w",
			err,
		)
	}
	return nil
}

func (t *groupAdmissionTransaction) ListInvitations(
	ctx context.Context,
	actorPTID string,
	states []chatmodel.GroupInvitationState,
) ([]*chatmodel.GroupInvitation, error) {
	query := t.db.WithContext(ctx).Where("invitee_ptid = ?", actorPTID)
	if len(states) > 0 {
		values := make([]int32, 0, len(states))
		for _, state := range states {
			values = append(values, int32(state))
		}
		query = query.Where("state IN ?", values)
	}
	var models []GroupInvitationModel
	if err := query.
		Order("created_at DESC, invitation_id ASC").
		Find(&models).Error; err != nil {
		return nil, fmt.Errorf("group admission store: list invitations: %w", err)
	}
	result := make([]*chatmodel.GroupInvitation, 0, len(models))
	for _, model := range models {
		result = append(result, invitationFromModel(model))
	}
	return result, nil
}

func (t *groupAdmissionTransaction) GetDecision(
	ctx context.Context,
	commandID string,
) (*groupadmission.DecisionRecord, error) {
	var model GroupInvitationModel
	err := t.db.WithContext(ctx).
		First(&model, "decision_command_id = ?", commandID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("group admission store: get decision: %w", err)
	}
	var grant *chatmodel.GroupAdmissionGrant
	var persistedGrant GroupAdmissionGrantModel
	err = t.db.WithContext(ctx).
		First(
			&persistedGrant,
			"source_request_id = ?",
			"invitation:"+model.InvitationID,
		).
		Error
	if err == nil {
		grant, err = grantFromModel(persistedGrant)
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("group admission store: get decision grant: %w", err)
	}
	return &groupadmission.DecisionRecord{
		CommandSHA256: append([]byte(nil), model.DecisionCommandSHA256...),
		Invitation:    invitationFromModel(model),
		Grant:         grant,
	}, nil
}

func (t *groupAdmissionTransaction) SaveDecision(
	ctx context.Context,
	command *chatmodel.GroupInvitationDecisionCommand,
	commandHash []byte,
	invitation *chatmodel.GroupInvitation,
	_ *chatmodel.GroupAdmissionGrant,
) error {
	commandBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(command)
	if err != nil {
		return fmt.Errorf("group admission store: encode decision command: %w", err)
	}
	model := invitationModel(invitation, "", 0)
	result := t.db.WithContext(ctx).
		Model(&GroupInvitationModel{}).
		Where(
			"invitation_id = ? AND state = ?",
			model.InvitationID,
			int32(chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_PENDING),
		).
		Updates(map[string]any{
			"state":                   model.State,
			"decided_at":              model.DecidedAt,
			"decision_command_id":     command.GetCommandId(),
			"decision_command_sha256": append([]byte(nil), commandHash...),
			"decision_command_bytes":  commandBytes,
		})
	if result.Error != nil {
		return fmt.Errorf("group admission store: save decision: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("group admission store: invitation decision state changed")
	}
	return nil
}

func (t *groupAdmissionTransaction) GetGrant(
	ctx context.Context,
	grantID string,
) (*chatmodel.GroupAdmissionGrant, error) {
	var model GroupAdmissionGrantModel
	err := t.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "grant_id = ?", grantID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("group admission store: get grant: %w", err)
	}
	return grantFromModel(model)
}

func (t *groupAdmissionTransaction) GetGrantByInvitation(
	ctx context.Context,
	invitationID string,
) (*chatmodel.GroupAdmissionGrant, error) {
	var model GroupAdmissionGrantModel
	err := t.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"invitation_id = ? AND state = ?",
			invitationID,
			int32(
				chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED,
			),
		).
		Order("issued_at DESC, grant_id ASC").
		First(&model).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf(
			"group admission store: get grant by invitation: %w",
			err,
		)
	}
	return grantFromModel(model)
}

func (t *groupAdmissionTransaction) SaveGrant(
	ctx context.Context,
	grant *chatmodel.GroupAdmissionGrant,
) error {
	model, err := grantModel(grant)
	if err != nil {
		return err
	}
	if err := t.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "grant_id"}},
			UpdateAll: true,
		}).
		Create(&model).Error; err != nil {
		return fmt.Errorf("group admission store: save grant: %w", err)
	}
	return nil
}

func (t *groupAdmissionTransaction) ProduceInvitationNotification(
	ctx context.Context,
	invitation *chatmodel.GroupInvitation,
) (*groupadmission.NotificationWake, error) {
	result, err := notificationinfra.NewTxProducer(t.db).ProduceInTx(
		ctx,
		notificationinfra.TxInput{
			RecipientPTID: invitation.GetInviteePtid(),
			ActorPTID:     invitation.GetInviterPtid(),
			Type: int32(
				notificationmodel.NotificationType_NOTIFICATION_TYPE_GROUP_INVITED,
			),
			Category: int32(
				notificationmodel.NotificationCategory_NOTIFICATION_CATEGORY_CHAT,
			),
			TargetType:     "group_invitation",
			TargetID:       invitation.GetInvitationId(),
			GroupKey:       "group_invitation:" + invitation.GetInvitationId(),
			IdempotencyKey: "group_invitation:" + invitation.GetInvitationId(),
			Metadata: map[string]string{
				"conversation_id":     invitation.GetConversationId(),
				"group_name_snapshot": invitation.GetGroupNameSnapshot(),
			},
		},
		invitation.GetCreatedAt().AsTime(),
	)
	if err != nil {
		return nil, fmt.Errorf("group admission store: produce invitation notification: %w", err)
	}
	if !result.Produced {
		return nil, nil
	}
	return &groupadmission.NotificationWake{
		RecipientPTID:  invitation.GetInviteePtid(),
		NotificationID: result.NotificationID,
		Type: int32(
			notificationmodel.NotificationType_NOTIFICATION_TYPE_GROUP_INVITED,
		),
		Category: int32(
			notificationmodel.NotificationCategory_NOTIFICATION_CATEGORY_CHAT,
		),
		GroupKey:  "group_invitation:" + invitation.GetInvitationId(),
		CreatedAt: invitation.GetCreatedAt().AsTime(),
	}, nil
}

func (t *groupAdmissionTransaction) GetLeaveRejectOperation(
	ctx context.Context,
	operationID string,
) (*chatmodel.GroupLeaveRejectOperation, error) {
	var model GroupLeaveRejectOperationModel
	err := t.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "operation_id = ?", operationID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("group admission store: get leave-reject operation: %w", err)
	}
	return leaveRejectOperationFromModel(model), nil
}

func (t *groupAdmissionTransaction) GetLeaveRejectOperationByIntent(
	ctx context.Context,
	leaveIntentID string,
) (*chatmodel.GroupLeaveRejectOperation, error) {
	var model GroupLeaveRejectOperationModel
	err := t.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&model, "leave_intent_id = ?", leaveIntentID).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf(
			"group admission store: get leave-reject operation by intent: %w",
			err,
		)
	}
	return leaveRejectOperationFromModel(model), nil
}

func (t *groupAdmissionTransaction) GetLeaveRejectIntent(
	ctx context.Context,
	operationID string,
) (*chatmodel.MlsLeaveIntent, error) {
	var model GroupLeaveRejectOperationModel
	if err := t.db.WithContext(ctx).
		First(&model, "operation_id = ?", operationID).Error; err != nil {
		return nil, fmt.Errorf(
			"group admission store: get leave-reject intent: %w",
			err,
		)
	}
	if len(model.LeaveIntentBytes) == 0 {
		return nil, nil
	}
	intent := &chatmodel.MlsLeaveIntent{}
	if err := proto.Unmarshal(model.LeaveIntentBytes, intent); err != nil {
		return nil, fmt.Errorf(
			"group admission store: decode leave-reject intent: %w",
			err,
		)
	}
	return intent, nil
}

func (t *groupAdmissionTransaction) SaveLeaveRejectOperation(
	ctx context.Context,
	operation *chatmodel.GroupLeaveRejectOperation,
	leaveIntent *chatmodel.MlsLeaveIntent,
) error {
	if operation == nil || operation.GetCreatedAt() == nil ||
		operation.GetUpdatedAt() == nil {
		return fmt.Errorf("group admission store: leave-reject operation is incomplete")
	}
	var leaveIntentBytes []byte
	if leaveIntent != nil {
		var err error
		leaveIntentBytes, err = (proto.MarshalOptions{
			Deterministic: true,
		}).Marshal(leaveIntent)
		if err != nil {
			return fmt.Errorf("group admission store: encode leave intent: %w", err)
		}
	}
	model := GroupLeaveRejectOperationModel{
		Version:                 operation.GetVersion(),
		OperationID:             operation.GetOperationId(),
		ActorPTID:               operation.GetActorPtid(),
		ConversationID:          operation.GetConversationId(),
		FederationID:            operation.GetFederationId(),
		AuthorityStationPeerID:  operation.GetAuthorityStationPeerId(),
		GroupNameSnapshot:       operation.GetGroupNameSnapshot(),
		State:                   int32(operation.GetState()),
		RejectionPolicyRevision: operation.GetRejectionPolicyRevision(),
		LeaveIntentID:           operation.GetLeaveIntentId(),
		LeaveIntentBytes:        leaveIntentBytes,
		FulfillmentTransitionID: operation.GetFulfillmentTransitionId(),
		FailureCode:             operation.GetFailureCode(),
		CreatedAt:               operation.GetCreatedAt().AsTime().UTC(),
		UpdatedAt:               operation.GetUpdatedAt().AsTime().UTC(),
	}
	if leaveIntent == nil {
		var existing GroupLeaveRejectOperationModel
		err := t.db.WithContext(ctx).
			First(&existing, "operation_id = ?", model.OperationID).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := t.db.WithContext(ctx).Create(&model).Error; err != nil {
				return fmt.Errorf(
					"group admission store: save leave-reject operation: %w",
					err,
				)
			}
			return nil
		}
		if err != nil {
			return fmt.Errorf(
				"group admission store: inspect leave-reject operation: %w",
				err,
			)
		}
		result := t.db.WithContext(ctx).
			Model(&GroupLeaveRejectOperationModel{}).
			Where("operation_id = ?", model.OperationID).
			Updates(map[string]any{
				"state":                     model.State,
				"rejection_policy_revision": model.RejectionPolicyRevision,
				"fulfillment_transition_id": model.FulfillmentTransitionID,
				"failure_code":              model.FailureCode,
				"updated_at":                model.UpdatedAt,
			})
		if result.Error != nil {
			return fmt.Errorf("group admission store: update leave-reject operation: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("group admission store: leave-reject operation was not found")
		}
		return nil
	}
	result := t.db.WithContext(ctx).
		Model(&GroupLeaveRejectOperationModel{}).
		Where("operation_id = ? AND leave_intent_id = ''", model.OperationID).
		Updates(map[string]any{
			"leave_intent_id":    model.LeaveIntentID,
			"leave_intent_bytes": model.LeaveIntentBytes,
			"updated_at":         model.UpdatedAt,
		})
	if result.Error != nil {
		return fmt.Errorf("group admission store: save leave-reject intent: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("group admission store: leave-reject intent changed")
	}
	return nil
}

func leaveRejectOperationFromModel(
	model GroupLeaveRejectOperationModel,
) *chatmodel.GroupLeaveRejectOperation {
	return &chatmodel.GroupLeaveRejectOperation{
		Version:                 model.Version,
		OperationId:             model.OperationID,
		ActorPtid:               model.ActorPTID,
		ConversationId:          model.ConversationID,
		FederationId:            model.FederationID,
		AuthorityStationPeerId:  model.AuthorityStationPeerID,
		GroupNameSnapshot:       model.GroupNameSnapshot,
		State:                   chatmodel.GroupLeaveRejectState(model.State),
		RejectionPolicyRevision: model.RejectionPolicyRevision,
		LeaveIntentId:           model.LeaveIntentID,
		FulfillmentTransitionId: model.FulfillmentTransitionID,
		FailureCode:             model.FailureCode,
		CreatedAt:               timestamppb.New(model.CreatedAt.UTC()),
		UpdatedAt:               timestamppb.New(model.UpdatedAt.UTC()),
	}
}

func preferenceFromModel(model GroupAdmissionPreferenceModel) *chatmodel.GroupAdmissionPreference {
	return &chatmodel.GroupAdmissionPreference{
		ActorPtid: model.ActorPTID,
		Mode:      chatmodel.GroupAdmissionMode(model.Mode),
		Revision:  model.Revision,
		UpdatedAt: timestamppb.New(model.UpdatedAt.UTC()),
	}
}

func rejectedGroupFromModel(model RejectedGroupModel) *chatmodel.RejectedGroup {
	return &chatmodel.RejectedGroup{
		ConversationId:         model.ConversationID,
		FederationId:           model.FederationID,
		AuthorityStationPeerId: model.AuthorityStationPeerID,
		GroupNameSnapshot:      model.GroupNameSnapshot,
		PolicyRevision:         model.PolicyRevision,
		RejectedAt:             timestamppb.New(model.RejectedAt.UTC()),
		LeaveRejectOperationId: model.LeaveRejectOperationID,
		LeaveRejectState:       chatmodel.GroupLeaveRejectState(model.LeaveRejectState),
		LeaveRejectFailureCode: model.LeaveRejectFailureCode,
	}
}

func invitationModel(
	invitation *chatmodel.GroupInvitation,
	sourceRequestID string,
	policyRevision uint64,
) GroupInvitationModel {
	if sourceRequestID == "" {
		sourceRequestID = invitation.GetSourceRequestId()
	}
	model := GroupInvitationModel{
		Version:                  invitation.GetVersion(),
		InvitationID:             invitation.GetInvitationId(),
		SourceRequestID:          sourceRequestID,
		ConversationID:           invitation.GetConversationId(),
		FederationID:             invitation.GetFederationId(),
		AuthorityStationPeerID:   invitation.GetAuthorityStationPeerId(),
		AuthorityEpoch:           uint64(invitation.GetAuthorityEpoch()),
		InviterPTID:              invitation.GetInviterPtid(),
		InviterDeviceID:          invitation.GetInviterDeviceId(),
		InviteePTID:              invitation.GetInviteePtid(),
		InviteeHomeStationPeerID: invitation.GetInviteeHomeStationPeerId(),
		State:                    int32(invitation.GetState()),
		GroupNameSnapshot:        invitation.GetGroupNameSnapshot(),
		ObservedMembershipEpoch:  uint64(invitation.GetObservedMembershipEpoch()),
		ObservedMLSEpoch:         uint64(invitation.GetObservedMlsEpoch()),
		AuthoritySequence:        uint64(invitation.GetAuthoritySequence()),
		AuthorityHash:            append([]byte(nil), invitation.GetAuthorityHash()...),
		PolicyRevision:           policyRevision,
		CreatedAt:                invitation.GetCreatedAt().AsTime().UTC(),
		ExpiresAt:                invitation.GetExpiresAt().AsTime().UTC(),
		DecisionCommandID:        invitation.GetDecisionCommandId(),
		FulfillmentTransitionID:  invitation.GetFulfillmentTransitionId(),
	}
	if invitation.GetDecidedAt() != nil {
		at := invitation.GetDecidedAt().AsTime().UTC()
		model.DecidedAt = &at
	}
	return model
}

func invitationFromModel(model GroupInvitationModel) *chatmodel.GroupInvitation {
	invitation := &chatmodel.GroupInvitation{
		Version:                  model.Version,
		InvitationId:             model.InvitationID,
		ConversationId:           model.ConversationID,
		FederationId:             model.FederationID,
		AuthorityStationPeerId:   model.AuthorityStationPeerID,
		AuthorityEpoch:           int64(model.AuthorityEpoch),
		InviterPtid:              model.InviterPTID,
		InviterDeviceId:          model.InviterDeviceID,
		InviteePtid:              model.InviteePTID,
		InviteeHomeStationPeerId: model.InviteeHomeStationPeerID,
		State:                    chatmodel.GroupInvitationState(model.State),
		GroupNameSnapshot:        model.GroupNameSnapshot,
		ObservedMembershipEpoch:  int64(model.ObservedMembershipEpoch),
		ObservedMlsEpoch:         int64(model.ObservedMLSEpoch),
		AuthoritySequence:        int64(model.AuthoritySequence),
		AuthorityHash:            append([]byte(nil), model.AuthorityHash...),
		CreatedAt:                timestamppb.New(model.CreatedAt.UTC()),
		ExpiresAt:                timestamppb.New(model.ExpiresAt.UTC()),
		DecisionCommandId:        model.DecisionCommandID,
		FulfillmentTransitionId:  model.FulfillmentTransitionID,
		PolicyRevision:           model.PolicyRevision,
		SourceRequestId:          model.SourceRequestID,
	}
	if model.DecidedAt != nil {
		invitation.DecidedAt = timestamppb.New(model.DecidedAt.UTC())
	}
	return invitation
}

func invitationActivationState(
	request *chatmodel.GroupAdmissionEvaluationRequest,
	response *chatmodel.GroupAdmissionEvaluationResponse,
) string {
	if request.GetDeferInvitationUntilGroupCommit() &&
		response.GetOutcome() ==
			chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_CONFIRMATION_REQUIRED {
		return "pending"
	}
	return "none"
}

func grantModel(grant *chatmodel.GroupAdmissionGrant) (GroupAdmissionGrantModel, error) {
	if grant == nil || grant.GetIssuedAt() == nil || grant.GetExpiresAt() == nil {
		return GroupAdmissionGrantModel{}, fmt.Errorf("group admission store: grant is incomplete")
	}
	canonical, err := (proto.MarshalOptions{Deterministic: true}).Marshal(grant)
	if err != nil {
		return GroupAdmissionGrantModel{}, fmt.Errorf("group admission store: encode grant: %w", err)
	}
	signingInput := &chatmodel.GroupAdmissionGrantSigningInput{
		Version:                  grant.GetVersion(),
		GrantId:                  grant.GetGrantId(),
		ConversationId:           grant.GetConversationId(),
		FederationId:             grant.GetFederationId(),
		AuthorityStationPeerId:   grant.GetAuthorityStationPeerId(),
		AuthorityEpoch:           grant.GetAuthorityEpoch(),
		InviterPtid:              grant.GetInviterPtid(),
		InviterDeviceId:          grant.GetInviterDeviceId(),
		InviteePtid:              grant.GetInviteePtid(),
		InviteeHomeStationPeerId: grant.GetInviteeHomeStationPeerId(),
		SourceRequestId:          grant.GetSourceRequestId(),
		InvitationId:             grant.GetInvitationId(),
		FriendshipProofId:        grant.GetFriendshipProofId(),
		AdmissionPolicyRevision:  grant.GetAdmissionPolicyRevision(),
		State:                    grant.GetState(),
		AuthoritySequence:        grant.GetAuthoritySequence(),
		AuthorityHash:            grant.GetAuthorityHash(),
		IssuedAt:                 grant.GetIssuedAt(),
		ExpiresAt:                grant.GetExpiresAt(),
		BoundAuthorityPlanId:     grant.GetBoundAuthorityPlanId(),
		HomeStationSigningKeyId:  grant.GetHomeStationSigningKeyId(),
		FulfillmentTransitionId:  grant.GetFulfillmentTransitionId(),
	}
	signingBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(signingInput)
	if err != nil {
		return GroupAdmissionGrantModel{}, fmt.Errorf("group admission store: encode grant signing input: %w", err)
	}
	model := GroupAdmissionGrantModel{
		Version:                    grant.GetVersion(),
		GrantID:                    grant.GetGrantId(),
		ConversationID:             grant.GetConversationId(),
		FederationID:               grant.GetFederationId(),
		AuthorityStationPeerID:     grant.GetAuthorityStationPeerId(),
		AuthorityEpoch:             uint64(grant.GetAuthorityEpoch()),
		InviterPTID:                grant.GetInviterPtid(),
		InviterDeviceID:            grant.GetInviterDeviceId(),
		InviteePTID:                grant.GetInviteePtid(),
		InviteeHomeStationPeerID:   grant.GetInviteeHomeStationPeerId(),
		SourceRequestID:            grant.GetSourceRequestId(),
		InvitationID:               grant.GetInvitationId(),
		FriendshipProofID:          grant.GetFriendshipProofId(),
		AdmissionPolicyRevision:    grant.GetAdmissionPolicyRevision(),
		State:                      int32(grant.GetState()),
		AuthoritySequence:          uint64(grant.GetAuthoritySequence()),
		AuthorityHash:              append([]byte(nil), grant.GetAuthorityHash()...),
		IssuedAt:                   grant.GetIssuedAt().AsTime().UTC(),
		ExpiresAt:                  grant.GetExpiresAt().AsTime().UTC(),
		BoundAuthorityPlanID:       grant.GetBoundAuthorityPlanId(),
		FulfillmentTransitionID:    grant.GetFulfillmentTransitionId(),
		HomeStationSigningKeyID:    grant.GetHomeStationSigningKeyId(),
		HomeStationSignature:       append([]byte(nil), grant.GetHomeStationSignature()...),
		CanonicalGrantBytes:        canonical,
		CanonicalSigningInputBytes: signingBytes,
	}
	return model, nil
}

func grantFromModel(model GroupAdmissionGrantModel) (*chatmodel.GroupAdmissionGrant, error) {
	if len(model.CanonicalGrantBytes) > 0 {
		grant := &chatmodel.GroupAdmissionGrant{}
		if err := proto.Unmarshal(model.CanonicalGrantBytes, grant); err != nil {
			return nil, fmt.Errorf("group admission store: decode grant: %w", err)
		}
		return grant, nil
	}
	return &chatmodel.GroupAdmissionGrant{
		Version:                  model.Version,
		GrantId:                  model.GrantID,
		ConversationId:           model.ConversationID,
		FederationId:             model.FederationID,
		AuthorityStationPeerId:   model.AuthorityStationPeerID,
		AuthorityEpoch:           int64(model.AuthorityEpoch),
		InviterPtid:              model.InviterPTID,
		InviterDeviceId:          model.InviterDeviceID,
		InviteePtid:              model.InviteePTID,
		InviteeHomeStationPeerId: model.InviteeHomeStationPeerID,
		SourceRequestId:          model.SourceRequestID,
		InvitationId:             model.InvitationID,
		FriendshipProofId:        model.FriendshipProofID,
		AdmissionPolicyRevision:  model.AdmissionPolicyRevision,
		State:                    chatmodel.GroupAdmissionGrantState(model.State),
		AuthoritySequence:        int64(model.AuthoritySequence),
		AuthorityHash:            append([]byte(nil), model.AuthorityHash...),
		IssuedAt:                 timestamppb.New(model.IssuedAt.UTC()),
		ExpiresAt:                timestamppb.New(model.ExpiresAt.UTC()),
		BoundAuthorityPlanId:     model.BoundAuthorityPlanID,
		FulfillmentTransitionId:  model.FulfillmentTransitionID,
		HomeStationSigningKeyId:  model.HomeStationSigningKeyID,
		HomeStationSignature:     append([]byte(nil), model.HomeStationSignature...),
	}, nil
}

var _ groupadmission.Store = (*GroupAdmissionStore)(nil)
var _ groupadmission.Transaction = (*groupAdmissionTransaction)(nil)
