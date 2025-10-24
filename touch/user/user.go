package user

import (
	"context"
	"fmt"

	log "github.com/peers-touch/peers-touch-go/core/logger"
	"github.com/peers-touch/peers-touch-go/core/store"
	"github.com/peers-touch/peers-touch-go/core/util/id"
	"github.com/peers-touch/peers-touch-go/touch/model"
	"github.com/peers-touch/peers-touch-go/touch/model/db"
	"golang.org/x/crypto/bcrypt"
)

const (
	// bcryptCost controls the computational complexity (12-14 recommended)
	bcryptCost = 12
)

func SignUp(c context.Context, userParams *model.UserSignParams) error {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[SignUp] Get db err: %v", err)
		return err
	}

	// query the exists user by name or email
	var existsUsers []db.User
	if err = rds.Where("name = ? OR email = ?", userParams.Name, userParams.Email).Find(&existsUsers).Error; err != nil {
		log.Warnf(c, "[SignUp] Check existing user err: %v", err)
		return err
	}

	// If any users found, return duplicate error
	if len(existsUsers) > 0 {
		return model.ErrUserUserExists
	}

	// Part 1: Create user with user's input
	u := db.User{
		Name:  userParams.Name,
		Email: userParams.Email,
	}

	// hash the password before storing it
	u.PasswordHash, err = generateHash(userParams.Password)
	if err != nil {
		log.Warnf(c, "[SignUp] Generate hash err: %v", err)
		return err
	}

	// Generate peers user ID from name
	u.PeersUserID = generatePeersUserID(userParams.Name)

	// Ensure peers user ID is unique
	for {
		var count int64
		if err := rds.Model(&db.User{}).Where("peers_user_id = ?", u.PeersUserID).Count(&count).Error; err != nil {
			log.Warnf(c, "[SignUp] Check peers user ID uniqueness err: %v", err)
			return err
		}
		if count == 0 {
			break
		}
		// Generate new peers user ID if collision
		u.PeersUserID = generatePeersUserID(userParams.Name)
	}

	// Create the user
	if err = rds.Create(&u).Error; err != nil {
		log.Warnf(c, "[SignUp] Create user err: %v", err)
		return err
	}

	// Part 2: Create user profile with default values if missing
	profile := db.UserProfile{
		UserID:  u.ID,
		Email:   u.Email,        // Use user's email
		Gender:  db.GenderOther, // Default gender
		PeersID: u.PeersUserID,  // Use the same peers user ID
	}

	// Set default values for optional fields if not provided
	profile.ProfilePhoto = "" // Default empty profile photo
	profile.Region = ""       // Default empty region
	profile.WhatsUp = ""      // Default empty what's up message

	if err = rds.Create(&profile).Error; err != nil {
		log.Warnf(c, "[SignUp] Create profile err: %v", err)
		return err
	}

	log.Infof(c, "[SignUp] User and profile created successfully for user %s with peers ID %s", u.Name, u.PeersUserID)
	return nil
}

func GetUserByName(c context.Context, name string) (*db.User, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetUserByName] Get db err: %v", err)
		return nil, err
	}

	presentUser := db.User{}
	if err = rds.Where("name = ?", name).Select(&db.User{}).Scan(&presentUser).Error; err != nil {
		return nil, err
	}

	return &presentUser, nil
}

func GetUserByEmail(c context.Context, email string) (*db.User, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[GetUserByEmail] Get db err: %v", err)
		return nil, err
	}

	presentUser := db.User{}
	if err = rds.Where("email = ?", email).First(&presentUser).Error; err != nil {
		return nil, err
	}

	return &presentUser, nil
}

// Login authenticates a user with email and password
func Login(c context.Context, loginParams *model.UserLoginParams) (*db.User, error) {
	rds, err := store.GetRDS(c)
	if err != nil {
		log.Warnf(c, "[Login] Get db err: %v", err)
		return nil, err
	}

	// Find user by email
	var user db.User
	if err = rds.Where("email = ?", loginParams.Email).First(&user).Error; err != nil {
		log.Warnf(c, "[Login] Find user by email err: %v", err)
		return nil, model.ErrUserNotFound
	}

	// Verify password
	if err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(loginParams.Password)); err != nil {
		log.Warnf(c, "[Login] Password verification failed: %v", err)
		return nil, model.ErrUserInvalidCredentials
	}

	return &user, nil
}

func generateHash(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(bytes), err
}

// generatePeersUserID generates a unique peers user ID based on user name
func generatePeersUserID(name string) string {
	// Use snowflake ID to ensure uniqueness
	snowflakeID := id.NextID()

	// Create a simple peers user ID format: first 3 chars of name + timestamp suffix
	prefix := ""
	if len(name) >= 3 {
		prefix = name[:3]
	} else {
		prefix = name
	}

	// Remove non-alphanumeric characters and convert to lowercase
	cleanPrefix := ""
	for _, r := range prefix {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			cleanPrefix += string(r)
		}
	}

	if cleanPrefix == "" {
		cleanPrefix = "usr"
	}

	return fmt.Sprintf("%s_%d", cleanPrefix, snowflakeID%1000000)
}
