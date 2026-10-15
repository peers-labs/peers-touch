package service

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
	openai "github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

const providerOperationTimeout = 20 * time.Second
const maxDiscoveredModels = 500

// ProviderOperationsService uses the same actor configuration, admission and
// execution owners as a turn. It owns no second credential or model store.
type ProviderOperationsService struct {
	config    *ProviderConfigService
	admission *RuntimeAdmissionResolver
	executor  *ProviderService
	client    *http.Client
}

func NewProviderOperationsService(
	config *ProviderConfigService,
	admission *RuntimeAdmissionResolver,
	executor *ProviderService,
) *ProviderOperationsService {
	return &ProviderOperationsService{
		config: config, admission: admission, executor: executor,
		client: &http.Client{
			Timeout:   providerOperationTimeout,
			Transport: providerDiscoveryTransport{base: http.DefaultTransport},
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

type providerDiscoveryTransport struct{ base http.RoundTripper }

func (transport providerDiscoveryTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := transport.base.RoundTrip(request)
	if err == nil {
		response.Body = http.MaxBytesReader(nil, response.Body, maxResponseBytes)
	}
	return response, err
}

func (s *ProviderOperationsService) current(
	ctx context.Context, actorID, providerID string, version int64,
) (*persistence.AgentProvider, error) {
	if strings.TrimSpace(actorID) == "" || strings.TrimSpace(providerID) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest,
			"actor and provider are required", nil)
	}
	providers, err := s.config.List(ctx, actorID)
	if err != nil {
		return nil, err
	}
	for i := range providers {
		provider := &providers[i]
		if provider.Name != providerID {
			continue
		}
		if provider.Version != version {
			return nil, errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
				"provider configuration changed", nil)
		}
		if !provider.Enabled {
			return nil, errcode.New(errcode.AgentProviderDisabled, http.StatusBadRequest,
				"provider is disabled", nil)
		}
		if !ProviderRuntimeAdvertised(provider.RuntimeKind, provider.Protocol) {
			return nil, errcode.NewRuntimeUnavailable(
				runtimeKindForUnavailableProvider(provider.RuntimeKind), "runtime_not_advertised")
		}
		return provider, nil
	}
	return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "provider not found", nil)
}

func (s *ProviderOperationsService) unchanged(
	ctx context.Context, actorID string, expected *persistence.AgentProvider,
) error {
	current, err := s.current(ctx, actorID, expected.Name, expected.Version)
	if err != nil {
		return err
	}
	if current.KeyVaults != expected.KeyVaults || current.BaseURL != expected.BaseURL ||
		current.Protocol != expected.Protocol || current.RuntimeKind != expected.RuntimeKind ||
		!bytes.Equal(current.Config, expected.Config) {
		return errcode.New(errcode.AgentVersionConflict, http.StatusConflict,
			"provider configuration or credentials changed", nil)
	}
	return nil
}

func (s *ProviderOperationsService) Check(
	ctx context.Context, actorID string, request *model.CheckProviderRequest,
) (*model.CheckProviderResponse, error) {
	provider, err := s.current(ctx, actorID, request.GetProviderId(), request.GetVersion())
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(request.GetModelId()) == "" {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "model is required", nil)
	}
	snapshot, err := s.admission.Resolve(ctx, actorID, provider.Name, request.GetModelId())
	if err != nil {
		return nil, err
	}
	started := time.Now()
	operationCtx, cancel := context.WithTimeout(ctx, providerOperationTimeout)
	defer cancel()
	result, callErr := s.executor.Call(operationCtx, &ProviderCallRequest{
		ProviderID: provider.ID, ProviderType: provider.Name, UserID: actorID,
		Model: request.GetModelId(), MaxOutputTokens: 16,
		Messages:                        []domain.Message{{Role: "user", Content: "Reply with OK."}},
		ExpectedProviderConfigVersion:   snapshot.ProviderConfigVersion,
		ExpectedCapabilitySourceVersion: snapshot.Capabilities.GetProvenance().GetSourceVersion(),
		BeforeDispatch: func(dispatchCtx context.Context) error {
			return s.unchanged(dispatchCtx, actorID, provider)
		},
	})
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	// A result for another configuration is never a current connection proof.
	if err := s.unchanged(ctx, actorID, provider); err != nil {
		return nil, err
	}
	reply := &model.CheckProviderResponse{
		ProviderId: provider.Name, Version: provider.Version, ModelId: request.GetModelId(),
		ObservedAt: timestamppb.Now(), LatencyMs: time.Since(started).Milliseconds(),
	}
	if callErr != nil {
		var business *errcode.BizError
		if errors.As(callErr, &business) && business.HTTPStatus == http.StatusConflict {
			return nil, callErr
		}
		reply.FailureCode = providerProbeFailure(callErr, operationCtx.Err())
		return reply, nil
	}
	reply.Connected = result != nil && strings.TrimSpace(result.Content) != ""
	if !reply.Connected {
		reply.FailureCode = "invalid_response"
	}
	return reply, nil
}

