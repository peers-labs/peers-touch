package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	agentpersistence "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	channelsvc "github.com/peers-labs/peers-touch/station/app/subserver/channel/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss"
)

type ChannelAttachmentStore interface {
	StoreChannelAttachment(
		ctx context.Context,
		actorPTID, conversationID, fileName, mimeType string,
		body []byte,
	) (oss.TrustedAttachment, error)
	ReadChannelAttachment(
		ctx context.Context,
		actorPTID, objectRef string,
		maxBytes uint64,
	) (oss.TrustedAttachment, []byte, error)
}

// ChannelTurnExecutor adapts Channel's host-neutral durable admission contract
// to the canonical Agent admission, lifecycle and attachment owners.
type ChannelTurnExecutor struct {
	turns        *TurnService
	convs        *ConversationService
	admission    *TurnAdmissionService
	attachments  ChannelAttachmentStore
	agents       *AgentService
	capabilities *CapabilityAuthorityService
	registry     *ToolRegistryService
	growth       *GrowthMetricsService
}

func NewChannelTurnExecutor(
	turns *TurnService,
	convs *ConversationService,
	admission *TurnAdmissionService,
	attachments ChannelAttachmentStore,
	agents *AgentService,
	capabilities *CapabilityAuthorityService,
	registry *ToolRegistryService,
	growth *GrowthMetricsService,
) *ChannelTurnExecutor {
	return &ChannelTurnExecutor{
		turns: turns, convs: convs, admission: admission, attachments: attachments,
		agents: agents, capabilities: capabilities, registry: registry,
		growth: growth,
	}
}

var _ channelsvc.TurnExecutor = (*ChannelTurnExecutor)(nil)

func (a *ChannelTurnExecutor) EnsureConversation(
	ctx context.Context,
	actorPTID, agentID, conversationID, title string,
) error {
	if a == nil || a.convs == nil {
		return errors.New("conversation service unavailable")
	}
	if _, err := a.convs.GetConversation(ctx, actorPTID, conversationID); err == nil {
		return nil
	}
	_, err := a.convs.CreateConversationWithID(
		ctx, conversationID, agentID, actorPTID, title, "", "", "",
	)
	if err != nil && errors.Is(err, gorm.ErrDuplicatedKey) {
		return nil
	}
	return err
}

func (a *ChannelTurnExecutor) AdmitTurn(
	ctx context.Context,
	input channelsvc.TurnAdmissionInput,
) (channelsvc.TurnAdmissionResult, error) {
	if a == nil || a.turns == nil || a.admission == nil {
		return channelsvc.TurnAdmissionResult{}, errors.New("turn admission unavailable")
	}
	if err := a.ensureRequesterCapabilities(
		ctx, input.ActorPTID, input.AgentID,
	); err != nil {
		return channelsvc.TurnAdmissionResult{}, err
	}
	attachments, err := a.materializeAttachments(ctx, input)
	if err != nil {
		return channelsvc.TurnAdmissionResult{}, err
	}
	request := &model.ExecuteTurnRequest{
		ConversationId: input.ConversationID, AgentId: input.AgentID,
		UserInput: input.UserInput, ClientIdempotencyKey: input.IdempotencyKey,
		Attachments: attachments,
	}
	admission, err := a.admission.Admit(ctx, input.ActorPTID, request)
	if err != nil {
		return channelsvc.TurnAdmissionResult{}, err
	}
	result := channelAdmissionResult(admission, input.IdempotencyKey)
	if admission.GetStatus() == model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED {
		if !a.turns.StartAdmittedTurn(input.ActorPTID, request, admission) {
			_ = a.turns.FailAdmittedTurnStart(
				context.WithoutCancel(ctx), input.AgentID, admission.GetTurnId(),
				"channel execution lifecycle unavailable", nil,
			)
			return channelsvc.TurnAdmissionResult{}, errors.New("turn execution lifecycle unavailable")
		}
	}
	return result, nil
}

