package model

import (
	"net"
	"regexp"
	"strings"
)

var (
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
)

type UserSignParams struct {
	Params
	Name     string `json:"name" form:"name"`
	Email    string `json:"email" form:"email"`
	Password string `json:"password" form:"password"`
}

func (user UserSignParams) Check() error {
	if user.Name == "" {
		return ErrUserInvalidName
	}

	// check email format
	if !validateEmail(user.Email) {
		return ErrUserInvalidEmail
	}
	return nil
}

// validateEmail checks both format and domain existence
func validateEmail(email string) bool {
	// Basic format check
	if !emailRegex.MatchString(email) {
		return false
	}

	// Domain verification
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return false
	}

	// Check MX records
	mx, err := net.LookupMX(parts[1])
	if err != nil || len(mx) == 0 {
		// Fallback to A/AAAA record check
		_, err := net.LookupIP(parts[1])
		return err == nil
	}

	return true
}