func providerProbeFailure(err, deadline error) string {
	if errors.Is(deadline, context.DeadlineExceeded) {
		return "timeout"
	}
	var upstream *ProviderHTTPError
	if errors.As(err, &upstream) {
		switch upstream.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return "authentication"
		case http.StatusTooManyRequests:
			return "rate_limit"
		case http.StatusNotFound:
			return "model_unavailable"
		}
	}
	return "unreachable"
}

func (s *ProviderOperationsService) Discover(
	ctx context.Context, actorID string, request *model.DiscoverProviderModelsRequest,
) (*model.DiscoverProviderModelsResponse, error) {
	provider, err := s.current(ctx, actorID, request.GetProviderId(), request.GetVersion())
	if err != nil {
		return nil, err
	}
	baseURL, apiKey := s.executor.extractConfig(provider.Config, provider.KeyVaults)
	if baseURL == "" {
		baseURL = provider.BaseURL
	}
	models, err := s.discoverHTTP(ctx, provider.Protocol, baseURL, apiKey)
	if err != nil {
		// SDK errors can contain request headers or upstream text. Neither is
		// appropriate for the public error response.
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errcode.New(errcode.AgentProviderFailed, http.StatusBadGateway,
			"model discovery failed", nil)
	}
	if err := s.unchanged(ctx, actorID, provider); err != nil {
		return nil, err
	}
	return &model.DiscoverProviderModelsResponse{
		ProviderId: provider.Name, Version: provider.Version, Models: models,
		ObservedAt: timestamppb.Now(),
	}, nil
}

func providerDiscoveryBase(protocol, raw string) (string, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || base == nil || base.Host == "" || base.User != nil ||
		base.Fragment != "" || base.RawQuery != "" ||
		(base.Scheme != "https" && base.Scheme != "http") {
		return "", errors.New("invalid provider endpoint")
	}
	if protocol == "openai" || protocol == "openai-compatible" || protocol == "ollama" {
		if !apiVersionSuffix.MatchString(base.Path) {
			base.Path += "/v1"
		}
	} else if protocol != "anthropic" {
		return "", errors.New("model discovery is unavailable for this protocol")
	}
	return strings.TrimRight(base.String(), "/") + "/", nil
}

func (s *ProviderOperationsService) discoverHTTP(
	ctx context.Context, protocol, rawURL, apiKey string,
) ([]*model.ProviderModelInfo, error) {
	baseURL, err := providerDiscoveryBase(protocol, rawURL)
	if err != nil {
		return nil, err
	}
	operationCtx, cancel := context.WithTimeout(ctx, providerOperationTimeout)
	defer cancel()
	found := make(map[string]string)
	if protocol == "anthropic" {
		client := anthropic.NewClient(anthropicoption.WithAPIKey(apiKey),
			anthropicoption.WithBaseURL(baseURL), anthropicoption.WithHTTPClient(s.client),
			anthropicoption.WithMaxRetries(0))
		pager := client.Models.ListAutoPaging(operationCtx, anthropic.ModelListParams{})
		for pager.Next() {
			entry := pager.Current()
			found[entry.ID] = entry.DisplayName
			if len(found) > maxDiscoveredModels {
				return nil, errors.New("model discovery limit exceeded")
			}
		}
		if err := pager.Err(); err != nil {
			return nil, err
		}
	} else {
		client := openai.NewClient(openaioption.WithAPIKey(apiKey),
			openaioption.WithBaseURL(baseURL), openaioption.WithHTTPClient(s.client),
			openaioption.WithMaxRetries(0))
		page, err := client.Models.List(operationCtx)
		if err != nil {
			return nil, err
		}
		if len(page.Data) > maxDiscoveredModels {
			return nil, errors.New("model discovery limit exceeded")
		}
		for _, entry := range page.Data {
			found[entry.ID] = entry.ID
		}
	}
	ids := make([]string, 0, len(found))
	for id := range found {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	result := make([]*model.ProviderModelInfo, 0, len(ids))
	for _, id := range ids {
		// Discovery establishes identity only. Context and runtime capability
		// metadata require the existing catalog or an explicit model edit.
		result = append(result, &model.ProviderModelInfo{Id: id, DisplayName: found[id]})
	}
	return result, nil
}
