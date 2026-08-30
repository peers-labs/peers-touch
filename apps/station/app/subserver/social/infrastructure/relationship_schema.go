package infrastructure

import (
	"time"

	"gorm.io/gorm"
)

type friendshipModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorDID  string    `gorm:"column:actor_did;size:255;uniqueIndex:idx_friendship_actor_peer;index"`
	PeerDID   string    `gorm:"column:peer_did;size:255;uniqueIndex:idx_friendship_actor_peer;index"`
	Status    int32     `gorm:"column:status;index"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*friendshipModel) TableName() string { return "friend_chat_friendships" }

func MigrateRelationshipSchema(db *gorm.DB) error {
	return db.AutoMigrate(
		&friendRequestModel{},
		&friendshipModel{},
	)
}
