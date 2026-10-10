package crypto

import (
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// PasswordHashCost is the single bcrypt work-factor used for every Peers
// password hash (actors, dashboard admins, and seeded accounts).
const PasswordHashCost = 12

// HashPassword generates a bcrypt hash for the given plain-text password.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), PasswordHashCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(bytes), nil
}

// VerifyPassword reports whether plain-text password matches the bcrypt hash.
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
