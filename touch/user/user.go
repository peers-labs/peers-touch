package user

import (
	"context"

	log "github.com/dirty-bro-tech/peers-touch-go/core/logger"
	"github.com/dirty-bro-tech/peers-touch-go/core/store"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model"
	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
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

	if err = rds.Create(&u).Error; err != nil {
		log.Warnf(c, "[SignUp] Create user err: %v", err)
	}

	return err
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

func generateHash(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(bytes), err
}
