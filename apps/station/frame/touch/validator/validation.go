package validator

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

type PasswordConfig struct {
	Pattern   string
	MinLength int
	MaxLength int
}

func ValidatePassword(password string, config *PasswordConfig) error {
	if password == "" {
		return errors.New("password cannot be empty")
	}

	if config == nil {
		config = &PasswordConfig{
			Pattern:   `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`,
			MinLength: 8,
			MaxLength: 20,
		}
	}

	if len(password) < config.MinLength {
		return errors.New("password is too short")
	}
	if len(password) > config.MaxLength {
		return errors.New("password is too long")
	}

	matched, err := regexp.MatchString(config.Pattern, password)
	if err != nil {
		return fmt.Errorf("invalid password pattern[%s] configuration: %+v", config.Pattern, err)
	}
	if !matched {
		return errors.New("password contains invalid characters")
	}

	hasNumber := regexp.MustCompile(`[0-9]`).MatchString(password)
	hasLetter := regexp.MustCompile(`[a-zA-Z]`).MatchString(password)
	hasSymbol := regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]`).MatchString(password)

	var missing []string
	if !hasNumber {
		missing = append(missing, "numbers")
	}
	if !hasLetter {
		missing = append(missing, "English letters")
	}
	if !hasSymbol {
		missing = append(missing, "symbols")
	}

	if len(missing) > 0 {
		var errorMsg string
		if len(missing) == 1 {
			errorMsg = "password is missing " + missing[0]
		} else if len(missing) == 2 {
			errorMsg = "password is missing " + missing[0] + " and " + missing[1]
		} else {
			errorMsg = "password is missing " + missing[0] + ", " + missing[1] + " and " + missing[2]
		}
		return errors.New(errorMsg)
	}

	return nil
}

// usernameRegex defines the canonical character set for a Peers-Touch
// preferred_username (a.k.a. handle). It is a strict subset of the PTID
// username grammar (`^[a-z0-9._\-]{1,32}$` — see
// activitypub/identity/ptid.go) intentionally tightened to 5..20 chars
// for the signup form so the same string can be re-used as both the
// PTID username segment and the federated handle without a second
// transformation step.
//
// The class is ASCII-only on purpose: handles travel through URLs,
// `acct:` URIs, DHT keys, and cross-station logs, where mixed-script
// rendering is a phishing risk and case-folding rules diverge per
// language. Display names (UTF-8 free-form) are a separate concern and
// are not validated by this function.
var usernameRegex = regexp.MustCompile(`^[a-z0-9._\-]{5,20}$`)

// ValidateName validates a Peers-Touch handle/username.
//
// Contract:
//   - Pure: no transformation, no side effects on the caller's value.
//   - Strict: ASCII-only `[a-z0-9._-]`, length 5..20 inclusive.
//   - Single source of truth for handle shape on the signup boundary.
//
// Returning a formatted string from this function (legacy behaviour) was
// architecturally wrong: it conflated validation with a base64 transform
// that had no decode counterpart in any code path, producing unreadable
// `preferred_username` rows and breaking PTID's downstream regex check.
func ValidateName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("name cannot be empty")
	}
	if !usernameRegex.MatchString(name) {
		return errors.New("name must be 5-20 characters of lowercase letters, digits, '.', '_' or '-'")
	}
	return nil
}

func ValidateEmail(email string) error {
	if email == "" {
		return errors.New("email cannot be empty")
	}

	// Allow TLD with 1+ characters for development/testing (e.g., a@p.t)
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]+$`)
	if !emailRegex.MatchString(email) {
		return errors.New("invalid email format")
	}

	return nil
}
