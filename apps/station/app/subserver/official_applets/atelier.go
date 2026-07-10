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
	return []server.Handler{
		server.NewHTTPHandler(
			"official-applet-atelier",
			atelierMountPath+"/",
			server.ANY,
			s.handle,
			serverwrapper.LogID(),
			s.jwtWrapper,
		),
	}
}

func (s *AtelierSubServer) handle(ctx context.Context, req server.Request, resp server.Response) error {
	if s.projectionService == nil {
		return server.InternalError("atelier applet projection service is not initialized")
	}

	subject := coreauth.GetSubject(ctx)
	if subject == nil || strings.TrimSpace(subject.ID) == "" {
		return server.Unauthorized("authentication required")
	}

	path := requestPathOnly(req.Path())
	method := req.Method()
	actorID := strings.TrimSpace(subject.ID)

	switch {
	case method == server.GET && path == atelierV1Prefix+"/workspace":
		output, err := s.projectionService.LoadWorkspace(ctx, actorID, &agentservice.LoadAtelierWorkspaceRequest{})
		return s.writeJSON(resp, output, err)
	case method == server.POST && path == atelierV1Prefix+"/projects":
		var input agentservice.CreateAtelierProjectFromGoalRequest
		if err := decodeJSON(req, &input); err != nil {
			return server.BadRequestWithCause("invalid Atelier project create request", err)
		}
		output, err := s.projectionService.CreateProjectFromGoal(ctx, actorID, &input)
		return s.writeJSON(resp, output, err)
	case method == server.POST && path == atelierV1Prefix+"/messages":
		var input agentservice.SendAtelierMessageRequest
		if err := decodeJSON(req, &input); err != nil {
			return server.BadRequestWithCause("invalid Atelier message request", err)
		}
		output, err := s.projectionService.SendMessage(ctx, actorID, &input)
		return s.writeJSON(resp, output, err)
	case method == server.POST && path == atelierV1Prefix+"/escalations:resolve":
		var input agentservice.ResolveAtelierDecisionRequest
		if err := decodeJSON(req, &input); err != nil {
			return server.BadRequestWithCause("invalid Atelier escalation resolve request", err)
		}
		output, err := s.projectionService.ResolveDecision(ctx, actorID, &input)
		return s.writeJSON(resp, output, err)
	case method == server.PATCH && strings.HasPrefix(path, atelierV1Prefix+"/tasks/") && strings.HasSuffix(path, "/status"):
		taskID := strings.TrimSuffix(strings.TrimPrefix(path, atelierV1Prefix+"/tasks/"), "/status")
		if strings.TrimSpace(taskID) == "" || strings.Contains(taskID, "/") {
			return server.BadRequest("invalid Atelier task status path")
		}
		var input agentservice.SetAtelierTaskStatusRequest
		if err := decodeJSON(req, &input); err != nil {
			return server.BadRequestWithCause("invalid Atelier task status request", err)
		}
		input.TaskID = taskID
		output, err := s.projectionService.SetTaskStatus(ctx, actorID, &input)
		return s.writeJSON(resp, output, err)
	case method == server.DELETE && strings.HasPrefix(path, atelierV1Prefix+"/tasks/"):
		taskID := strings.TrimPrefix(path, atelierV1Prefix+"/tasks/")
		if strings.TrimSpace(taskID) == "" || strings.Contains(taskID, "/") {
			return server.BadRequest("invalid Atelier task purge path")
		}
		output, err := s.projectionService.PurgeTask(ctx, actorID, &agentservice.PurgeAtelierTaskRequest{TaskID: taskID})
		return s.writeJSON(resp, output, err)
	default:
		return server.NotFound("Atelier applet route not found")
	}
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
