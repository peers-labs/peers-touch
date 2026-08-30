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
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type devFriendSession struct {
	ULID             string    `gorm:"column:ulid;primaryKey"`
	ParticipantAPtid string    `gorm:"column:participant_a_ptid"`
	ParticipantBPtid string    `gorm:"column:participant_b_ptid"`
	CreatedAt        time.Time `gorm:"column:created_at"`
	UpdatedAt        time.Time `gorm:"column:updated_at"`
}

func (devFriendSession) TableName() string { return "friend_chat_sessions" }

// SeedDevFriendships creates mutual social-graph edges between the specified
// preset users and, when available, legacy friend chat sessions.
func SeedDevFriendships(ctx context.Context, friendUsernames []string) error {
	if len(friendUsernames) < 2 {
		return nil
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	return seedDevFriendshipsWithDB(ctx, rds, friendUsernames)
}

func seedDevFriendshipsWithDB(ctx context.Context, rds *gorm.DB, friendUsernames []string) error {
	actorIDs := make(map[string]uint64)
	for _, username := range friendUsernames {
		var a db.Actor
		if err := rds.Where("preferred_username = ?", username).First(&a).Error; err != nil {
			log.Warnf(ctx, "[seed] actor %q not found, skipping friendship seed for them", username)
			continue
		}
		actorIDs[username] = a.ID
	}

	seededEdges := 0
	seededSessions := 0
	hasFollows := rds.Migrator().HasTable(&db.Follow{})
	hasLegacySessions := rds.Migrator().HasTable("friend_chat_sessions")
	for i := 0; i < len(friendUsernames); i++ {
		for j := i + 1; j < len(friendUsernames); j++ {
			aID := actorIDs[friendUsernames[i]]
			bID := actorIDs[friendUsernames[j]]
			if aID == 0 || bID == 0 {
				continue
			}

			if hasFollows {
				for _, edge := range []db.Follow{
					{FollowerID: aID, FollowingID: bID, CreatedAt: time.Now()},
					{FollowerID: bID, FollowingID: aID, CreatedAt: time.Now()},
				} {
					result := rds.Clauses(clause.OnConflict{DoNothing: true}).Create(&edge)
					if result.Error != nil {
						return fmt.Errorf(
							"seed mutual follow %s↔%s: %w",
							friendUsernames[i],
							friendUsernames[j],
							result.Error,
						)
					}
					seededEdges += int(result.RowsAffected)
				}
			}

			if !hasLegacySessions {
				continue
			}
			aPtid := fmt.Sprintf("%d", aID)
			bPtid := fmt.Sprintf("%d", bID)
			var count int64
			rds.Table("friend_chat_sessions").
				Where("(participant_a_ptid = ? AND participant_b_ptid = ?) OR (participant_a_ptid = ? AND participant_b_ptid = ?)",
					aPtid, bPtid, bPtid, aPtid).
				Count(&count)
			if count > 0 {
				continue
			}

			session := devFriendSession{
				ULID:             ulid.MustNew(ulid.Timestamp(time.Now()), rand.Reader).String(),
				ParticipantAPtid: aPtid,
				ParticipantBPtid: bPtid,
				CreatedAt:        time.Now(),
				UpdatedAt:        time.Now(),
			}
			if err := rds.Create(&session).Error; err != nil {
				log.Warnf(ctx, "[seed] friendship %s↔%s failed: %v", friendUsernames[i], friendUsernames[j], err)
				continue
			}
			seededSessions++
		}
	}

	if !hasFollows {
		log.Infof(ctx, "[seed] follows table not yet created, skipping canonical friendship seed")
	}
	if !hasLegacySessions {
		log.Infof(ctx, "[seed] friend_chat_sessions table not yet created, skipping legacy friendship seed")
	}
	if seededEdges > 0 || seededSessions > 0 {
		log.Infof(
			ctx,
			"[seed] dev friendships seeded: %d social edges, %d legacy sessions",
			seededEdges,
			seededSessions,
		)
	}
	return nil
}
