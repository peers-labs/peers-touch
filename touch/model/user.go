package model

import (
	"github.com/dirty-bro-tech/peers-touch-go/touch/util"
)

// Password validation constants
const (
	// Default password pattern: numbers, symbols, and English letters (8-20 chars)
	DefaultPasswordPattern   = `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`
	DefaultPasswordMinLength = 8
	DefaultPasswordMaxLength = 20
)

type UserSignParams struct {
	Params
	Name     string `json:"name" form:"name"` // Will be base64 encoded
	Email    string `json:"email" form:"email"`
	Password string `json:"password" form:"password"`
}

type UserLoginParams struct {
	Params
	Email    string `json:"email" form:"email"`
	Password string `json:"password" form:"password"`
}

func (user UserSignParams) Check() error {
	// Validate and encode name (5-20 characters, base64 encoded)
	encodedName, err := util.ValidateName(user.Name)
	if err != nil {
		return err
	}
	user.Name = encodedName // Update to base64 encoded version

	// Validate email format
	if err := util.ValidateEmail(user.Email); err != nil {
		return ErrUserInvalidEmail
	}

	// Validate password using default pattern
	config := &util.PasswordConfig{
		Pattern:   DefaultPasswordPattern,
		MinLength: DefaultPasswordMinLength,
		MaxLength: DefaultPasswordMaxLength,
	}
	if err := util.ValidatePassword(user.Password, config); err != nil {
		return ErrUserInvalidPassport.ReplaceMsg(err.Error())
	}

	return nil
}

func (user UserLoginParams) Check() error {
	// Validate email format
	if err := util.ValidateEmail(user.Email); err != nil {
		return ErrUserInvalidEmail
	}

	// Validate password using default pattern
	config := &util.PasswordConfig{
		Pattern:   DefaultPasswordPattern,
		MinLength: DefaultPasswordMinLength,
		MaxLength: DefaultPasswordMaxLength,
	}
	if err := util.ValidatePassword(user.Password, config); err != nil {
		return ErrUserInvalidPassword
	}

	return nil
}
