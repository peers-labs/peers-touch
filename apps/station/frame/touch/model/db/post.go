package db

import (
	"time"
)

type Post struct {
	ID         uint64     `gorm:"primaryKey;autoIncrement:false"`
	AuthorID   uint64     `gorm:"index:idx_author_created;not null"`
	Type       string     `gorm:"type:varchar(20);not null;index:idx_type"`
	Visibility string     `gorm:"type:varchar(20);default:'public';index"`
	CreatedAt  time.Time  `gorm:"index:idx_author_created;index:idx_created"`
	UpdatedAt  time.Time
	DeletedAt  *time.Time `gorm:"index"`
	
	LikesCount    int64 `gorm:"default:0;index:idx_likes"`
	CommentsCount int64 `gorm:"default:0"`
	RepostsCount  int64 `gorm:"default:0"`
	ViewsCount    int64 `gorm:"default:0"`
	
	Author  *Actor       `gorm:"foreignKey:AuthorID"`
	Content *PostContent `gorm:"foreignKey:PostID;constraint:OnDelete:CASCADE"`
}

func (Post) TableName() string {
	return "touch_posts"
}

type PostContent struct {
	PostID uint64 `gorm:"primaryKey;autoIncrement:false"`
	
	Text     string `gorm:"type:text"`
	Hashtags string `gorm:"type:text"`
	Mentions string `gorm:"type:text"`
	
	Images   string `gorm:"type:text"`
	Video    string `gorm:"type:text"`
	Link     string `gorm:"type:text"`
	Poll     string `gorm:"type:text"`
	Location string `gorm:"type:text"`
	
	OriginalPostID *uint64 `gorm:"index:idx_original_post"`
	RepostComment  string  `gorm:"type:text"`
	
	Post *Post `gorm:"foreignKey:PostID"`
}

func (PostContent) TableName() string {
	return "touch_post_contents"
}

type PostMedia struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement:false"`
	UserID       uint64    `gorm:"index:idx_user_created;not null"`
	Type         string    `gorm:"type:varchar(20);not null"`
	URL          string    `gorm:"type:varchar(500);not null"`
	ThumbnailURL string    `gorm:"type:varchar(500)"`
	SizeBytes    int64     `gorm:"default:0"`
	Width        int32     `gorm:"default:0"`
	Height       int32     `gorm:"default:0"`
	DurationSecs int32     `gorm:"default:0"`
	Blurhash     string    `gorm:"type:varchar(100)"`
	AltText      string    `gorm:"type:varchar(500)"`
	Status       string    `gorm:"type:varchar(20);default:'pending';index:idx_status"`
	CreatedAt    time.Time `gorm:"index:idx_user_created"`
}

func (PostMedia) TableName() string {
	return "touch_media"
}

type PostLike struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement:false"`
	UserID    uint64    `gorm:"uniqueIndex:idx_user_post;index:idx_user;not null"`
	PostID    uint64    `gorm:"uniqueIndex:idx_user_post;index:idx_post_created;not null"`
	CreatedAt time.Time `gorm:"index:idx_post_created"`
	
	User *Actor `gorm:"foreignKey:UserID"`
	Post *Post  `gorm:"foreignKey:PostID"`
}

func (PostLike) TableName() string {
	return "touch_post_likes"
}

type Comment struct {
	ID               uint64     `gorm:"primaryKey;autoIncrement:false"`
	PostID           uint64     `gorm:"index:idx_post_created;not null"`
	AuthorID         uint64     `gorm:"index:idx_author;not null"`
	Content          string     `gorm:"type:text;not null"`
	CreatedAt        time.Time  `gorm:"index:idx_post_created"`
	UpdatedAt        time.Time
	DeletedAt        *time.Time `gorm:"index"`
	
	LikesCount   int64 `gorm:"default:0"`
	RepliesCount int64 `gorm:"default:0"`
	
	ReplyToCommentID *uint64 `gorm:"index:idx_reply_to"`
	
	Author *Actor `gorm:"foreignKey:AuthorID"`
	Post   *Post  `gorm:"foreignKey:PostID"`
}

func (Comment) TableName() string {
	return "touch_comments"
}

type CommentLike struct {
	ID        uint64    `gorm:"primaryKey;autoIncrement:false"`
	UserID    uint64    `gorm:"uniqueIndex:idx_user_comment;not null"`
	CommentID uint64    `gorm:"uniqueIndex:idx_user_comment;index:idx_comment;not null"`
	CreatedAt time.Time
	
	User    *Actor   `gorm:"foreignKey:UserID"`
	Comment *Comment `gorm:"foreignKey:CommentID"`
}

func (CommentLike) TableName() string {
	return "touch_comment_likes"
}

type Follow struct {
	ID          uint64    `gorm:"primaryKey;autoIncrement:false"`
	FollowerID  uint64    `gorm:"uniqueIndex:idx_follower_following;index:idx_follower;not null"`
	FollowingID uint64    `gorm:"uniqueIndex:idx_follower_following;index:idx_following;not null"`
	CreatedAt   time.Time `gorm:"index"`
	
	Follower  *Actor `gorm:"foreignKey:FollowerID"`
	Following *Actor `gorm:"foreignKey:FollowingID"`
}

func (Follow) TableName() string {
	return "follows"
}

type PollVote struct {
	ID            uint64    `gorm:"primaryKey;autoIncrement:false"`
	PostID        uint64    `gorm:"uniqueIndex:idx_user_post;index:idx_post;not null"`
	UserID        uint64    `gorm:"uniqueIndex:idx_user_post;index:idx_user;not null"`
	OptionIndices string    `gorm:"type:varchar(100);not null"`
	CreatedAt     time.Time
	
	Post *Post  `gorm:"foreignKey:PostID"`
	User *Actor `gorm:"foreignKey:UserID"`
}

func (PollVote) TableName() string {
	return "touch_poll_votes"
}
