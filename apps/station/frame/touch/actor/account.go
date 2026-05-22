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
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	bcryptCost = 12
)

func SignUp(c context.Context, req *model.ActorSignRequest, baseURL string) error {
	if req == nil {
		return fmt.Errorf("nil signup request")
	}

	profile := signupProfileFromRequest(req)
	namespace := strings.TrimSpace(req.GetNamespace())
	if namespace == "" {
		namespace = "peers"
	}

	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[SignUp] Get db err: %v", err)
		return err
	}

	var existsActors []db.Actor
	if err = rds.Where("preferred_username = ? OR email = ?", req.GetName(), req.GetEmail()).Find(&existsActors).Error; err != nil {
		log.Warnf(c, "[SignUp] Check existing actor err: %v", err)
		return err
	}

	if len(existsActors) > 0 {
		return model.ErrActorExists
	}

	pubPEM, privPEM, err := crypto.GenerateRSAKeyPair(2048)
	if err != nil {
		log.Warnf(c, "[SignUp] Generate RSA keys err: %v", err)
		return err
	}

	actorPath := fmt.Sprintf("%s/activitypub/%s", baseURL, req.GetName())
	a := db.Actor{
		PreferredUsername: req.GetName(),
		Email:             req.GetEmail(),
		Name:              req.GetName(),
		Type:              profile.apType,
		Kind:              profile.kindDB,
		Namespace:         namespace,
		PublicKey:         pubPEM,
		PrivateKey:        privPEM,
		Url:               fmt.Sprintf("%s/users/%s", baseURL, req.GetName()),
		Inbox:             fmt.Sprintf("%s/inbox", actorPath),
		Outbox:            fmt.Sprintf("%s/outbox", actorPath),
		Followers:         fmt.Sprintf("%s/followers", actorPath),
		Following:         fmt.Sprintf("%s/following", actorPath),
		Liked:             fmt.Sprintf("%s/liked", actorPath),
		Endpoints:         fmt.Sprintf(`{"sharedInbox": "%s/activitypub/inbox"}`, baseURL),
	}

	a.PasswordHash, err = generateHash(req.GetPassword())
	if err != nil {
		log.Warnf(c, "[SignUp] Generate hash err: %v", err)
		return err
	}

	createdIdentity, err := identity.CreateIdentity(c, req.GetName(), namespace, profile.identityType)
	if err != nil {
		log.Warnf(c, "[SignUp] Create identity err: %v", err)
		return err
	}

	a.PTID = createdIdentity.PTID

	// Federation columns (Phase A): populated from the bootstrap-published
	// local identity. Defaulting to ACTOR_VISIBILITY_BY_HANDLE keeps the
	// out-of-the-box behaviour aligned with the legacy ActorTouchMeta
	// `Discoverable=true` default — operators who want hidden-by-default
	// flip the column post-signup.
	fillFederationFieldsForLocalSignUp(&a)

	if err = rds.Create(&a).Error; err != nil {
		log.Warnf(c, "[SignUp] Create actor err: %v", err)
		return err
	}

	meta := db.ActorTouchMeta{
		ActorID:                   a.ID,
		Discoverable:              true,
		ManuallyApprovesFollowers: false,
		DefaultVisibility:         "public",
		MessagePermission:         "everyone",
	}

	if err = rds.Create(&meta).Error; err != nil {
		log.Warnf(c, "[SignUp] Create meta err: %v", err)
		return err
	}

	log.Infof(c, "[SignUp] Actor and meta created successfully for actor %s with peers ID %s", a.PreferredUsername, a.PTID)

	// Federation locator publish — best-effort, async. SignUp returns
	// success regardless of DHT state; the publisher is bound to the
	// actor row so a later visibility flip will retry on the next call.
	if a.Visibility == VisibilityByHandle || a.Visibility == VisibilityIndexed {
		publishVisibilityAsync(a.ID)
	}
	return nil
}

// GetActorByName looks up a LOCAL actor by preferred_username. It scopes
// to origin='local' because Phase D introduced remote_cached rows that
// share the same handle namespace; without the filter a peer station's
// "alice" cached locally could shadow this station's own "alice".
func GetActorByName(c context.Context, name string) (*db.Actor, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetActorByName] Get db err: %v", err)
		return nil, err
	}

	var presentActor db.Actor
	if err = rds.Where("preferred_username = ? AND origin = ?", name, OriginLocal).First(&presentActor).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &presentActor, nil
}

func Login(c context.Context, loginParams *model.ActorLoginParams) (*db.Actor, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[Login] Get db err: %v", err)
		return nil, err
	}

	var actor db.Actor
	if err = rds.Where("email = ?", loginParams.Email).First(&actor).Error; err != nil {
		log.Warnf(c, "[Login] Find actor by email err: %v", err)
		return nil, model.ErrActorNotFound
	}

	if err = bcrypt.CompareHashAndPassword([]byte(actor.PasswordHash), []byte(loginParams.Password)); err != nil {
		log.Warnf(c, "[Login] Password verification failed: %v", err)
		return nil, model.ErrActorInvalidCredentials
	}

	return &actor, nil
}

func generateHash(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(bytes), err
}
