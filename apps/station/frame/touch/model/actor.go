package model

import (
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/validator"
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

// ActorSignParams is the legacy struct-binding shape kept for HTTP form
// compatibility. The proto-backed ActorSignRequest is the canonical
// signup carrier; new code should not depend on this type.
type ActorSignParams struct {
	Params
	Name     string `json:"name" form:"name"`
	Email    string `json:"email" form:"email"`
	Password string `json:"password" form:"password"`
}

type ActorLoginParams struct {
	Params
	Email      string `json:"email" form:"email"`
	Password   string `json:"password" form:"password"`
	DeviceType string `json:"device_type" form:"device_type"` // "desktop" | "mobile" | "web"
}

func (actor ActorSignParams) Check() error {
	if err := validator.ValidateName(actor.Name); err != nil {
		return err
	}

	if err := validator.ValidateEmail(actor.Email); err != nil {
		return ErrActorInvalidEmail
	}

	config := &validator.PasswordConfig{
		Pattern:   DefaultPasswordPattern,
		MinLength: DefaultPasswordMinLength,
		MaxLength: DefaultPasswordMaxLength,
	}
	if err := validator.ValidatePassword(actor.Password, config); err != nil {
		return ErrActorInvalidPassport.ReplaceMsg(err.Error())
	}

	return nil
}

func (actor ActorLoginParams) Check() error {
	val := strings.TrimSpace(actor.Email)
	if val == "" {
		return ErrActorInvalidEmail
	}
	if strings.Contains(val, "@") {
		if err := validator.ValidateEmail(val); err != nil {
			return ErrActorInvalidEmail
		}
	} else {
		// treat as username identifier; minimal non-empty check
		if len(val) < 1 {
			return ErrActorInvalidEmail
		}
	}

	// For login, only check password is not empty (no format validation)
	// Password format is validated on registration, not login
	if strings.TrimSpace(actor.Password) == "" {
		return ErrActorInvalidPassword
	}

	return nil
}
