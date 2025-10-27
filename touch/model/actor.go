package model

import (
	"strings"

	"github.com/peers-touch/peers-touch-go/touch/util"
)

type WebFingerResource string

func (r WebFingerResource) Prefix() string {
	return strings.Split(string(r), ":")[0]
}

func (r WebFingerResource) Value() string {
	return strings.Split(string(r), ":")[1]
}

type WebFingerParams struct {
	Params
	Resource           WebFingerResource `query:"resource"`
	ActivityPubVersion string            `query:"activity_pub_version"`
}

func (r WebFingerParams) Check() error {
	if strings.TrimSpace(string(r.Resource)) == "" || strings.Contains(string(r.Resource), ":") == false {
		return ErrWellKnownInvalidResourceFormat
	}

	if r.Resource.Prefix() != "acct" {
		return ErrWellKnownUnsupportedPrefixType
	}

	return nil
}

// Password validation constants
const (
	// Default password pattern: numbers, symbols, and English letters (8-20 chars)
	DefaultPasswordPattern   = `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`
	DefaultPasswordMinLength = 8
	DefaultPasswordMaxLength = 20
)

type ActorSignParams struct {
	Params
	Name     string `json:"name" form:"name"` // Will be base64 encoded
	Email    string `json:"email" form:"email"`
	Password string `json:"password" form:"password"`
}

type ActorLoginParams struct {
	Params
	Email    string `json:"email" form:"email"`
	Password string `json:"password" form:"password"`
}

func (actor ActorSignParams) Check() error {
	// Validate and encode name (5-20 characters, base64 encoded)
	encodedName, err := util.ValidateName(actor.Name)
	if err != nil {
		return err
	}
	actor.Name = encodedName // Update to base64 encoded version

	// Validate email format
	if err := util.ValidateEmail(actor.Email); err != nil {
		return ErrActorInvalidEmail
	}

	// Validate password using default pattern
	config := &util.PasswordConfig{
		Pattern:   DefaultPasswordPattern,
		MinLength: DefaultPasswordMinLength,
		MaxLength: DefaultPasswordMaxLength,
	}
	if err := util.ValidatePassword(actor.Password, config); err != nil {
		return ErrActorInvalidPassport.ReplaceMsg(err.Error())
	}

	return nil
}

func (actor ActorLoginParams) Check() error {
	// Validate email format
	if err := util.ValidateEmail(actor.Email); err != nil {
		return ErrActorInvalidEmail
	}

	// Validate password using default pattern
	config := &util.PasswordConfig{
		Pattern:   DefaultPasswordPattern,
		MinLength: DefaultPasswordMinLength,
		MaxLength: DefaultPasswordMaxLength,
	}
	if err := util.ValidatePassword(actor.Password, config); err != nil {
		return ErrActorInvalidPassword
	}

	return nil
}
