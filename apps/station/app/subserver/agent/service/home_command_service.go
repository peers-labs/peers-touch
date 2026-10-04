package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type homeAgentGetter interface {
	GetAgent(context.Context, string, string) (*domain.Agent, error)
}

type homeTurnStarter interface {
	StartAdmittedTurn(string, *model.ExecuteTurnRequest, *model.TurnAdmission) bool
	FailAdmittedTurnStart(
		context.Context,
		string,
		string,
		string,
		error,
	) error
}

type homeTaskCreator interface {
	Create(
		context.Context,
		string,
		*model.CreateTaskRunRequest,
	) (*model.CreateTaskRunResponse, error)
}

type HomeCommandService struct {
	agents    homeAgentGetter
	admission *TurnAdmissionService
	turns     homeTurnStarter
	tasks     homeTaskCreator
	db        *gorm.DB
	now       func() time.Time
}

func NewHomeCommandService(
	agents homeAgentGetter,
	admission *TurnAdmissionService,
	turns homeTurnStarter,
	tasks homeTaskCreator,
) *HomeCommandService {
	return &HomeCommandService{
		agents:    agents,
		admission: admission,
		turns:     turns,
		tasks:     tasks,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *HomeCommandService) SubmitChat(
	ctx context.Context,
	ptid string,
	req *model.SubmitHomeChatCommandRequest,
) (*model.SubmitHomeChatCommandResponse, error) {
	agent, err := s.validateCommand(
		ctx,
		ptid,
		req.GetAgentId(),
		req.GetExpectedAgentVersion(),
		req.GetRuntimeProfileId(),
		req.GetReadinessSnapshotId(),
		req.GetInput(),
		req.GetClientIdempotencyKey(),
	)
	if err != nil {
		return nil, err
	}
	if s.admission == nil || s.turns == nil {
		return nil, homeCommandInternal("Home Chat runtime is not configured", nil)
	}

	conversationID := strings.TrimSpace(req.GetConversationId())
	newConversation := conversationID == ""
	if newConversation {
		conversationID = homeCommandResourceID(
			"conv",
			ptid,
			req.GetClientIdempotencyKey(),
		)
	}
	turnRequest := &model.ExecuteTurnRequest{
		ConversationId:       conversationID,
		AgentId:              agent.AgentID,
		UserInput:            strings.TrimSpace(req.GetInput()),
		Provider:             homeStringPointer(agent.ProviderID),
		Model:                homeStringPointer(agent.ModelName),
		ClientIdempotencyKey: strings.TrimSpace(req.GetClientIdempotencyKey()),
		ThinkingMode:         string(agent.ThinkingMode),
		Attachments:          req.GetAttachments(),
	}

	var admission *model.TurnAdmission
	var created bool
	if newConversation {
		payloadHash, hashErr := deterministicProtoHash(req)
		if hashErr != nil {
			return nil, hashErr
		}
		admission, created, err = s.admission.AdmitNewConversation(
			ctx,
			ptid,
			turnRequest,
			NewConversationAdmission{
				ConversationID: conversationID,
				Title:          homeCommandTitle(req.GetInput()),
				ProviderID:     agent.ProviderID,
				ModelName:      agent.ModelName,
			},
			payloadHash,
		)
	} else {
		admission, err = s.admission.Admit(ctx, ptid, turnRequest)
		created = admission != nil &&
			admission.GetStatus() == model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED
	}
	if err != nil {
		return nil, err
	}
	if admission == nil || strings.TrimSpace(admission.GetTurnId()) == "" {
		return nil, homeCommandInternal("Home Chat admission returned no Turn", nil)
	}
	if created && !s.turns.StartAdmittedTurn(ptid, turnRequest, admission) {
		runtimeErr := errcode.NewRuntimeUnavailable(
			req.GetRuntimeProfileId(),
			"station_execution_lifecycle_unavailable",
		)
		if settleErr := s.turns.FailAdmittedTurnStart(
			ctx,
			agent.AgentID,
			admission.GetTurnId(),
			"station_execution_lifecycle_unavailable",
			runtimeErr,
		); settleErr != nil {
			return nil, homeCommandInternal(
				"failed to settle accepted Home Chat start",
				settleErr,
			)
		}
	}
	return &model.SubmitHomeChatCommandResponse{
		ConversationId:     conversationID,
		TurnId:             admission.GetTurnId(),
		ProjectionRevision: uint64(s.now().UnixNano()),
	}, nil
}

func (s *HomeCommandService) SubmitTask(
	ctx context.Context,
	ptid string,
	req *model.SubmitHomeTaskCommandRequest,
) (*model.SubmitHomeTaskCommandResponse, error) {
	_, err := s.validateCommand(
		ctx,
		ptid,
		req.GetAgentId(),
		req.GetExpectedAgentVersion(),
		req.GetRuntimeProfileId(),
		req.GetReadinessSnapshotId(),
		req.GetInput(),
		req.GetClientIdempotencyKey(),
	)
	if err != nil {
		return nil, err
	}
	if s.tasks == nil {
		return nil, homeCommandInternal("Home Task runtime is not configured", nil)
	}
	payloadHash, err := deterministicProtoHash(req)
	if err != nil {
		return nil, err
	}
	result, err := s.tasks.Create(
		ctx,
		ptid,
		&model.CreateTaskRunRequest{
			Title:                req.GetInput(),
			Description:          req.GetInput(),
			AgentId:              req.GetAgentId(),
			Surface:              model.TaskSurface_TASK_SURFACE_DIRECT_RUN,
			InitialStatus:        model.CollaborationTaskStatus_COLLABORATION_TASK_STATUS_RUNNING,
			ClientIdempotencyKey: req.GetClientIdempotencyKey(),
			CommandPayloadHash:   payloadHash,
			SourceRef:            req.GetTopicRef(),
			Meta: map[string]string{
				"agent_version":        strconv.FormatUint(req.GetExpectedAgentVersion(), 10),
				"entrypoint":           "home",
				"readiness_snapshot":   req.GetReadinessSnapshotId(),
				"runtime_profile_id":   req.GetRuntimeProfileId(),
				"task_command_version": "1",
			},
		},
	)
	if err != nil {
		return nil, err
	}
	if result.GetTask() == nil || strings.TrimSpace(result.GetTask().GetTaskId()) == "" {
		return nil, homeCommandInternal("Home Task writer returned no TaskRun", nil)
	}
	revision := uint64(s.now().UnixNano())
	if result.GetTask().GetUpdatedAt() != nil {
		revision = uint64(result.GetTask().GetUpdatedAt().AsTime().UnixNano())
	}
	return &model.SubmitHomeTaskCommandResponse{
		TaskId:             result.GetTask().GetTaskId(),
		ProjectionRevision: revision,
	}, nil
}

func (s *HomeCommandService) validateCommand(
	ctx context.Context,
	ptid string,
	agentID string,
	expectedAgentVersion uint64,
	runtimeProfileID string,
	readinessSnapshotID string,
	input string,
	idempotencyKey string,
) (*domain.Agent, error) {
	ptid = strings.TrimSpace(ptid)
	agentID = strings.TrimSpace(agentID)
	runtimeProfileID = strings.TrimSpace(runtimeProfileID)
	readinessSnapshotID = strings.TrimSpace(readinessSnapshotID)
	if ptid == "" || agentID == "" || expectedAgentVersion == 0 ||
		runtimeProfileID == "" || readinessSnapshotID == "" ||
		strings.TrimSpace(input) == "" || strings.TrimSpace(idempotencyKey) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidRequest,
			http.StatusBadRequest,
			"actor, agent_id, expected_agent_version, runtime_profile_id, readiness_snapshot_id, input and client_idempotency_key are required",
			nil,
		)
	}
	if runtimeProfileID != modernChatAgentProfileID {
		return nil, errcode.NewRuntimeUnavailable(
			runtimeProfileID,
			"runtime_profile_not_available",
		)
	}
	agent, err := s.agents.GetAgent(ctx, ptid, agentID)
	if err != nil {
		return nil, err
	}
	if uint64(agent.Version) != expectedAgentVersion {
		return nil, errcode.NewActiveMutationConflict(
			agent.AgentID,
			int64(expectedAgentVersion),
			agent.Version,
		)
	}
	if strings.TrimSpace(agent.ProviderID) == "" || strings.TrimSpace(agent.ModelName) == "" {
		return nil, errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Agent model configuration is required",
			nil,
		)
	}
	if err := s.validateReadinessSnapshot(
		ctx,
		ptid,
		agentID,
		expectedAgentVersion,
		readinessSnapshotID,
	); err != nil {
		return nil, err
	}
	return agent, nil
}

