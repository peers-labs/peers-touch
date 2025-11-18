package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"time"

	dbModel "github.com/peers-labs/peers-touch/station/app/subserver/ai_box/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/ai_box/model"
	"github.com/peers-labs/peers-touch/station/frame/core/types"
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
func (s *ProviderService) CreateProvider(ctx context.Context, req *model.Provider) (*model.Provider, error) {
	// todo userid
	encryptedKeyVaults, err := encryptKeyVaults(req.KeyVaults)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt key vaults: %w", err)
	}

	provider := &dbModel.Provider{
		ID:          generateProviderID(),
		Name:        req.Name,
		Description: req.Description,
		Logo:        req.Logo,
		Sort:        0,                // 默认排序
		Enabled:     true,             // 默认启用
		CheckModel:  "",               // 默认检测模型
		SourceType:  "",               // 默认源类型
		KeyVaults:   encryptedKeyVaults, // 默认密钥配置
		Settings:    []byte(req.SettingsJson), // 默认设置
		Config:      []byte(req.ConfigJson),   // 默认配置
		AccessedAt:  time.Now(),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.db.Create(provider).Error; err != nil {
		return nil, fmt.Errorf("failed to create provider: %w", err)
	}

	// todo 暂时原样返回
	return req, nil
}

// UpdateProvider 更新提供商
func (s *ProviderService) UpdateProvider(ctx context.Context, req *model.Provider) (*model.Provider, error) {
	// todo userid

	var provider model.Provider
	if err := s.db.Where("id = ?", req.Id).First(&provider).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("provider not found")
		}
		return nil, fmt.Errorf("failed to find provider: %w", err)
	}

	// 更新字段
	if req.Name != "" {
		provider.Name = req.Name
	}

	if req.KeyVaults != "" {
		encryptedKeyVaults, err := encryptKeyVaults(req.KeyVaults)
		if err != nil {
			return nil, fmt.Errorf("failed to encrypt key vaults: %w", err)
		}
		provider.KeyVaults = encryptedKeyVaults
	}

	if err := s.db.Save(&provider).Error; err != nil {
		return nil, fmt.Errorf("failed to update provider: %w", err)
	}

	log.Printf("After update - Provider %s config: %s", req.Id, provider.Config)

	return req, nil
}

// DeleteProvider 删除提供商
func (s *ProviderService) DeleteProvider(ctx context.Context, providerID string) error {
	// TODO: get user id
	userID := ""
	if userID == "" {
		return fmt.Errorf("user ID not found in context")
	}

	result := s.db.Where("id = ? AND peers_user_id = ?", providerID, userID).Delete(&model.Provider{})
	if result.Error != nil {
		return fmt.Errorf("failed to delete provider: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("provider not found")
	}

	return nil
}

// GetProvider 获取提供商
func (s *ProviderService) GetProvider(ctx context.Context, providerID string) (*model.Provider, error) {
	// TODO: get user id
	userID := ""
	if userID == "" {
		return nil, fmt.Errorf("user ID not found in context")
	}

	var provider model.Provider
	if err := s.db.Where("id = ? AND peers_user_id = ?", providerID, userID).First(&provider).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("provider not found")
		}
		return nil, fmt.Errorf("failed to get provider: %w", err)
	}

	decryptedKeyVaults, err := decryptKeyVaults(provider.KeyVaults)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt key vaults: %w", err)
	}
	provider.KeyVaults = decryptedKeyVaults

	return s.convertToProto(&provider), nil

// ListProviders 列出提供商
func (s *ProviderService) ListProviders(ctx context.Context, query types.PageQuery, enabledOnly bool) (*types.PageData, error) {
	// TODO: get user id
	userID := ""
	if userID == "" {
		return nil, fmt.Errorf("user ID not found in context")
	}

	var providers []*model.Provider

	dbQuery := s.db.Where("peers_user_id = ?", userID)
	if enabledOnly {
		dbQuery = dbQuery.Where("enabled = ?", true)
	}

	// 获取总数
	var total64 int64
	if err := dbQuery.Model(&model.Provider{}).Count(&total64).Error; err != nil {
		return nil, fmt.Errorf("failed to count providers: %w", err)
	}

	// 获取分页数据
	offset := (query.PageNumber - 1) * query.PageSize
	if err := dbQuery.Limit(int(query.PageSize)).Offset(int(offset)).Find(&providers).Error; err != nil {
		return nil, fmt.Errorf("failed to list providers: %w", err)
	}

	// 转换为req provider
	protoProviders := make([]interface{}, len(providers))
	for i, p := range providers {
		protoProviders[i] = s.convertToProto(p)
	}

	return &types.PageData{
		Total: total64,
		List:  protoProviders,
	}, nil
}

func (s *ProviderService) convertToProto(provider *dbModel.Provider) *model.Provider {
	return &model.Provider{
		Id:          provider.ID,
		Name:        provider.Name,
		PeersUserId: provider.PeersUserID,
		Sort:        int32(provider.Sort),
		Enabled:     provider.Enabled,
		CheckModel:  provider.CheckModel,
		Logo:        provider.Logo,
		Description: provider.Description,
		KeyVaults:   provider.KeyVaults,
		SourceType:  provider.SourceType,
		SettingsJson: string(provider.Settings),
		ConfigJson:   string(provider.Config),
		AccessedAt:  provider.AccessedAt.Unix(),
		CreatedAt:   provider.CreatedAt.Unix(),
		UpdatedAt:   provider.UpdatedAt.Unix(),
	}
}

// generateProviderID 生成提供商ID
func generateProviderID() string {
	return fmt.Sprintf("provider_%d", time.Now().UnixNano())
}

// TODO: 实现实际的加密逻辑
func encryptKeyVaults(plainText string) (string, error) {
	return base64.StdEncoding.EncodeToString([]byte(plainText)), nil
}

// TODO: 实现实际的解密逻辑
func decryptKeyVaults(cipherText string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(cipherText)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
