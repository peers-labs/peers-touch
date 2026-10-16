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
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// MintInternalProgramActor creates a hidden Station-owned service identity.
// Generic publishers use TypeService; the optional Bot product uses TypeAgent.
func MintInternalProgramActor(
	ctx context.Context,
	username string,
	displayName string,
	namespace string,
	accountType identity.AccountType,
) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", fmt.Errorf("internal program username is required")
	}
	if accountType != identity.TypeService && accountType != identity.TypeAgent {
		return "", fmt.Errorf("internal program account type is unsupported")
	}
	if namespace == "" {
		namespace = "peers"
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[MintInternalProgramActor] get db: %v", err)
		return "", err
	}

	var existing int64
	if err = rds.Model(&db.Actor{}).
		Where("namespace = ? AND preferred_username = ?", namespace, username).
		Count(&existing).Error; err != nil {
		return "", err
	}
	if existing > 0 {
		return "", model.ErrActorExists
	}

	pubPEM, privPEM, err := crypto.GenerateRSAKeyPair(2048)
	if err != nil {
		return "", err
	}

	created, err := identity.CreateIdentity(ctx, username, namespace, accountType)
	if err != nil {
		return "", err
	}

	a := db.Actor{
		PreferredUsername: username,
		Email:             fmt.Sprintf("program-%s@internal.local", username),
		Name:              displayName,
		Type:              "Service",
		Kind:              string(accountType),
		Namespace:         namespace,
		PublicKey:         pubPEM,
		PrivateKey:        privPEM,
		PTID:              created.PTID,
		Origin:            OriginLocal,
		Visibility:        VisibilityHidden,
	}
	// Fill home-station routing fields and a canonical (but non-published)
	// federated handle; Visibility is already HIDDEN so this never promotes it.
	fillFederationFieldsForLocalSignUp(&a)
	a.Visibility = VisibilityHidden

	if err = rds.Create(&a).Error; err != nil {
		log.Warnf(ctx, "[MintInternalProgramActor] create actor: %v", err)
		return "", err
	}

	meta := db.ActorTouchMeta{
		ActorID:                   a.ID,
		Discoverable:              false,
		ManuallyApprovesFollowers: true,
		DefaultVisibility:         "private",
		MessagePermission:         "nobody",
	}
	if err = rds.Create(&meta).Error; err != nil {
		return "", err
	}

	log.Infof(ctx, "[MintInternalProgramActor] minted internal actor %s (%s)", username, created.PTID)
	return created.PTID, nil
}

// SetInternalAgentAvatar updates a Station-owned internal AGENT actor's icon
// (an IM Bot avatar) on behalf of its owner. The bot never logs in, so the
// generic /actor/profile endpoint (whose target is always the JWT subject)
// cannot be used. The avatar is a Station-relative OSS URL
// (`/sub-oss/file?key=...`); empty clears it back to the default glyph.
//
// Unlike user-driven profile edits this performs no optimistic-revision
// conflict check (the owner is the only writer) and never publishes
// visibility: a HIDDEN bot changing its avatar must not emit DHT noise.
func SetInternalAgentAvatar(ctx context.Context, ptid, avatar string) error {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" {
		return fmt.Errorf("bot actor ptid is required")
	}
	avatar = strings.TrimSpace(avatar)
	if avatar != "" && !strings.HasPrefix(avatar, "/") {
		return fmt.Errorf("bot avatar must be a Station-relative URL, got %q", avatar)
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}

	return rds.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var actor db.Actor
		if err := tx.Where("ptid = ?", ptid).First(&actor).Error; err != nil {
			return err
		}
		if err := tx.Model(&db.Actor{}).
			Where("id = ?", actor.ID).
			Update("icon", avatar).Error; err != nil {
			return err
		}
		// Keep profile_revision canonical for readers, creating the meta row
		// if an older mint left it absent.
		var meta db.ActorTouchMeta
		findErr := tx.Where("actor_id = ?", actor.ID).First(&meta).Error
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			return tx.Create(&db.ActorTouchMeta{ActorID: actor.ID, ProfileRevision: 1}).Error
		}
		if findErr != nil {
			return findErr
		}
		next := meta.ProfileRevision
		if next == 0 {
			next = 1
		}
		next++
		return tx.Model(&db.ActorTouchMeta{}).
			Where("actor_id = ?", actor.ID).
			Update("profile_revision", next).Error
	})
}
