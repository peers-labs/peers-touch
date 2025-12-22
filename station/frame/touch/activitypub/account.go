package activitypub

import (
	"context"
	"errors"
	"fmt"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	// bcryptCost controls the computational complexity (12-14 recommended)
	bcryptCost = 12
)

func SignUp(c context.Context, actorParams *model.ActorSignParams, baseURL string) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[SignUp] Get db err: %v", err)
		return err
	}

	// query the exists actor by preferred_username or email
	var existsActors []db.Actor
	if err = rds.Where("preferred_username = ? OR email = ?", actorParams.Name, actorParams.Email).Find(&existsActors).Error; err != nil {
		log.Warnf(c, "[SignUp] Check existing actor err: %v", err)
		return err
	}

	// If any actors found, return duplicate error
	if len(existsActors) > 0 {
		return model.ErrActorActorExists
	}

	// Part 1: Generate Keys
	pubPEM, privPEM, err := GenerateRSAKeyPair(2048)
	if err != nil {
		log.Warnf(c, "[SignUp] Generate RSA keys err: %v", err)
		return err
	}

	// Part 2: Create actor with actor's input
	actorPath := fmt.Sprintf("%s/activitypub/%s", baseURL, actorParams.Name)
	a := db.Actor{
		PreferredUsername: actorParams.Name,
		Email:             actorParams.Email,
		Name:              actorParams.Name, // Default display name to username
		Type:              "Person",         // Default to Person
		Namespace:         "peers",          // Default namespace
		PublicKey:         pubPEM,
		PrivateKey:        privPEM,
		// Populate standard ActivityPub URIs
		Url:       fmt.Sprintf("%s/users/%s", baseURL, actorParams.Name), // Public Profile URL
		Inbox:     fmt.Sprintf("%s/inbox", actorPath),
		Outbox:    fmt.Sprintf("%s/outbox", actorPath),
		Followers: fmt.Sprintf("%s/followers", actorPath),
		Following: fmt.Sprintf("%s/following", actorPath),
		Liked:     fmt.Sprintf("%s/liked", actorPath),
		Endpoints: fmt.Sprintf(`{"sharedInbox": "%s/activitypub/inbox"}`, baseURL),
	}

	// hash the password before storing it
	a.PasswordHash, err = generateHash(actorParams.Password)
	if err != nil {
		log.Warnf(c, "[SignUp] Generate hash err: %v", err)
		return err
	}

	// Generate Unified Identity (PTID)
	// Create new identity for the actor
	// Namespace: "peers" (default)
	// Type: TypePerson
	createdIdentity, err := identity.CreateIdentity(c, actorParams.Name, "peers", identity.TypePerson)
	if err != nil {
		log.Warnf(c, "[SignUp] Create identity err: %v", err)
		return err
	}

	a.PTID = createdIdentity.PTID

	// Create the actor
	if err = rds.Create(&a).Error; err != nil {
		log.Warnf(c, "[SignUp] Create actor err: %v", err)
		return err
	}

	// Part 3: Create actor mastodon meta (extensions) with default values
	meta := db.ActorMastodonMeta{
		ActorID: a.ID,
		// Default values
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
	return nil
}

func GetActorByName(c context.Context, name string) (*db.Actor, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetActorByName] Get db err: %v", err)
		return nil, err
	}

	var presentActor db.Actor
	if err = rds.Where("preferred_username = ?", name).First(&presentActor).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &presentActor, nil
}

func GetActorByEmail(c context.Context, email string) (*db.Actor, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetActorByEmail] Get db err: %v", err)
		return nil, err
	}

	presentActor := db.Actor{}
	if err = rds.Where("email = ?", email).First(&presentActor).Error; err != nil {
		return nil, err
	}

	return &presentActor, nil
}

// Login authenticates an actor with email and password
func Login(c context.Context, loginParams *model.ActorLoginParams) (*db.Actor, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[Login] Get db err: %v", err)
		return nil, err
	}

	// Find actor by email
	var actor db.Actor
	if err = rds.Where("email = ?", loginParams.Email).First(&actor).Error; err != nil {
		log.Warnf(c, "[Login] Find actor by email err: %v", err)
		return nil, model.ErrActorNotFound
	}

	// Verify password
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
