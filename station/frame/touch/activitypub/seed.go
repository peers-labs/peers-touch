package activitypub

import (
	"context"
	"fmt"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"golang.org/x/crypto/bcrypt"
)

// SeedPresetUsers ensures preset users exist in database
func SeedPresetUsers(c context.Context) error {
	presets, err := LoadPresetActors(c)
	if err != nil {
		return err
	}

	if len(presets) == 0 {
		return nil
	}
	rds, err := store.GetRDS(c)
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
				// optional email could be provided in endpoints map
				if v, ok := p.Endpoints["email"]; ok {
					email = v
				}
			}
		}
		if email == "" {
			email = fmt.Sprintf("%s@station.local", p.Username)
		}
		
		// check existing by email or preferred_username
		var exists db.Actor
		if err := rds.Where("email = ?", email).Or("preferred_username = ?", p.Username).First(&exists).Error; err == nil {
			// ensure meta exists
			var meta db.ActorMastodonMeta
			if e := rds.Where("actor_id = ?", exists.ID).First(&meta).Error; e != nil {
				meta = db.ActorMastodonMeta{ActorID: exists.ID}
				_ = rds.Create(&meta).Error
			}
			continue
		}
		
		// create new
		pw := []byte("preset-" + p.Username)
		hash, _ := bcrypt.GenerateFromPassword(pw, bcrypt.DefaultCost)
		
		// Generate keys
		pubPEM, privPEM, _ := GenerateRSAKeyPair(2048)
		
		a := db.Actor{
			PreferredUsername: p.Username,
			Name:              displayName,
			Email:             email,
			PasswordHash:      string(hash),
			PTID:              p.Username, // Use username as PTID for preset users
			PublicKey:         pubPEM,
			PrivateKey:        privPEM,
			// Populate basic URIs (assuming local station)
			Url:       fmt.Sprintf("https://station.local/users/%s", p.Username),
			Inbox:     fmt.Sprintf("https://station.local/activitypub/%s/inbox", p.Username),
			Outbox:    fmt.Sprintf("https://station.local/activitypub/%s/outbox", p.Username),
		}
		
		if err := rds.Create(&a).Error; err != nil {
			log.Warnf(c, "seed create actor err: %v", err)
			continue
		}
		
		meta := db.ActorMastodonMeta{ActorID: a.ID}
		if err := rds.Create(&meta).Error; err != nil {
			log.Warnf(c, "seed create meta err: %v", err)
		}
		log.Infof(c, "[seed] preset user %s (%s) created", p.Username, email)
	}
	return nil
}
