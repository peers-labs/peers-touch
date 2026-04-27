package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// SocialPublicPost stores Moments whose `audience.kind == PUBLIC`.
//
// Lives on its own physical table (`social_public_posts`) per
// `docs/architecture/social/moments.md §6` — the only writers are the
// PublicPostRepository in social subserver, the only readers are the public
// timeline, the public outbox dispatcher (P3+, AP-bound), and the dashboard
// audit views. SQL constructed against this table never sees a viewer's
// identity because PUBLIC content needs no per-viewer filtering.
type SocialPublicPost struct {
	ID       uint64 `gorm:"column:id;primaryKey;autoIncrement:false"`
	AuthorID uint64 `gorm:"column:author_id;index:idx_spub_author_created;not null"`

	// Post type: matches proto `PostType` enum string form
	// ("TEXT" / "IMAGE" / "VIDEO" / "LINK" / "REPOST"). Indexed because
	// public timelines may filter by media kind.
	Type string `gorm:"column:type;type:varchar(20);not null;index:idx_spub_type"`

	// AudienceKind is denormalized from `Audience.Kind`. Always "PUBLIC"
	// for rows in this table; checked by repo invariant. Kept as a column
	// (instead of being implicit) to keep DBToProto symmetric with the
	// private-post table and to support cross-table UNION-style admin
	// queries that need to know the audience without joining.
	AudienceKind string `gorm:"column:audience_kind;type:varchar(16);not null;default:'PUBLIC'"`

	// Body fields. Text-only posts use TextBody only; richer posts add
	// JSON-encoded payloads. Stored as `text` columns (not `jsonb`) for
	// SQLite compatibility — D1.A constraint.
	TextBody         string `gorm:"column:text_body;type:text"`
	AttachmentsJSON  string `gorm:"column:attachments_json;type:text"`
	MentionsJSON     string `gorm:"column:mentions_json;type:text"`
	LinkPreviewJSON  string `gorm:"column:link_preview_json;type:text"`
	ReactionsCountJSON string `gorm:"column:reactions_count_json;type:text"`

	// RepostOfRef is `oss://{station}/post/{id}` form so cross-station
	// reposts can be represented (P5+ federation). Same-station reposts
	// store the raw id with no scheme prefix.
	RepostOfRef string `gorm:"column:repost_of_ref;type:varchar(255);index:idx_spub_repost"`

	CommentsCount int64 `gorm:"column:comments_count;default:0"`
	ViewsCount    int64 `gorm:"column:views_count;default:0"`

	EditedAt  *time.Time `gorm:"column:edited_at"`
	CreatedAt time.Time  `gorm:"column:created_at;index:idx_spub_author_created;index:idx_spub_created"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`
	DeletedAt *time.Time `gorm:"column:deleted_at;index"`
}

func (SocialPublicPost) TableName() string { return "social_public_posts" }

func (p *SocialPublicPost) BeforeCreate(tx *gorm.DB) error {
	if p.ID == 0 {
		p.ID = id.NextID()
	}
	return nil
}

// SocialPrivatePost stores Moments whose `audience.kind != PUBLIC`
// (FOLLOWERS / SELF / CIRCLE / GROUP / CUSTOM_ALLOW / CUSTOM_DENY).
//
// SQL paths against this table always require a viewerID — the
// PrivatePostRepository interface enforces this at the type level. The
// `audience_target_id` / `audience_base_kind` columns are populated for
// CIRCLE/GROUP/CUSTOM_* respectively; FOLLOWERS / SELF leave them zero.
type SocialPrivatePost struct {
	ID       uint64 `gorm:"column:id;primaryKey;autoIncrement:false"`
	AuthorID uint64 `gorm:"column:author_id;index:idx_spri_author_created;not null"`

	Type string `gorm:"column:type;type:varchar(20);not null;index:idx_spri_type"`

	// AudienceKind ∈ {"FOLLOWERS","SELF","CIRCLE","GROUP","CUSTOM_ALLOW","CUSTOM_DENY"}.
	// Repo invariant rejects "PUBLIC" on insert.
	AudienceKind string `gorm:"column:audience_kind;type:varchar(16);not null;index:idx_spri_audience"`

	// AudienceTargetID stores the circle_id (CIRCLE) or group_id (GROUP).
	// Zero for FOLLOWERS / SELF / CUSTOM_*.
	AudienceTargetID uint64 `gorm:"column:audience_target_id;default:0;index:idx_spri_target"`

	// AudienceBaseKind is the underlying base audience that CUSTOM_*
	// narrows. e.g. "FOLLOWERS" for `CUSTOM_DENY` excluding people from
	// the followers feed; "PUBLIC" for `CUSTOM_DENY` excluding people
	// from a notional public post (which is then stored privately because
	// the deny list makes it not-public). Empty for non-CUSTOM_*.
	AudienceBaseKind string `gorm:"column:audience_base_kind;type:varchar(16)"`

	TextBody         string `gorm:"column:text_body;type:text"`
	AttachmentsJSON  string `gorm:"column:attachments_json;type:text"`
	MentionsJSON     string `gorm:"column:mentions_json;type:text"`
	LinkPreviewJSON  string `gorm:"column:link_preview_json;type:text"`
	ReactionsCountJSON string `gorm:"column:reactions_count_json;type:text"`

	RepostOfRef string `gorm:"column:repost_of_ref;type:varchar(255);index:idx_spri_repost"`

	CommentsCount int64 `gorm:"column:comments_count;default:0"`
	ViewsCount    int64 `gorm:"column:views_count;default:0"`

	EditedAt  *time.Time `gorm:"column:edited_at"`
	CreatedAt time.Time  `gorm:"column:created_at;index:idx_spri_author_created;index:idx_spri_created"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`
	DeletedAt *time.Time `gorm:"column:deleted_at;index"`
}

func (SocialPrivatePost) TableName() string { return "social_private_posts" }

func (p *SocialPrivatePost) BeforeCreate(tx *gorm.DB) error {
	if p.ID == 0 {
		p.ID = id.NextID()
	}
	return nil
}
