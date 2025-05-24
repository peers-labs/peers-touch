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

	if err = rds.Create(&userParams).Error; err != nil {
		log.Warnf(c, "[SignUp] Create user err: %v", err)
	}

	return err
}

func generateHash(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(bytes), err
}
