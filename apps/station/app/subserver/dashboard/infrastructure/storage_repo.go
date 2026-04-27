// Package infrastructure — StorageRepository exposes read-only database
// metadata used by the dashboard "Storage" page.
//
// The dashboard MUST report real numbers only. We therefore:
//  1. Read driver/dialect from the live *gorm.DB (no hardcoded strings).
//  2. Read connection pool stats from the underlying *sql.DB.
//  3. Issue COUNT(*) per known table; tables that don't exist in this
//     deployment are simply omitted instead of being reported as 0
//     (which would lie about them existing).
//
// Created: 2026-04-21 — replaces the placeholder Storage page.
package infrastructure

import (
	"context"
	"database/sql"
	"sort"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
)

// StorageRepository surfaces database metadata for the Storage page.
type StorageRepository interface {
	Driver() string
	PoolStats() *sql.DBStats
	TableCounts(ctx context.Context) ([]domain.StorageTableCount, error)
}

type storageRepository struct {
	db *gorm.DB
}

// NewStorageRepository constructs a GORM-backed StorageRepository.
func NewStorageRepository(db *gorm.DB) StorageRepository {
	return &storageRepository{db: db}
}

// Driver returns the GORM dialector name (e.g. "sqlite", "postgres").
func (r *storageRepository) Driver() string {
	if r.db == nil || r.db.Dialector == nil {
		return ""
	}
	return r.db.Dialector.Name()
}

// PoolStats returns the underlying sql.DBStats snapshot. Returns nil when
// the dialector does not expose a *sql.DB (defensive — should not happen
// with the supported drivers).
func (r *storageRepository) PoolStats() *sql.DBStats {
	if r.db == nil {
		return nil
	}
	sqlDB, err := r.db.DB()
	if err != nil || sqlDB == nil {
		return nil
	}
	stats := sqlDB.Stats()
	return &stats
}

// knownTables enumerates the tables that *can* exist for a Peers-Touch
// station. The list is curated rather than discovered via information_schema
// to keep the cross-driver contract simple and to label tables with the
// human-friendly group used in the UI.
//
// Tables that are absent from the schema (e.g. friend_chat tables when the
// chat subserver is disabled) are silently skipped.
var knownTables = []domain.StorageTableCount{
	{Group: "Identity", Table: "touch_actor"},
	{Group: "Identity", Table: "actor_status"},
	{Group: "Identity", Table: "actor_touch_meta"},
	{Group: "Identity", Table: "actor_mastodon"},
	{Group: "Identity", Table: "actor_sessions"},
	{Group: "Social", Table: "touch_posts"},
	{Group: "Social", Table: "touch_post_contents"},
	{Group: "Social", Table: "touch_media"},
	{Group: "Social", Table: "touch_post_likes"},
	{Group: "Social", Table: "touch_comments"},
	{Group: "Social", Table: "touch_comment_likes"},
	{Group: "Social", Table: "follows"},
	{Group: "Social", Table: "touch_poll_votes"},
	{Group: "Chat", Table: "touch_conversations"},
	{Group: "Chat", Table: "touch_conv_members"},
	{Group: "Chat", Table: "touch_messages"},
	{Group: "Chat", Table: "touch_attachments"},
	{Group: "Chat", Table: "touch_receipts"},
	{Group: "Chat", Table: "touch_reactions"},
	{Group: "Chat", Table: "touch_key_epochs"},
	{Group: "Friend Chat", Table: "friend_chat_sessions"},
	{Group: "Friend Chat", Table: "friend_chat_messages"},
	{Group: "Friend Chat", Table: "friend_chat_friend_requests"},
	{Group: "Friend Chat", Table: "friend_chat_outbox"},
	{Group: "Friend Chat", Table: "friend_chat_attachments"},
	{Group: "Network", Table: "touch_peer"},
	{Group: "Network", Table: "touch_peer_address"},
	{Group: "OAuth", Table: "oauth_clients"},
	{Group: "OAuth", Table: "oauth_auth_codes"},
	{Group: "OAuth", Table: "oauth_tokens"},
	{Group: "OAuth", Table: "oauth2_identity_bindings"},
	{Group: "OAuth", Table: "oauth2_token_states"},
	{Group: "OAuth", Table: "oauth2_connection_states"},
	{Group: "Dashboard", Table: "dashboard_admins"},
	{Group: "Dashboard", Table: "dashboard_sessions"},
	{Group: "Dashboard", Table: "dashboard_audit_logs"},
	{Group: "OSS", Table: "oss_buckets"},
	{Group: "OSS", Table: "oss_files"},
	{Group: "OSS", Table: "oss_audit"},
	{Group: "OSS", Table: "oss_peer_keys"},
	{Group: "OSS", Table: "oss_meta"},
}

// TableCounts issues a COUNT(*) for every known table that exists in the
// active schema. Missing tables are silently dropped so the UI never
// reports rows for tables that don't physically exist.
func (r *storageRepository) TableCounts(ctx context.Context) ([]domain.StorageTableCount, error) {
	if r.db == nil {
		return nil, nil
	}

	migrator := r.db.Migrator()
	out := make([]domain.StorageTableCount, 0, len(knownTables))

	for _, t := range knownTables {
		if !migrator.HasTable(t.Table) {
			continue
		}
		var c int64
		if err := r.db.WithContext(ctx).Table(t.Table).Count(&c).Error; err != nil {
			// Don't fail the whole page for one bad table — record -1 so
			// the UI can flag it instead of silently lying.
			out = append(out, domain.StorageTableCount{
				Group: t.Group,
				Table: t.Table,
				Rows:  -1,
				Error: err.Error(),
			})
			continue
		}
		out = append(out, domain.StorageTableCount{
			Group: t.Group,
			Table: t.Table,
			Rows:  c,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Group != out[j].Group {
			return out[i].Group < out[j].Group
		}
		return out[i].Table < out[j].Table
	})

	return out, nil
}
