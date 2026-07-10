package officialapplets

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	agentevent "github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/event"
	agentservice "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

const atelierMountPath = "/applets/atelier"
const atelierV1Prefix = atelierMountPath + "/v1"

type AtelierSubServer struct {
	status            server.Status
	jwtWrapper        server.Wrapper
	projectionService *agentservice.AtelierProjectionService
}

func NewAtelierSubServer(_ ...option.Option) server.Subserver {
	return &AtelierSubServer{status: server.StatusStopped}
}

func (s *AtelierSubServer) Init(_ context.Context, _ ...option.Option) error {
	s.status = server.StatusStarting

	provider := coreauth.NewJWTProvider(coreauth.Get().Secret, coreauth.Get().AccessTTL)
	s.jwtWrapper = server.HTTPWrapperAdapter(httpadapter.RequireJWT(provider))
	s.projectionService = newOfficialAtelierProjectionService()
	return nil
}

func (s *AtelierSubServer) Start(context.Context, ...option.Option) error {
	s.status = server.StatusRunning
	return nil
}

func (s *AtelierSubServer) Stop(context.Context) error {
	s.status = server.StatusStopped
	return nil
}

func (s *AtelierSubServer) Name() string                     { return "official_applet_atelier" }
func (s *AtelierSubServer) Type() server.SubserverType       { return server.SubserverTypeHTTP }
func (s *AtelierSubServer) Status() server.Status            { return s.status }
func (s *AtelierSubServer) Address() server.SubserverAddress { return server.SubserverAddress{} }

func (s *AtelierSubServer) Handlers() []server.Handler {
	w := []server.Wrapper{serverwrapper.LogID(), s.jwtWrapper}
	return []server.Handler{
		server.NewHTTPHandler("atelier-workspace", atelierV1Prefix+"/workspace", server.GET, s.handleWorkspace, w...),
		server.NewHTTPHandler("atelier-projects-create", atelierV1Prefix+"/projects", server.POST, s.handleCreateProject, w...),
		server.NewHTTPHandler("atelier-messages-send", atelierV1Prefix+"/messages", server.POST, s.handleSendMessage, w...),
		server.NewHTTPHandler("atelier-escalations-resolve", atelierV1Prefix+"/escalations:resolve", server.POST, s.handleResolveDecision, w...),
		server.NewHTTPHandler("atelier-provider-capabilities", atelierV1Prefix+"/provider/capabilities", server.POST, s.handleProviderCapabilities, w...),
		server.NewHTTPHandler("atelier-feedback-submit", atelierV1Prefix+"/feedback/submit", server.POST, s.handleSubmitFeedback, w...),
		server.NewHTTPHandler("atelier-memory-confirm", atelierV1Prefix+"/memory/confirm-candidate", server.POST, s.handleConfirmMemory, w...),
		server.NewHTTPHandler("atelier-feedback-rerun", atelierV1Prefix+"/feedback/confirm-rerun", server.POST, s.handleConfirmRerun, w...),
		server.NewHTTPHandler("atelier-artifact-fetch", atelierV1Prefix+"/artifact/body/fetch", server.POST, s.handleFetchArtifact, w...),
		server.NewHTTPHandler("atelier-task-status", atelierV1Prefix+"/tasks/:taskID/status", server.PATCH, s.handleSetTaskStatus, w...),
		server.NewHTTPHandler("atelier-task-purge", atelierV1Prefix+"/tasks/:taskID", server.DELETE, s.handlePurgeTask, w...),
	}
}

func (s *AtelierSubServer) requireActor(ctx context.Context) (string, error) {
	if s.projectionService == nil {
		return "", server.InternalError("atelier applet projection service is not initialized")
	}
	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return "", server.Unauthorized("authentication required")
	}
	return strings.TrimSpace(subject.ID), nil
}

