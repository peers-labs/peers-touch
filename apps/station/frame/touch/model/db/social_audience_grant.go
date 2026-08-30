package db

import "time"

// AudienceGrantRoleAllow / AudienceGrantRoleDeny enumerate the roles a row in
// `social_private_audience_grants` may take. Stored as `varchar(8)` to keep
// the table SQLite-friendly (no enums).
const (
	AudienceGrantRoleAllow = "allow"
	AudienceGrantRoleDeny  = "deny"
)

// SocialPrivateAudienceGrant materializes the actor list attached to a
// `CUSTOM_ALLOW` or `CUSTOM_DENY` Audience on a private post. `Role` says
// whether the listed actor is included or excluded; for any single post all
// rows share the same role (mixing allow + deny on one post is rejected by
// `audience.ValidateAudience`).
//
// Composite primary key `(post_id, actor_ptid)` makes "is actor X granted on
// post Y" a point lookup, which is what the privateRepo's CanRead-fast-path
// SQL filter does. The outer `social_private_posts` row's `audience_kind`
// column is the source of truth for the grant role; the redundant `Role`
// column on this table makes admin / debugging queries easier.
//
// Lifecycle: rows are written in the same TX as the parent post (see
// MomentService.Create) and deleted via `DeleteGrants(post_id)` in the same
// TX as `Delete(post)` (see MomentService.Delete).
type SocialPrivateAudienceGrant struct {
	PostID    uint64    `gorm:"column:post_id;primaryKey;autoIncrement:false"`
	ActorPtid string    `gorm:"column:actor_ptid;primaryKey;size:128"`
	Role      string    `gorm:"column:role;type:varchar(8);not null"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (SocialPrivateAudienceGrant) TableName() string { return "social_private_audience_grants" }
