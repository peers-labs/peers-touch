package infrastructure

import "time"

type friendshipModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorPTID string    `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_friendship_actor_peer;index"`
	PeerPTID  string    `gorm:"column:peer_ptid;size:255;uniqueIndex:idx_friendship_actor_peer;index"`
	Status    int32     `gorm:"column:status;index"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (*friendshipModel) TableName() string { return "friend_chat_friendships" }
