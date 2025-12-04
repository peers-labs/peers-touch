package actor

import (
	"context"

	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	identity "github.com/peers-labs/peers-touch/station/frame/touch/actor/identity"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"golang.org/x/crypto/bcrypt"
)

const (
	// bcryptCost controls the computational complexity (12-14 recommended)
	bcryptCost = 12
)

func SignUp(c context.Context, actorParams *model.ActorSignParams) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[SignUp] Get db err: %v", err)
		return err
	}

	// query the exists actor by name or email
	var existsActors []db.Actor
	if err = rds.Where("name = ? OR email = ?", actorParams.Name, actorParams.Email).Find(&existsActors).Error; err != nil {
		log.Warnf(c, "[SignUp] Check existing actor err: %v", err)
		return err
	}

	// If any actors found, return duplicate error
	if len(existsActors) > 0 {
		return model.ErrActorActorExists
	}

	// Part 1: Create actor with actor's input
	a := db.Actor{
		Name:        actorParams.Name,
		Email:       actorParams.Email,
		DisplayName: actorParams.Name, // Default display name to username
		Type:        "Person",         // Default to Person
		Namespace:   "peers",          // Default namespace
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

	a.PeersActorID = createdIdentity.PTID

	// Create the actor
	if err = rds.Create(&a).Error; err != nil {
		log.Warnf(c, "[SignUp] Create actor err: %v", err)
		return err
	}

	// Part 2: Create actor profile with default values if missing
	profile := db.ActorProfile{
		ActorID: a.ID,
		Email:   a.Email,        // Use actor's email
		Gender:  db.GenderOther, // Default gender
		PeersID: a.PeersActorID, // Use the same peers actor ID
	}

	// Set default values for optional fields if not provided
	profile.ProfilePhoto = "" // Default empty profile photo
	profile.Region = ""       // Default empty region
	profile.WhatsUp = ""      // Default empty what's up message

	if err = rds.Create(&profile).Error; err != nil {
		log.Warnf(c, "[SignUp] Create profile err: %v", err)
		return err
	}

	log.Infof(c, "[SignUp] Actor and profile created successfully for actor %s with peers ID %s", a.Name, a.PeersActorID)
	return nil
}

func GetActorByName(c context.Context, name string) (*db.Actor, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetActorByName] Get db err: %v", err)
		return nil, err
	}

	presentActor := db.Actor{}
	if err = rds.Where("name = ?", name).Select(&db.Actor{}).Scan(&presentActor).Error; err != nil {
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
