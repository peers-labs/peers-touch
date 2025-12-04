package model

import (
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/util"
)

// Check implements Params for ActorSignRequest
func (m *ActorSignRequest) Check() error {
	// Validate and normalize name (base64-encoded)
	encodedName, err := util.ValidateName(m.Name)
	if err != nil {
		return err
	}
	m.Name = encodedName

	// Validate email
	if err := util.ValidateEmail(m.Email); err != nil {
		return ErrActorInvalidEmail
	}

	// Validate password using default policy
	cfg := &util.PasswordConfig{
		Pattern:   DefaultPasswordPattern,
		MinLength: DefaultPasswordMinLength,
		MaxLength: DefaultPasswordMaxLength,
	}
	if err := util.ValidatePassword(m.Password, cfg); err != nil {
		return ErrActorInvalidPassport.ReplaceMsg(err.Error())
	}

	// Optional defaults
	if strings.TrimSpace(m.Namespace) == "" {
		m.Namespace = "peers"
	}
	if strings.TrimSpace(m.AccountType) == "" {
		m.AccountType = "Person"
	}

	return nil
}
