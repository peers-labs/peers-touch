package model

import (
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/validator"
)

// Check implements Params for ActorSignRequest.
//
// Reason: previous implementation called ValidateName for its side
// effect of base64-encoding the username back onto the request, which
// poisoned downstream PTID handle generation. ValidateName is now a
// pure validator (see frame/touch/validator); Check therefore only
// asserts shape and applies semantic defaults — Name is left as the
// caller wrote it, in canonical handle form.
func (m *ActorSignRequest) Check() error {
	if err := validator.ValidateName(m.Name); err != nil {
		return err
	}
	m.Name = strings.TrimSpace(m.Name)

	if err := validator.ValidateEmail(m.Email); err != nil {
		return ErrActorInvalidEmail
	}

	cfg := &validator.PasswordConfig{
		Pattern:   DefaultPasswordPattern,
		MinLength: DefaultPasswordMinLength,
		MaxLength: DefaultPasswordMaxLength,
	}
	if err := validator.ValidatePassword(m.Password, cfg); err != nil {
		return ErrActorInvalidPassport.ReplaceMsg(err.Error())
	}

	if strings.TrimSpace(m.Namespace) == "" {
		m.Namespace = "peers"
	}
	// If proto kind is explicit, SignUp uses it; else legacy account_type (default Person).
	if m.GetKind() == ActorKind_ACTOR_KIND_UNSPECIFIED {
		if strings.TrimSpace(m.AccountType) == "" {
			m.AccountType = "Person"
		}
	}

	return nil
}
