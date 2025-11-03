package service

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-touch/peers-touch/station/app/subserver/ai-box/db/models"
	aiboxpb "github.com/peers-touch/peers-touch/station/app/subserver/ai-box/proto_gen/v1/peers_touch_station/ai_box"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// ProviderService 提供商服务
type ProviderService struct {
	db *gorm.DB
}

// NewProviderService 创建提供商服务
func NewProviderService(db *gorm.DB) *ProviderService {
	return &ProviderService{db: db}
}

// CreateProvider 创建提供商
func (s *ProviderService) CreateProvider(ctx context.Context, req *aiboxpb.CreateProviderRequest) (*aiboxpb.AiProvider, error) {
	// 获取用户ID (从context中获取)
	userID := getUserIDFromContext(ctx)
	if userID == "" {
		return nil, fmt.Errorf("user ID not found in context")
	}

	provider := &models.Provider{
		ID:          generateProviderID(),
		Name:        req.Name,
		PeersUserID: userID,
		Description: req.Description,
		Logo:        req.Logo,
		Sort:        0,    // 默认排序
		Enabled:     true, // 默认启用
		CheckModel:  "",   // 默认检测模型
		SourceType:  "",   // 默认源类型
		KeyVaults:   "",   // 默认密钥配置
		Settings:    "{}", // 默认设置
		Config:      "{}", // 默认配置
		AccessedAt:  time.Now(),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.db.Create(provider).Error; err != nil {
		return nil, fmt.Errorf("failed to create provider: %w", err)
	}

	return s.convertToProto(provider), nil
}

// UpdateProvider 更新提供商
func (s *ProviderService) UpdateProvider(ctx context.Context, req *aiboxpb.UpdateProviderRequest) (*aiboxpb.AiProvider, error) {
	userID := getUserIDFromContext(ctx)
	if userID == "" {
		return nil, fmt.Errorf("user ID not found in context")
	}

	var provider models.Provider
	if err := s.db.Where("id = ? AND peers_user_id = ?", req.Id, userID).First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("provider not found")
		}
		return nil, fmt.Errorf("failed to find provider: %w", err)
	}

	// 更新字段
	if req.DisplayName != nil {
		provider.Name = *req.DisplayName
	}
	if req.Description != nil {
		provider.Description = *req.Description
	}
	if req.Logo != nil {
		provider.Logo = *req.Logo
	}
	if req.Enabled != nil {
		provider.Enabled = *req.Enabled
	}
	provider.UpdatedAt = time.Now()

	if err := s.db.Save(&provider).Error; err != nil {
		return nil, fmt.Errorf("failed to update provider: %w", err)
	}

	return s.convertToProto(&provider), nil
}

// DeleteProvider 删除提供商
func (s *ProviderService) DeleteProvider(ctx context.Context, providerID string) error {
	userID := getUserIDFromContext(ctx)
	if userID == "" {
		return fmt.Errorf("user ID not found in context")
	}

	result := s.db.Where("id = ? AND peers_user_id = ?", providerID, userID).Delete(&models.Provider{})
	if result.Error != nil {
		return fmt.Errorf("failed to delete provider: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("provider not found")
	}

	return nil
}

// GetProvider 获取提供商
func (s *ProviderService) GetProvider(ctx context.Context, providerID string) (*aiboxpb.AiProvider, error) {
	userID := getUserIDFromContext(ctx)
	if userID == "" {
		return nil, fmt.Errorf("user ID not found in context")
	}

	var provider models.Provider
	if err := s.db.Where("id = ? AND peers_user_id = ?", providerID, userID).First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("provider not found")
		}
		return nil, fmt.Errorf("failed to get provider: %w", err)
	}

	return s.convertToProto(&provider), nil
}

// ListProviders 列出提供商
func (s *ProviderService) ListProviders(ctx context.Context, page, pageSize int32, enabledOnly bool) ([]*aiboxpb.AiProvider, int32, error) {
	userID := getUserIDFromContext(ctx)
	if userID == "" {
		return nil, 0, fmt.Errorf("user ID not found in context")
	}

	var providers []*models.Provider
	var total int32

	query := s.db.Where("peers_user_id = ?", userID)
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}

	// 获取总数
	var total64 int64
	if err := query.Model(&models.Provider{}).Count(&total64).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count providers: %w", err)
	}
	total = int32(total64)

	// 获取分页数据
	offset := (page - 1) * pageSize
	if err := query.Limit(int(pageSize)).Offset(int(offset)).Find(&providers).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to list providers: %w", err)
	}

	// 转换为proto
	protoProviders := make([]*aiboxpb.AiProvider, len(providers))
	for i, provider := range providers {
		protoProviders[i] = s.convertToProto(provider)
	}

	return protoProviders, total, nil
}

// TestProvider 测试提供商连接
func (s *ProviderService) TestProvider(ctx context.Context, providerID string) (bool, string, error) {
	provider, err := s.GetProvider(ctx, providerID)
	if err != nil {
		return false, "", err
	}

	// 这里可以添加实际的连接测试逻辑
	// 例如调用提供商的API进行测试
	switch provider.Name {
	case "openai":
		return testOpenAIConnection(provider)
	case "anthropic":
		return testAnthropicConnection(provider)
	case "ollama":
		return testOllamaConnection(provider)
	default:
		return false, "Provider type not implemented for testing", nil
	}
}

// convertToProto 转换为proto格式
func (s *ProviderService) convertToProto(provider *models.Provider) *aiboxpb.AiProvider {
	return &aiboxpb.AiProvider{
		Id:          provider.ID,
		Name:        provider.Name,
		DisplayName: provider.Name, // 使用name作为displayName
		Enabled:     provider.Enabled,
		Description: provider.Description,
		Logo:        provider.Logo,
		Sort:        int32(provider.Sort),
		Config: &aiboxpb.ProviderConfig{
			ApiKey:     "", // 不返回API密钥
			Endpoint:   "",
			ProxyUrl:   "",
			Timeout:    30,
			MaxRetries: 3,
		},
		CreatedAt: timestamppb.New(provider.CreatedAt),
		UpdatedAt: timestamppb.New(provider.UpdatedAt),
	}
}

// generateProviderID 生成提供商ID
func generateProviderID() string {
	return fmt.Sprintf("provider_%d", time.Now().UnixNano())
}

// getUserIDFromContext 从context获取用户ID
func getUserIDFromContext(ctx context.Context) string {
	// 这里应该从context中获取用户ID
	// 暂时返回默认值，实际实现需要从context中提取
	return "default_user"
}

// 测试函数实现
func testOpenAIConnection(provider *aiboxpb.AiProvider) (bool, string, error) {
	// 实现OpenAI连接测试逻辑
	return true, "OpenAI connection test not implemented", nil
}

func testAnthropicConnection(provider *aiboxpb.AiProvider) (bool, string, error) {
	// 实现Anthropic连接测试逻辑
	return true, "Anthropic connection test not implemented", nil
}

func testOllamaConnection(provider *aiboxpb.AiProvider) (bool, string, error) {
	// 实现Ollama连接测试逻辑
	return true, "Ollama connection test not implemented", nil
}
