package actor

import (
	"context"
	"fmt"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/crypto"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"golang.org/x/crypto/bcrypt"
)

type PresetActorConfig struct {
	Username    string
	Email       string
	Password    string
	DisplayName string
	Endpoints   map[string]string
}

func SeedPresetActors(ctx context.Context, presets []PresetActorConfig) error {
	if len(presets) == 0 {
		return nil
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	for _, p := range presets {
		displayName := p.DisplayName
		if displayName == "" {
			displayName = p.Username
		}

		email := p.Email
		if email == "" {
			if p.Endpoints != nil {
				if v, ok := p.Endpoints["email"]; ok {
					email = v
				}
			}
		}
		if email == "" {
			email = fmt.Sprintf("%s@station.local", p.Username)
		}

		var exists db.Actor
		if err := rds.Where("email = ?", email).Or("preferred_username = ?", p.Username).First(&exists).Error; err == nil {
			var meta db.ActorTouchMeta
			if e := rds.Where("actor_id = ?", exists.ID).First(&meta).Error; e != nil {
				meta = db.ActorTouchMeta{ActorID: exists.ID}
				_ = rds.Create(&meta).Error
			}
			continue
		}

		pw := p.Password
		if pw == "" {
			pw = "1"
		}
		hash, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)

		pubPEM, privPEM, _ := crypto.GenerateRSAKeyPair(2048)

		a := db.Actor{
			PreferredUsername: p.Username,
			Name:              displayName,
			Email:             email,
			PasswordHash:      string(hash),
			PTID:              p.Username,
			PublicKey:         pubPEM,
			PrivateKey:        privPEM,
			Url:               fmt.Sprintf("https://station.local/users/%s", p.Username),
			Inbox:             fmt.Sprintf("https://station.local/activitypub/%s/inbox", p.Username),
			Outbox:            fmt.Sprintf("https://station.local/activitypub/%s/outbox", p.Username),
		}

		if err := rds.Create(&a).Error; err != nil {
			log.Warnf(ctx, "seed create actor err: %v", err)
			continue
		}

		meta := db.ActorTouchMeta{ActorID: a.ID}
		if err := rds.Create(&meta).Error; err != nil {
			log.Warnf(ctx, "seed create meta err: %v", err)
		}
		log.Infof(ctx, "[seed] preset user %s (%s) created", p.Username, email)
	}
	return nil
}