func (a *ChannelTurnExecutor) ensureRequesterCapabilities(
	ctx context.Context,
	actorPTID, agentID string,
) error {
	if a.agents == nil || a.capabilities == nil || a.registry == nil {
		return errors.New("channel requester capability authority unavailable")
	}
	agent, err := a.agents.GetAgent(ctx, actorPTID, agentID)
	if err != nil {
		return err
	}
	bindings, err := a.capabilities.ListBindings(ctx, actorPTID, agentID)
	if err != nil {
		return err
	}
	existing := make(map[string]struct{}, len(bindings))
	for _, binding := range bindings {
		existing[binding.GetCapabilityId()] = struct{}{}
	}
	for _, toolName := range channelRequesterToolNames {
		capabilityID := "tool:" + toolName
		if _, ok := existing[capabilityID]; ok {
			continue
		}
		version, ok := a.registry.ManifestVersion(toolName)
		if !ok {
			return fmt.Errorf("channel requester tool %s is not registered", toolName)
		}
		approval := model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO
		if toolName == "lark_workspace_write" || toolName == "lark_api_write" {
			approval = model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_MANUAL
		}
		_, err := a.capabilities.UpsertBinding(
			ctx,
			actorPTID,
			&model.UpsertAgentCapabilityBindingRequest{
				Binding: &model.AgentCapabilityBinding{
					Ptid: actorPTID, AgentId: agentID,
					CapabilityId: capabilityID, CapabilityVersion: version,
					Enabled: true, ApprovalPolicy: approval,
					ExpectedAgentVersion: uint64(agent.Version),
				},
				IdempotencyKey: fmt.Sprintf(
					"channel-requester:%s:%s:%s:%d",
					agentID, toolName, version, agent.Version,
				),
			},
		)
		if err != nil {
			return fmt.Errorf("bind channel requester capability %s: %w", toolName, err)
		}
		existing[capabilityID] = struct{}{}
	}
	return nil
}

func (a *ChannelTurnExecutor) ResolveAdmission(
	ctx context.Context,
	actorPTID, conversationID, admissionID string,
) (channelsvc.TurnAdmissionResult, error) {
	if a == nil || a.admission == nil {
		return channelsvc.TurnAdmissionResult{}, errors.New("turn admission unavailable")
	}
	admission, err := a.admission.ResolveAdmission(
		ctx, actorPTID, conversationID, admissionID,
	)
	if err != nil {
		return channelsvc.TurnAdmissionResult{}, err
	}
	return channelAdmissionResult(admission, admissionID), nil
}

func (a *ChannelTurnExecutor) Snapshot(
	ctx context.Context,
	actorPTID, conversationID, turnID string,
) (channelsvc.TurnSnapshot, error) {
	if a == nil || a.convs == nil {
		return channelsvc.TurnSnapshot{}, errors.New("conversation service unavailable")
	}
	snapshot, err := a.convs.GetTurnEventSnapshot(
		ctx, actorPTID, conversationID, turnID,
	)
	if err != nil {
		return channelsvc.TurnSnapshot{}, err
	}
	result := channelsvc.TurnSnapshot{
		TurnID: snapshot.TurnID, Status: snapshot.Status,
		Text: snapshot.Text, TerminalReason: snapshot.TerminalReason,
		Revision: uint64(snapshot.LastSequence), UpdatedAt: snapshot.UpdatedAt,
	}
	db, err := a.convs.getDB(ctx)
	if err != nil {
		return channelsvc.TurnSnapshot{}, err
	}
	var pending agentpersistence.ToolCall
	err = db.WithContext(ctx).
		Where("actor_id = ? AND turn_id = ? AND status = ?",
			strings.TrimSpace(actorPTID), turnID,
			agentpersistence.ToolCallStatusWaitingApproval).
		Order("created_at ASC").First(&pending).Error
	if err == nil && (pending.ExecutionDeadline == nil ||
		pending.ExecutionDeadline.After(time.Now())) {
		result.Pending = &channelsvc.TurnPendingInteraction{
			Kind: "approval", InteractionID: pending.ApprovalID,
			ToolCallID: pending.ToolCallID, Title: pending.ToolName,
			Detail: pending.RedactedArguments,
			DecisionID: fmt.Sprintf(
				"channel:%s:%d", pending.ApprovalID, pending.DecisionRevision,
			),
			ExpectedRevision: pending.DecisionRevision,
			ExpiresAt:        pending.ExecutionDeadline,
		}
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return channelsvc.TurnSnapshot{}, err
	}
	result.Outputs, err = channelTurnOutputs(ctx, db, conversationID, turnID)
	if err != nil {
		return channelsvc.TurnSnapshot{}, err
	}
	return result, nil
}

func (a *ChannelTurnExecutor) CancelTurn(
	ctx context.Context,
	actorPTID, turnID string,
) error {
	if a == nil || a.turns == nil {
		return errors.New("turn service unavailable")
	}
	_, err := a.turns.RequestCancelTurn(ctx, actorPTID, turnID)
	return err
}

