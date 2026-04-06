// Package model defines ICE Server persistence models.
//
// ICE Server 凭证是跨领域的资源，可能来自多个 source：
// - station: 本地 TURN SubServer 生成的凭证
// - relay:   Relay Station 注册时下发的 TURN 凭证
// - public:  公共 STUN/TURN 服务
//
// 通过 Store 层持久化，支持可观测、可治理（过期清理等）。
package model

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// ICEServerCache 持久化 ICE Server 凭证资源。
// 每条记录代表一组可用的 STUN/TURN 服务器地址及其凭证。
type ICEServerCache struct {
	ID         uint64    `gorm:"primaryKey;type:bigint;autoIncrement:false;comment:snowflake id"`
	URLs       string    `gorm:"size:1024;comment:JSON array of server URLs"`
	Username   string    `gorm:"size:255"`
	Credential string    `gorm:"size:512"`
	Source     string    `gorm:"size:32;index;comment:origin source: station / relay / public"`
	SourceID   string    `gorm:"size:255;index;comment:source identifier, e.g. relay station peer id"`
	Priority   int       `gorm:"default:0;comment:lower value = higher priority"`
	ExpiresAt  time.Time `gorm:"index;comment:credential expiration time"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
	UpdatedAt  time.Time `gorm:"autoUpdateTime"`
}

func (*ICEServerCache) TableName() string {
	return "ice_server_cache"
}

func (c *ICEServerCache) BeforeCreate(tx *gorm.DB) error {
	if c.ID == 0 {
		c.ID = id.NextID()
	}
	return nil
}

// ICEServerInfo 是面向端的 ICE Server 配置 DTO。
// 用于 API 响应，不入库。
type ICEServerInfo struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
	Source     string   `json:"source"`
	Priority   int      `json:"priority"`
}
