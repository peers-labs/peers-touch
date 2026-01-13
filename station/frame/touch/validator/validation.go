package validator

import (
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"unicode/utf8"
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

func ValidateName(name string) (string, error) {
	if name == "" {
		return "", errors.New("name cannot be empty")
	}

	charCount := utf8.RuneCountInString(name)
	if charCount < 5 {
		return "", errors.New("name must be at least 5 characters long")
	}
	if charCount > 20 {
		return "", errors.New("name must be no more than 20 characters long")
	}

	encodedName := base64.StdEncoding.EncodeToString([]byte(name))
	return encodedName, nil
}

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

func ValidateEmail(email string) error {
	if email == "" {
		return errors.New("email cannot be empty")
	}

	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	if !emailRegex.MatchString(email) {
		return errors.New("invalid email format")
	}

	return nil
}