func (a *ChannelTurnExecutor) ReadOutput(
	ctx context.Context,
	actorPTID, turnID string,
	output channelsvc.TurnOutput,
) ([]byte, error) {
	if a == nil || a.convs == nil {
		return nil, errors.New("turn output service unavailable")
	}
	db, err := a.convs.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var owned int64
	if err := db.WithContext(ctx).Table("agent_turns AS turn").
		Joins("JOIN agent_conversations AS conversation ON conversation.id = turn.conversation_id").
		Where("turn.id = ? AND conversation.actor_ptid = ?",
			turnID, strings.TrimSpace(actorPTID)).
		Count(&owned).Error; err != nil {
		return nil, err
	}
	if owned != 1 {
		return nil, errors.New("turn output is not owned by the actor")
	}
	switch output.SourceKind {
	case "message_attachment":
		if a.attachments == nil {
			return nil, errors.New("channel attachment storage unavailable")
		}
		meta, body, err := a.attachments.ReadChannelAttachment(
			ctx, actorPTID, output.ObjectRef, 32*1024*1024,
		)
		if err != nil {
			return nil, err
		}
		if output.Checksum != "" && meta.Checksum != output.Checksum {
			return nil, errors.New("turn output checksum changed")
		}
		return body, nil
	case "task_artifact":
		var blob agentpersistence.TaskArtifactBlob
		if err := db.WithContext(ctx).
			Where("artifact_id = ? AND turn_id = ?", output.OutputID, turnID).
			First(&blob).Error; err != nil {
			return nil, err
		}
		if blob.RetentionStatus != "active" ||
			(blob.ExpiresAt != nil && !blob.ExpiresAt.After(time.Now().UTC())) {
			return nil, errors.New("turn artifact is no longer available")
		}
		return []byte(blob.BodyText), nil
	default:
		return nil, errors.New("unsupported turn output source")
	}
}

func (a *ChannelTurnExecutor) SubmitToolDecision(
	ctx context.Context,
	actorPTID string,
	input channelsvc.ToolDecisionInput,
) error {
	if a == nil || a.turns == nil {
		return errors.New("turn service unavailable")
	}
	request := &model.SubmitToolApprovalDecisionRequest{
		ApprovalId: input.ApprovalID, ToolCallId: input.ToolCallID,
		DecisionId: input.DecisionID, ExpectedRevision: input.ExpectedRevision,
		Approved: input.Approved, IdempotencyKey: input.IdempotencyKey,
	}
	request.PayloadHash = decisionPayloadHash(request)
	response, err := a.turns.SubmitToolDecision(
		ctx,
		actorPTID,
		request,
	)
	if err != nil {
		return err
	}
	if response == nil || !response.GetAccepted() {
		return fmt.Errorf("tool decision was not accepted")
	}
	return nil
}

func (a *ChannelTurnExecutor) RecordFeedback(
	ctx context.Context,
	actorPTID string,
	input channelsvc.TurnFeedbackInput,
) error {
	if a == nil || a.growth == nil {
		return errors.New("turn feedback service unavailable")
	}
	signal := "negative"
	rating := int32(-1)
	if input.Positive {
		signal = "positive"
		rating = 1
	}
	_, _, err := a.growth.RecordFeedback(ctx, actorPTID, TurnFeedbackInput{
		AgentID: input.AgentID, TurnID: input.TurnID,
		ConversationID: input.ConversationID,
		Signal:         signal, Source: "lark_card", Rating: rating,
		IdempotencyKey: input.IdempotencyKey,
	})
	return err
}

