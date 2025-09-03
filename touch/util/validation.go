package util

import (
	"encoding/base64"
	"errors"
	"regexp"
	"unicode/utf8"
)

// PasswordConfig holds password validation configuration
type PasswordConfig struct {
	// Pattern is the regex pattern for password validation
	Pattern string
	// MinLength is the minimum password length
	MinLength int
	// MaxLength is the maximum password length
	MaxLength int
}

// ValidatePassword validates password using the provided configuration
func ValidatePassword(password string, config *PasswordConfig) error {
	if password == "" {
		return errors.New("password cannot be empty")
	}

	// Use default config if not provided
	if config == nil {
		config = &PasswordConfig{
			Pattern:   `^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\|,.<>/?]{8,20}$`,
			MinLength: 8,
			MaxLength: 20,
		}
	}
	
	// Check length
	if len(password) < config.MinLength {
		return errors.New("password is too short")
	}
	if len(password) > config.MaxLength {
		return errors.New("password is too long")
	}

	// Validate against regex pattern
	matched, err := regexp.MatchString(config.Pattern, password)
	if err != nil {
		return errors.New("invalid password pattern configuration")
	}
	if !matched {
		return errors.New("password contains invalid characters")
	}
	
	// Check for required character types (numbers, letters, symbols)
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



// ValidateName validates and encodes name to base64
func ValidateName(name string) (string, error) {
	if name == "" {
		return "", errors.New("name cannot be empty")
	}

	// Check UTF-8 character count (not byte length)
	charCount := utf8.RuneCountInString(name)
	if charCount < 5 {
		return "", errors.New("name must be at least 5 characters long")
	}
	if charCount > 20 {
		return "", errors.New("name must be no more than 20 characters long")
	}

	// Encode to base64
	encodedName := base64.StdEncoding.EncodeToString([]byte(name))
	return encodedName, nil
}

// DecodeName decodes base64 encoded name back to original string
func DecodeName(encodedName string) (string, error) {
	if encodedName == "" {
		return "", errors.New("encoded name cannot be empty")
	}

	decodedBytes, err := base64.StdEncoding.DecodeString(encodedName)
	if err != nil {
		return "", errors.New("invalid base64 encoded name")
	}

	return string(decodedBytes), nil
}

// ValidateEmail validates email format using standard regex
func ValidateEmail(email string) error {
	if email == "" {
		return errors.New("email cannot be empty")
	}

	// Standard email regex pattern
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	if !emailRegex.MatchString(email) {
		return errors.New("invalid email format")
	}

	return nil
}