func (s *AtelierSubServer) handleWorkspace(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	output, svcErr := s.projectionService.LoadWorkspace(ctx, actorID, &agentservice.LoadAtelierWorkspaceRequest{})
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleCreateProject(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.CreateAtelierProjectFromGoalRequest
	if err := decodeJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier project create request", err)
	}
	output, svcErr := s.projectionService.CreateProjectFromGoal(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleSendMessage(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.SendAtelierMessageRequest
	if err := decodeAtelierMessageJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier message request", err)
	}
	output, svcErr := s.projectionService.SendMessage(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleResolveDecision(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.ResolveAtelierDecisionRequest
	if err := decodeJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier escalation resolve request", err)
	}
	output, svcErr := s.projectionService.ResolveDecision(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleProviderCapabilities(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.ListAtelierProviderCapabilitiesRequest
	if err := decodeJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier provider capabilities request", err)
	}
	output, svcErr := s.projectionService.ProviderCapabilities(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleSubmitFeedback(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.SubmitAtelierFeedbackRequest
	if err := decodeAtelierFeedbackSubmitJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier feedback submit request", err)
	}
	output, svcErr := s.projectionService.SubmitFeedback(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleConfirmMemory(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.ConfirmAtelierMemoryCandidateRequest
	if err := decodeAtelierMemoryConfirmationJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier memory confirmation request", err)
	}
	output, svcErr := s.projectionService.ConfirmMemoryCandidate(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleConfirmRerun(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.ConfirmAtelierRerunRequest
	if err := decodeAtelierRerunConfirmationJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier rerun confirmation request", err)
	}
	output, svcErr := s.projectionService.ConfirmRerun(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleFetchArtifact(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	var input agentservice.FetchAtelierArtifactBodyRequest
	if err := decodeJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier artifact body fetch request", err)
	}
	output, svcErr := s.projectionService.FetchArtifactBody(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handleSetTaskStatus(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	path := requestPathOnly(req.Path())
	taskID := strings.TrimSuffix(strings.TrimPrefix(path, atelierV1Prefix+"/tasks/"), "/status")
	if strings.TrimSpace(taskID) == "" || strings.Contains(taskID, "/") {
		return server.BadRequest("invalid Atelier task status path")
	}
	var input agentservice.SetAtelierTaskStatusRequest
	if err := decodeJSON(req, &input); err != nil {
		return server.BadRequestWithCause("invalid Atelier task status request", err)
	}
	input.TaskID = taskID
	output, svcErr := s.projectionService.SetTaskStatus(ctx, actorID, &input)
	return s.writeJSON(resp, output, svcErr)
}

func (s *AtelierSubServer) handlePurgeTask(ctx context.Context, req server.Request, resp server.Response) error {
	actorID, err := s.requireActor(ctx)
	if err != nil {
		return err
	}
	path := requestPathOnly(req.Path())
	taskID := strings.TrimPrefix(path, atelierV1Prefix+"/tasks/")
	if strings.TrimSpace(taskID) == "" || strings.Contains(taskID, "/") {
		return server.BadRequest("invalid Atelier task purge path")
	}
	output, svcErr := s.projectionService.PurgeTask(ctx, actorID, &agentservice.PurgeAtelierTaskRequest{TaskID: taskID})
	return s.writeJSON(resp, output, svcErr)
}

func newOfficialAtelierProjectionService() *agentservice.AtelierProjectionService {
	eventBus := agentevent.NewMemoryEventBus()
	growthMetricsSvc := agentservice.NewGrowthMetricsService()
	diagnosticSvc := agentservice.NewGrowthDiagnosticService()
	growthMetricsSvc.SetDiagnosticService(diagnosticSvc)

	agentSvc := agentservice.NewAgentService()
	memorySvc := agentservice.NewMemoryService(growthMetricsSvc)
	skillGuardSvc := agentservice.NewSkillsGuardService()
	skillSvc := agentservice.NewSkillService(skillGuardSvc, growthMetricsSvc)
	errorClassifierSvc := agentservice.NewErrorClassifierService()
	promptAssemblySvc := agentservice.NewPromptAssemblyService(memorySvc, skillSvc)
	compressionSvc := agentservice.NewCompressionService()
	promptCachingSvc := agentservice.NewPromptCachingService()
	providerSvc := agentservice.NewProviderService(promptCachingSvc)
	credentialPoolSvc := agentservice.NewCredentialPoolService()
	contextReferenceSvc := agentservice.NewContextReferenceService()
	delegationSvc := agentservice.NewDelegationService()
	toolRegistrySvc := agentservice.NewToolRegistryService(memorySvc, skillSvc)
	reviewSvc := agentservice.NewReviewService(
		credentialPoolSvc,
		errorClassifierSvc,
		providerSvc,
		memorySvc,
		skillSvc,
		toolRegistrySvc,
		growthMetricsSvc,
	)
	turnSvc := agentservice.NewTurnService(
		errorClassifierSvc,
		memorySvc,
		skillSvc,
		promptAssemblySvc,
		compressionSvc,
		providerSvc,
		credentialPoolSvc,
		contextReferenceSvc,
		delegationSvc,
		toolRegistrySvc,
		reviewSvc,
		growthMetricsSvc,
	)
	turnSvc.SetEventBus(eventBus)
	orchestrationSvc := agentservice.NewOrchestrationService(agentSvc, turnSvc, toolRegistrySvc)
	orchestrationSvc.SetEventBus(eventBus)
	return agentservice.NewAtelierProjectionService(orchestrationSvc)
}

func requestPathOnly(fullPath string) string {
	if idx := strings.Index(fullPath, "?"); idx >= 0 {
		return fullPath[:idx]
	}
	return fullPath
}

func decodeJSON(req server.Request, target interface{}) error {
	body := req.Body()
	if len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, target)
}

func decodeAtelierMessageJSON(req server.Request, target *agentservice.SendAtelierMessageRequest) error {
	return decodeAtelierStrictJSON(req, target, []string{"run", "attachments", "inputSnapshot", "input_snapshot"}, "Atelier message request")
}

func decodeAtelierFeedbackSubmitJSON(req server.Request, target *agentservice.SubmitAtelierFeedbackRequest) error {
	return decodeAtelierStrictJSON(req, target, []string{
		"run",
		"execute",
		"provider",
		"attachments",
		"memory",
		"memoryContent",
		"memory_content",
		"rerun",
		"rerunTaskId",
		"inputSnapshot",
		"input_snapshot",
	}, "Atelier feedback submit request")
}

func decodeAtelierMemoryConfirmationJSON(req server.Request, target *agentservice.ConfirmAtelierMemoryCandidateRequest) error {
	return decodeAtelierStrictJSON(req, target, []string{
		"run",
		"execute",
		"provider",
		"attachments",
		"memory",
		"memoryContent",
		"memory_content",
		"content",
		"target",
		"layer",
		"inputSnapshot",
		"input_snapshot",
	}, "Atelier memory confirmation request")
}

func decodeAtelierRerunConfirmationJSON(req server.Request, target *agentservice.ConfirmAtelierRerunRequest) error {
	return decodeAtelierStrictJSON(req, target, []string{
		"run",
		"execute",
		"provider",
		"attachments",
		"rerun",
		"rerunTaskId",
		"goal",
		"model",
		"inputSnapshot",
		"input_snapshot",
	}, "Atelier rerun confirmation request")
}

func decodeAtelierStrictJSON(req server.Request, target interface{}, forbiddenFields []string, label string) error {
	body := req.Body()
	if len(body) == 0 {
		return nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return err
	}
	for _, field := range forbiddenFields {
		if _, ok := raw[field]; ok {
			return fmt.Errorf("%s must not include %s", label, field)
		}
	}
	return json.Unmarshal(body, target)
}

func (s *AtelierSubServer) writeJSON(resp server.Response, payload interface{}, err error) error {
	if err != nil {
		return toOfficialAtelierHandlerError(err)
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return server.InternalErrorWithCause("failed to serialize Atelier response", err)
	}
	resp.SetHeader("Content-Type", "application/json")
	resp.WriteHeader(http.StatusOK)
	_, _ = resp.Write(data)
	return nil
}

func toOfficialAtelierHandlerError(err error) error {
	if err == nil {
		return nil
	}
	var biz *errcode.BizError
	if errors.As(err, &biz) {
		return server.NewHandlerErrorWithCause(biz.HTTPStatus, fmt.Sprintf("[%s] %s", biz.Code, biz.Message), err)
	}
	return server.InternalErrorWithCause(fmt.Sprintf("[%s] internal error", errcode.AgentInternal), err)
}
