package db

import (
	"time"
)

type Post struct {
	ID         uint64     `gorm:"column:id;primaryKey;autoIncrement:false"`
	AuthorID   uint64     `gorm:"column:author_id;index:idx_author_created;not null"`
	Type       string     `gorm:"column:type;type:varchar(20);not null;index:idx_type"`
	Visibility string     `gorm:"column:visibility;type:varchar(20);default:'public';index"`
	CreatedAt  time.Time  `gorm:"column:created_at;index:idx_author_created;index:idx_created"`
	UpdatedAt  time.Time  `gorm:"column:updated_at"`
	DeletedAt  *time.Time `gorm:"column:deleted_at;index"`

	LikesCount    int64 `gorm:"column:likes_count;default:0;index:idx_likes"`
	CommentsCount int64 `gorm:"column:comments_count;default:0"`
	RepostsCount  int64 `gorm:"column:reposts_count;default:0"`
	ViewsCount    int64 `gorm:"column:views_count;default:0"`

	Author  *Actor       `gorm:"foreignKey:AuthorID"`
	Content *PostContent `gorm:"foreignKey:PostID;constraint:OnDelete:CASCADE"`
}

func (Post) TableName() string {
	return "touch_posts"
}

type PostContent struct {
	PostID uint64 `gorm:"column:post_id;primaryKey;autoIncrement:false"`

	Text     string `gorm:"column:text;type:text"`
	Hashtags string `gorm:"column:hashtags;type:text"`
	Mentions string `gorm:"column:mentions;type:text"`

	Images   string `gorm:"column:images;type:text"`
	Video    string `gorm:"column:video;type:text"`
	Link     string `gorm:"column:link;type:text"`
	Poll     string `gorm:"column:poll;type:text"`
	Location string `gorm:"column:location;type:text"`

	OriginalPostID *uint64 `gorm:"column:original_post_id;index:idx_original_post"`
	RepostComment  string  `gorm:"column:repost_comment;type:text"`

	Post *Post `gorm:"foreignKey:PostID"`
}

func (PostContent) TableName() string {
	return "touch_post_contents"
}

type PostMedia struct {
	ID           uint64    `gorm:"column:id;primaryKey;autoIncrement:false"`
	UserID       uint64    `gorm:"column:user_id;index:idx_user_created;not null"`
	Type         string    `gorm:"column:type;type:varchar(20);not null"`
	URL          string    `gorm:"column:url;type:varchar(500);not null"`
	ThumbnailURL string    `gorm:"column:thumbnail_url;type:varchar(500)"`
	SizeBytes    int64     `gorm:"column:size_bytes;default:0"`
	Width        int32     `gorm:"column:width;default:0"`
	Height       int32     `gorm:"column:height;default:0"`
	DurationSecs int32     `gorm:"column:duration_secs;default:0"`
	Blurhash     string    `gorm:"column:blurhash;type:varchar(100)"`
	AltText      string    `gorm:"column:alt_text;type:varchar(500)"`
	Status       string    `gorm:"column:status;type:varchar(20);default:'pending';index:idx_status"`
	CreatedAt    time.Time `gorm:"column:created_at;index:idx_user_created"`
}

func (PostMedia) TableName() string {
	return "touch_media"
}

type PostLike struct {
	ID        uint64    `gorm:"column:id;primaryKey;autoIncrement:false"`
	UserID    uint64    `gorm:"column:user_id;uniqueIndex:idx_user_post;index:idx_user;not null"`
	PostID    uint64    `gorm:"column:post_id;uniqueIndex:idx_user_post;index:idx_post_created;not null"`
	CreatedAt time.Time `gorm:"column:created_at;index:idx_post_created"`

	User *Actor `gorm:"foreignKey:UserID"`
	Post *Post  `gorm:"foreignKey:PostID"`
}

func (PostLike) TableName() string {
	return "touch_post_likes"
}

type Comment struct {
	ID               uint64     `gorm:"column:id;primaryKey;autoIncrement:false"`
	PostID           uint64     `gorm:"column:post_id;index:idx_post_created;not null"`
	AuthorID         uint64     `gorm:"column:author_id;index:idx_author;not null"`
	Content          string     `gorm:"column:content;type:text;not null"`
	CreatedAt        time.Time  `gorm:"column:created_at;index:idx_post_created"`
	UpdatedAt        time.Time  `gorm:"column:updated_at"`
	DeletedAt        *time.Time `gorm:"column:deleted_at;index"`

	LikesCount   int64 `gorm:"column:likes_count;default:0"`
	RepliesCount int64 `gorm:"column:replies_count;default:0"`

	ReplyToCommentID *uint64 `gorm:"column:reply_to_comment_id;index:idx_reply_to"`

	Author *Actor `gorm:"foreignKey:AuthorID"`
	Post   *Post  `gorm:"foreignKey:PostID"`
}

func (Comment) TableName() string {
	return "touch_comments"
}

type CommentLike struct {
	ID        uint64    `gorm:"column:id;primaryKey;autoIncrement:false"`
	UserID    uint64    `gorm:"column:user_id;uniqueIndex:idx_user_comment;not null"`
	CommentID uint64    `gorm:"column:comment_id;uniqueIndex:idx_user_comment;index:idx_comment;not null"`
	CreatedAt time.Time `gorm:"column:created_at"`

	User    *Actor   `gorm:"foreignKey:UserID"`
	Comment *Comment `gorm:"foreignKey:CommentID"`
}

func (CommentLike) TableName() string {
	return "touch_comment_likes"
}

type Follow struct {
	ID          uint64    `gorm:"column:id;primaryKey;autoIncrement:false"`
	FollowerID  uint64    `gorm:"column:follower_id;uniqueIndex:idx_follower_following;index:idx_follower;not null"`
	FollowingID uint64    `gorm:"column:following_id;uniqueIndex:idx_follower_following;index:idx_following;not null"`
	CreatedAt   time.Time `gorm:"column:created_at;index"`

	Follower  *Actor `gorm:"foreignKey:FollowerID"`
	Following *Actor `gorm:"foreignKey:FollowingID"`
}

func (Follow) TableName() string {
	return "follows"
}

type PollVote struct {
	ID            uint64    `gorm:"column:id;primaryKey;autoIncrement:false"`
	PostID        uint64    `gorm:"column:post_id;uniqueIndex:idx_user_post;index:idx_post;not null"`
	UserID        uint64    `gorm:"column:user_id;uniqueIndex:idx_user_post;index:idx_user;not null"`
	OptionIndices string    `gorm:"column:option_indices;type:varchar(100);not null"`
	CreatedAt     time.Time `gorm:"column:created_at"`

	Post *Post  `gorm:"foreignKey:PostID"`
	User *Actor `gorm:"foreignKey:UserID"`
}

func (PollVote) TableName() string {
	return "touch_poll_votes"
}
