// Package turn — ICE Server 凭证资源 Store 层。
//
// 提供 ICE Server 凭证的持久化操作，支持多 source 写入/查询/清理。
// 业务方通过 NewICEStore 构造，传入 *gorm.DB 即可使用。
//
// 新增于 Relay 建设阶段：ICE Server 凭证作为可观测、可治理的资源，
// 需要走 Store 层持久化，而非内存缓存。
package turn

import (
	"context"
	"encoding/json"
	"time"

	turnmodel "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/turn/model"
	"gorm.io/gorm"
)

// ICEStore 封装 ICE Server 凭证的数据库操作。
type ICEStore struct {
	db *gorm.DB
}

// NewICEStore 构造 ICE Store 实例。
func NewICEStore(db *gorm.DB) *ICEStore {
	return &ICEStore{db: db}
}

// AutoMigrate 执行 ICE Server 凭证表的自动迁移。
func (s *ICEStore) AutoMigrate() error {
	return s.db.AutoMigrate(&turnmodel.ICEServerCache{})
}

// ----- 写入 -----

// Upsert 写入或更新一条 ICE Server 凭证。
// 以 (source, source_id, urls) 为唯一维度，存在则更新凭证和过期时间。
// 使用 find-then-save 模式，兼容 SQLite 和 PostgreSQL。
func (s *ICEStore) Upsert(ctx context.Context, record *turnmodel.ICEServerCache) error {
	var existing turnmodel.ICEServerCache
	err := s.db.WithContext(ctx).
		Where("source = ? AND source_id = ? AND urls = ?", record.Source, record.SourceID, record.URLs).
		First(&existing).Error

	if err == gorm.ErrRecordNotFound {
		return s.db.WithContext(ctx).Create(record).Error
	}
	if err != nil {
		return err
	}

	// 更新已有记录
	return s.db.WithContext(ctx).Model(&existing).Updates(map[string]interface{}{
		"username":   record.Username,
		"credential": record.Credential,
		"priority":   record.Priority,
		"expires_at": record.ExpiresAt,
	}).Error
}

// BatchUpsert 批量写入 ICE Server 凭证。
func (s *ICEStore) BatchUpsert(ctx context.Context, records []*turnmodel.ICEServerCache) error {
	for _, r := range records {
		if err := s.Upsert(ctx, r); err != nil {
			return err
		}
	}
	return nil
}

// ----- 查询 -----

// ListAll 查询所有未过期的 ICE Server 凭证，按 priority 升序排列。
func (s *ICEStore) ListAll(ctx context.Context) ([]*turnmodel.ICEServerCache, error) {
	var records []*turnmodel.ICEServerCache
	err := s.db.WithContext(ctx).
		Where("expires_at > ?", time.Now()).
		Order("priority ASC, created_at ASC").
		Find(&records).Error
	return records, err
}

// ListBySource 查询指定来源的未过期 ICE Server 凭证。
func (s *ICEStore) ListBySource(ctx context.Context, source string) ([]*turnmodel.ICEServerCache, error) {
	var records []*turnmodel.ICEServerCache
	err := s.db.WithContext(ctx).
		Where("source = ? AND expires_at > ?", source, time.Now()).
		Order("priority ASC, created_at ASC").
		Find(&records).Error
	return records, err
}

// ListBySourceID 查询指定来源标识的未过期 ICE Server 凭证。
func (s *ICEStore) ListBySourceID(ctx context.Context, sourceID string) ([]*turnmodel.ICEServerCache, error) {
	var records []*turnmodel.ICEServerCache
	err := s.db.WithContext(ctx).
		Where("source_id = ? AND expires_at > ?", sourceID, time.Now()).
		Order("priority ASC, created_at ASC").
		Find(&records).Error
	return records, err
}

// ----- 治理 -----

// CleanExpired 清理已过期的凭证记录。返回被清理的行数。
func (s *ICEStore) CleanExpired(ctx context.Context) (int64, error) {
	result := s.db.WithContext(ctx).
		Where("expires_at <= ?", time.Now()).
		Delete(&turnmodel.ICEServerCache{})
	return result.RowsAffected, result.Error
}

// DeleteBySourceID 删除指定来源标识的所有凭证。
// 用于 Station 从 Relay 注销时清理其下发的 ICE Server。
func (s *ICEStore) DeleteBySourceID(ctx context.Context, sourceID string) error {
	return s.db.WithContext(ctx).
		Where("source_id = ?", sourceID).
		Delete(&turnmodel.ICEServerCache{}).Error
}

// ----- 转换 -----

// ToICEServerInfoList 将持久化记录转换为面向端的 DTO 列表。
func ToICEServerInfoList(records []*turnmodel.ICEServerCache) []turnmodel.ICEServerInfo {
	result := make([]turnmodel.ICEServerInfo, 0, len(records))
	for _, r := range records {
		var urls []string
		_ = json.Unmarshal([]byte(r.URLs), &urls)

		result = append(result, turnmodel.ICEServerInfo{
			URLs:       urls,
			Username:   r.Username,
			Credential: r.Credential,
			Source:     r.Source,
			Priority:   r.Priority,
		})
	}
	return result
}
