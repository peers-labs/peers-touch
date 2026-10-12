package actor

import (
	"context"
	"fmt"
	"strings"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/crypto"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// MintInternalAgentActor creates a HIDDEN, non-human AGENT actor owned by the
// Station itself (an IM Bot). Unlike public SignUp it sets no usable password,
// publishes nothing to the DHT, and uses PTID account letter "b". It returns
// the new actor PTID. The Bot never logs in; all delivery is system-mediated
// service plaintext.
func MintInternalAgentActor(ctx context.Context, username, displayName, namespace string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", fmt.Errorf("bot username is required")
	}
	if namespace == "" {
		namespace = "peers"
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		log.Warnf(ctx, "[MintInternalAgentActor] get db: %v", err)
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

	created, err := identity.CreateIdentity(ctx, username, namespace, identity.TypeAgent)
	if err != nil {
		return "", err
	}

	a := db.Actor{
		PreferredUsername: username,
		Email:             fmt.Sprintf("bot-%s@internal.local", username),
		Name:              displayName,
		Type:              "Service",
		Kind:              string(identity.TypeAgent),
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
		log.Warnf(ctx, "[MintInternalAgentActor] create actor: %v", err)
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

	log.Infof(ctx, "[MintInternalAgentActor] minted AGENT actor %s (%s)", username, created.PTID)
	return created.PTID, nil
}
