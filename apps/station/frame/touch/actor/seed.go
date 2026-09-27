package actor

import (
	"context"
	"errors"
	"fmt"
	"strings"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/crypto"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const presetActorNamespace = "peers"
const legacyGeneratedPresetAvatarPrefix = "https://internal.example.invalid/api/ide/v1/text_to_image?"

type PresetActorConfig struct {
	Username      string
	Email         string
	Password      string
	DisplayName   string
	Avatar        string
	LegacyAvatars []string
	Endpoints     map[string]string
}

func SeedPresetActors(ctx context.Context, presets []PresetActorConfig) error {
	if len(presets) == 0 {
		return nil
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	if err := identity.NewStore(rds).AutoMigrate(); err != nil {
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
		if err := rds.
			Where(
				"origin = ? AND (email = ? OR preferred_username = ?)",
				OriginLocal,
				email,
				p.Username,
			).
			First(&exists).Error; err == nil {
			if err := ensurePresetActorIdentity(ctx, rds, &exists); err != nil {
				return fmt.Errorf("seed preset actor %s identity: %w", p.Username, err)
			}
			if err := backfillPresetAvatar(
				rds,
				&exists,
				p.Avatar,
				p.LegacyAvatars,
			); err != nil {
				log.Warnf(ctx, "seed preset avatar for %s: %v", p.Username, err)
			}
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
			Icon:              p.Avatar,
			Email:             email,
			PasswordHash:      string(hash),
			PTID:              p.Username,
			PublicKey:         pubPEM,
			PrivateKey:        privPEM,
			Url:               fmt.Sprintf("https://station.local/users/%s", p.Username),
			Inbox:             fmt.Sprintf("https://station.local/activitypub/%s/inbox", p.Username),
			Outbox:            fmt.Sprintf("https://station.local/activitypub/%s/outbox", p.Username),
		}

		// Fill federation fields (FederatedHandle unique index) same as normal sign-up.
		fillFederationFieldsForLocalSignUp(&a)
		// Fallback: if federation identity is not ready yet, use a deterministic
		// placeholder to satisfy the unique index on FederatedHandle.
		if a.FederatedHandle == "" {
			a.FederatedHandle = fmt.Sprintf("@%s@station.local", p.Username)
		}

		if err := rds.Create(&a).Error; err != nil {
			log.Warnf(ctx, "seed create actor err: %v", err)
			continue
		}
		if err := ensurePresetActorIdentity(ctx, rds, &a); err != nil {
			return fmt.Errorf("seed preset actor %s identity: %w", p.Username, err)
		}

		meta := db.ActorTouchMeta{ActorID: a.ID}
		if err := rds.Create(&meta).Error; err != nil {
			log.Warnf(ctx, "seed create meta err: %v", err)
		}
		log.Infof(ctx, "[seed] preset user %s (%s) created", p.Username, email)
	}
	return nil
}

func backfillPresetAvatar(
	rds *gorm.DB,
	actor *db.Actor,
	avatar string,
	legacyAvatars []string,
) error {
	if actor.Origin != OriginLocal ||
		avatar == "" ||
		(actor.Icon != "" && !isRetiredPresetAvatar(actor.Icon, legacyAvatars)) {
		return nil
	}
	return rds.Model(actor).Update("icon", avatar).Error
}

func isRetiredPresetAvatar(avatar string, legacyAvatars []string) bool {
	if strings.HasPrefix(avatar, legacyGeneratedPresetAvatarPrefix) {
		return true
	}
	for _, legacyAvatar := range legacyAvatars {
		if avatar == legacyAvatar {
			return true
		}
	}
	return false
}

func ensurePresetActorIdentity(ctx context.Context, rds *gorm.DB, actorRecord *db.Actor) error {
	if _, err := identity.Parse(actorRecord.PTID); err == nil {
		return nil
	}

	var existing identity.Identity
	err := rds.WithContext(ctx).
		Where("username = ? AND namespace = ?", actorRecord.PreferredUsername, presetActorNamespace).
		Order("id ASC").
		First(&existing).Error
	switch {
	case err == nil:
		if _, parseErr := identity.Parse(existing.PTID); parseErr != nil {
			return fmt.Errorf("stored preset identity is invalid: %w", parseErr)
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		created, createErr := identity.CreateIdentity(
			ctx,
			actorRecord.PreferredUsername,
			presetActorNamespace,
			identity.TypePerson,
		)
		if createErr != nil {
			return createErr
		}
		existing = *created
	default:
		return err
	}

	if err := rds.WithContext(ctx).
		Model(&db.Actor{}).
		Where("id = ?", actorRecord.ID).
		Update("ptid", existing.PTID).Error; err != nil {
		return err
	}
	actorRecord.PTID = existing.PTID
	return nil
}
