package aibox

import (
	"context"
	"fmt"

	aiboxpb "github.com/peers-touch/peers-touch/station/app/subserver/ai-box/proto_gen/v1/peers_touch_station/ai_box"
	"gorm.io/gorm"
)

// AiBoxService 实现proto定义的服务接口
type AiBoxService struct {
	aiboxpb.UnimplementedAiBoxServiceServer
	providerService *ProviderService
	db              *gorm.DB
}

// NewAiBoxService 创建AI Box服务
func NewAiBoxService(db *gorm.DB) *AiBoxService {
	return &AiBoxService{
		providerService: NewProviderService(db),
		db:              db,
	}
}

// CreateProvider 创建提供商
func (s *AiBoxService) CreateProvider(ctx context.Context, req *aiboxpb.CreateProviderRequest) (*aiboxpb.CreateProviderResponse, error) {
	provider, err := s.providerService.CreateProvider(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to create provider: %w", err)
	}

	return &aiboxpb.CreateProviderResponse{
		Provider: provider,
	}, nil
}

// UpdateProvider 更新提供商
func (s *AiBoxService) UpdateProvider(ctx context.Context, req *aiboxpb.UpdateProviderRequest) (*aiboxpb.UpdateProviderResponse, error) {
	provider, err := s.providerService.UpdateProvider(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("failed to update provider: %w", err)
	}

	return &aiboxpb.UpdateProviderResponse{
		Provider: provider,
	}, nil
}

// DeleteProvider 删除提供商
func (s *AiBoxService) DeleteProvider(ctx context.Context, req *aiboxpb.DeleteProviderRequest) (*aiboxpb.DeleteProviderResponse, error) {
	err := s.providerService.DeleteProvider(ctx, req.Id)
	if err != nil {
		return nil, fmt.Errorf("failed to delete provider: %w", err)
	}

	return &aiboxpb.DeleteProviderResponse{
		Success: true,
	}, nil
}

// GetProvider 获取提供商
func (s *AiBoxService) GetProvider(ctx context.Context, req *aiboxpb.GetProviderRequest) (*aiboxpb.GetProviderResponse, error) {
	provider, err := s.providerService.GetProvider(ctx, req.Id)
	if err != nil {
		return nil, fmt.Errorf("failed to get provider: %w", err)
	}

	return &aiboxpb.GetProviderResponse{
		Provider: provider,
	}, nil
}

// ListProviders 列出提供商
func (s *AiBoxService) ListProviders(ctx context.Context, req *aiboxpb.ListProvidersRequest) (*aiboxpb.ListProvidersResponse, error) {
	enabledOnly := false
	if req.EnabledOnly != nil {
		enabledOnly = *req.EnabledOnly
	}

	limit := int32(10)
	if req.Limit != nil {
		limit = *req.Limit
	}

	offset := int32(0)
	if req.Offset != nil {
		offset = *req.Offset
	}

	providers, total, err := s.providerService.ListProviders(ctx, offset/limit+1, limit, enabledOnly)
	if err != nil {
		return nil, fmt.Errorf("failed to list providers: %w", err)
	}

	return &aiboxpb.ListProvidersResponse{
		Providers: providers,
		Total:     total,
	}, nil
}

// TestProvider 测试提供商
func (s *AiBoxService) TestProvider(ctx context.Context, req *aiboxpb.TestProviderRequest) (*aiboxpb.TestProviderResponse, error) {
	success, message, err := s.providerService.TestProvider(ctx, req.Id)
	if err != nil {
		return nil, fmt.Errorf("failed to test provider: %w", err)
	}

	return &aiboxpb.TestProviderResponse{
		Success: success,
		Message: message,
	}, nil
}