func channelTurnOutputs(
	ctx context.Context,
	db *gorm.DB,
	conversationID, turnID string,
) ([]channelsvc.TurnOutput, error) {
	outputs := make([]channelsvc.TurnOutput, 0)
	var artifacts []agentpersistence.TaskArtifact
	if err := db.WithContext(ctx).Where("turn_id = ?", turnID).
		Order("event_seq ASC").Find(&artifacts).Error; err != nil {
		return nil, err
	}
	for _, artifact := range artifacts {
		var blob agentpersistence.TaskArtifactBlob
		if err := db.WithContext(ctx).Where(
			"artifact_id = ? AND turn_id = ?", artifact.ArtifactID, turnID,
		).First(&blob).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return nil, err
		}
		mimeType, fileName := channelArtifactPresentation(artifact)
		outputs = append(outputs, channelsvc.TurnOutput{
			OutputID: artifact.ArtifactID, Kind: artifact.Kind,
			Name: fileName, MIMEType: mimeType, ObjectRef: blob.BodyURI,
			Checksum: blob.ContentHash, SizeBytes: uint64(max(blob.ByteSize, 0)),
			Summary:    artifact.Name,
			SourceKind: "task_artifact",
		})
	}
	var messages []agentpersistence.AgentMessage
	if err := db.WithContext(ctx).
		Where("conversation_id = ? AND turn_id = ? AND role = ?",
			conversationID, turnID, "assistant").
		Order("seq ASC").Find(&messages).Error; err != nil {
		return nil, err
	}
	for _, message := range messages {
		if len(message.AttachmentsJSON) == 0 {
			continue
		}
		var attachments []*model.AgentAttachmentRef
		if json.Unmarshal(message.AttachmentsJSON, &attachments) != nil {
			continue
		}
		for _, attachment := range attachments {
			if attachment == nil || strings.TrimSpace(attachment.GetObjectRef()) == "" {
				continue
			}
			outputs = append(outputs, channelsvc.TurnOutput{
				OutputID: attachment.GetAttachmentId(), Kind: "attachment",
				Name: attachment.GetFilename(), MIMEType: attachment.GetMimeType(),
				ObjectRef: attachment.GetObjectRef(), Checksum: attachment.GetChecksum(),
				SizeBytes: attachment.GetSizeBytes(), SourceKind: "message_attachment",
			})
		}
	}
	return outputs, nil
}

func channelArtifactPresentation(
	artifact agentpersistence.TaskArtifact,
) (string, string) {
	name := strings.TrimSpace(artifact.Name)
	if name == "" {
		name = artifact.ArtifactID
	}
	switch strings.ToLower(strings.TrimSpace(artifact.Kind)) {
	case "image", "png":
		if !strings.Contains(name, ".") {
			name += ".png"
		}
		return "image/png", name
	case "html":
		if !strings.Contains(name, ".") {
			name += ".html"
		}
		return "text/html", name
	case "json", "structured":
		if !strings.Contains(name, ".") {
			name += ".json"
		}
		return "application/json", name
	default:
		if !strings.Contains(name, ".") {
			name += ".md"
		}
		return "text/markdown", name
	}
}

func (a *ChannelTurnExecutor) materializeAttachments(
	ctx context.Context,
	input channelsvc.TurnAdmissionInput,
) ([]*model.AgentAttachmentRef, error) {
	if len(input.Attachments) == 0 {
		return nil, nil
	}
	if a.attachments == nil {
		return nil, errors.New("channel attachment storage unavailable")
	}
	result := make([]*model.AgentAttachmentRef, 0, len(input.Attachments))
	for _, attachment := range input.Attachments {
		stored, err := a.attachments.StoreChannelAttachment(
			ctx, input.ActorPTID, input.ConversationID,
			attachment.FileName, attachment.MIMEType, attachment.Body,
		)
		if err != nil {
			return nil, fmt.Errorf("store channel attachment: %w", err)
		}
		attachmentID := strings.TrimSpace(attachment.AttachmentID)
		if attachmentID == "" {
			attachmentID = "channel-attachment"
		}
		result = append(result, &model.AgentAttachmentRef{
			AttachmentId: attachmentID, ObjectRef: stored.ObjectRef,
			MimeType: stored.MIMEType, SizeBytes: stored.SizeBytes,
			Checksum: stored.Checksum, Filename: stored.FileName,
			AuthorizationScope: stored.AuthorizationScope,
			ExpiresAt:          timestamppb.New(stored.ExpiresAt),
		})
	}
	return result, nil
}

func channelAdmissionResult(
	admission *model.TurnAdmission,
	admissionID string,
) channelsvc.TurnAdmissionResult {
	if admission == nil {
		return channelsvc.TurnAdmissionResult{}
	}
	status := "queued"
	switch admission.GetStatus() {
	case model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_STARTED:
		status = "started"
	case model.TurnAdmissionStatus_TURN_ADMISSION_STATUS_REPLAYED:
		status = "replayed"
	}
	return channelsvc.TurnAdmissionResult{
		TurnID: admission.GetTurnId(), AdmissionID: admissionID, Status: status,
	}
}
