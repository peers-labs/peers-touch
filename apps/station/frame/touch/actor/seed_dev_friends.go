package actor

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

type devFriendSession struct {
	ULID            string    `gorm:"column:ulid;primaryKey"`
	ParticipantADID string    `gorm:"column:participant_a_did"`
	ParticipantBDID string    `gorm:"column:participant_b_did"`
	CreatedAt       time.Time `gorm:"column:created_at"`
	UpdatedAt       time.Time `gorm:"column:updated_at"`
}

func (devFriendSession) TableName() string { return "friend_chat_sessions" }

// SeedDevFriendships creates mutual friend chat sessions between the
// specified preset users. Idempotent: skips pairs that already have a session.
// friendUsernames is the list of usernames that should all be friends.
func SeedDevFriendships(ctx context.Context, friendUsernames []string) error {
	if len(friendUsernames) < 2 {
		return nil
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	if !rds.Migrator().HasTable("friend_chat_sessions") {
		log.Infof(ctx, "[seed] friend_chat_sessions table not yet created, skipping friendship seed")
		return nil
	}

	actorIDs := make(map[string]string)
	for _, username := range friendUsernames {
		var a db.Actor
		if err := rds.Where("preferred_username = ?", username).First(&a).Error; err != nil {
			log.Warnf(ctx, "[seed] actor %q not found, skipping friendship seed for them", username)
			continue
		}
		actorIDs[username] = fmt.Sprintf("%d", a.ID)
	}

	seeded := 0
	for i := 0; i < len(friendUsernames); i++ {
		for j := i + 1; j < len(friendUsernames); j++ {
			aDID := actorIDs[friendUsernames[i]]
			bDID := actorIDs[friendUsernames[j]]
			if aDID == "" || bDID == "" {
				continue
			}

			var count int64
			rds.Table("friend_chat_sessions").
				Where("(participant_a_did = ? AND participant_b_did = ?) OR (participant_a_did = ? AND participant_b_did = ?)",
					aDID, bDID, bDID, aDID).
				Count(&count)
			if count > 0 {
				continue
			}

			session := devFriendSession{
				ULID:            ulid.MustNew(ulid.Timestamp(time.Now()), rand.Reader).String(),
				ParticipantADID: aDID,
				ParticipantBDID: bDID,
				CreatedAt:       time.Now(),
				UpdatedAt:       time.Now(),
			}
			if err := rds.Create(&session).Error; err != nil {
				log.Warnf(ctx, "[seed] friendship %s↔%s failed: %v", friendUsernames[i], friendUsernames[j], err)
				continue
			}
			seeded++
		}
	}

	if seeded > 0 {
		log.Infof(ctx, "[seed] dev friendships seeded: %d pairs", seeded)
	}
	return nil
}
