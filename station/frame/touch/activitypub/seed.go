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
		name := p.DisplayName
		if name == "" {
			name = p.Username
		}
		email := ""
		if p.Endpoints != nil {
			// optional email could be provided in endpoints map
			if v, ok := p.Endpoints["email"]; ok {
				email = v
			}
		}
		if email == "" {
			email = fmt.Sprintf("%s@station.local", p.Username)
		}
		// check existing by email or name
		var exists db.Actor
		if err := rds.Where("email = ?", email).Or("name = ?", name).First(&exists).Error; err == nil {
			// ensure profile exists
			var prof db.ActorProfile
			if e := rds.Where("user_id = ?", exists.ID).First(&prof).Error; e != nil {
				prof = db.ActorProfile{ActorID: exists.ID, Email: email, PeersID: p.Username}
				_ = rds.Create(&prof).Error
			}
			continue
		}
		// create new
		pw := []byte("preset-" + p.Username)
		hash, _ := bcrypt.GenerateFromPassword(pw, bcrypt.DefaultCost)
		a := db.Actor{
			Name:         name,
			Email:        email,
			PasswordHash: string(hash),
			PeersActorID: p.Username,
		}
		if err := rds.Create(&a).Error; err != nil {
			log.Warnf(c, "seed create actor err: %v", err)
			continue
		}
		profile := db.ActorProfile{ActorID: a.ID, Email: email, PeersID: p.Username}
		if err := rds.Create(&profile).Error; err != nil {
			log.Warnf(c, "seed create profile err: %v", err)
		}
		log.Infof(c, "[seed] preset user %s (%s) created", p.Username, email)
	}
	return nil
}