func (s *HomeCommandService) validateReadinessSnapshot(
	ctx context.Context,
	ptid string,
	agentID string,
	expectedAgentVersion uint64,
	snapshotID string,
) error {
	db, err := s.getDB(ctx)
	if err != nil {
		return err
	}
	var record persistence.CapabilityReadinessSnapshot
	err = db.WithContext(ctx).
		Where("snapshot_id = ? AND ptid = ? AND agent_id = ?", snapshotID, ptid, agentID).
		First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Home readiness snapshot is unavailable",
			err,
		)
	}
	if err != nil {
		return homeCommandInternal("load Home readiness snapshot", err)
	}
	if !record.ExpiresAt.After(s.now()) {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Home readiness snapshot is stale",
			nil,
		)
	}
	var snapshot model.CapabilityReadinessSnapshot
	if err := proto.Unmarshal(record.Payload, &snapshot); err != nil {
		return homeCommandInternal("decode Home readiness snapshot", err)
	}
	expectedRevision := "agent:" + agentID + ":" + strconv.FormatUint(expectedAgentVersion, 10)
	if snapshot.GetPtid() != ptid ||
		snapshot.GetAgentId() != agentID ||
		!containsString(snapshot.GetBindingRevisions(), expectedRevision) {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"Home readiness snapshot does not match the selected Agent revision",
			nil,
		)
	}
	for _, readiness := range snapshot.GetCapabilities() {
		switch readiness.GetState() {
		case model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_BLOCKED,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNAVAILABLE,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNKNOWN,
			model.CapabilityReadinessState_CAPABILITY_READINESS_STATE_UNSPECIFIED:
			return errcode.New(
				errcode.AgentInvalidSourceState,
				http.StatusConflict,
				"Home readiness is unresolved: "+readiness.GetReasonCode(),
				nil,
			)
		}
	}
	return nil
}

func (s *HomeCommandService) getDB(ctx context.Context) (*gorm.DB, error) {
	if s.db != nil {
		return s.db.WithContext(ctx), nil
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
	if err != nil {
		return nil, homeCommandInternal("open Agent database", err)
	}
	return db, nil
}

func deterministicProtoHash(message proto.Message) (string, error) {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return "", homeCommandInternal("encode Home command payload", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func homeCommandResourceID(prefix string, parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return prefix + "_" + hex.EncodeToString(sum[:])[:31]
}

func homeCommandTitle(input string) string {
	input = strings.TrimSpace(input)
	if len(input) <= 80 {
		return input
	}
	return strings.TrimSpace(input[:80])
}

func homeStringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func homeCommandInternal(message string, cause error) error {
	return errcode.New(
		errcode.AgentInternal,
		http.StatusInternalServerError,
		message,
		cause,
	)
}
