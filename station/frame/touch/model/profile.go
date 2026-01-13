package model

import (
	"errors"
	"regexp"
)

// ProfileGetResponse represents the response for getting actor profile
type ProfileGetResponse struct {
	ProfilePhoto string `json:"profile_photo"`
	Name         string `json:"name"`
	Gender       Gender `json:"gender"`
	Region       string `json:"region"`
	Email        string `json:"email"`
	PeersID      string `json:"peers_id"`
	WhatsUp      string `json:"whats_up"`
}

// ProfileUpdateParams represents the parameters for updating actor profile
type ProfileUpdateParams struct {
	ProfilePhoto *string `json:"profile_photo,omitempty"`
	Gender       *Gender `json:"gender,omitempty"`
	Region       *string `json:"region,omitempty"`
	Email        *string `json:"email,omitempty"`
	WhatsUp      *string `json:"whats_up,omitempty"`
}

// Validate validates the profile update parameters
func (p *ProfileUpdateParams) Validate() error {
	// Validate gender if provided
	if p.Gender != nil {
		switch *p.Gender {
		case GenderMale, GenderFemale, GenderOther:
			// Valid gender
		default:
			return errors.New("invalid gender value")
		}
	}

	// Validate email format if provided
	if p.Email != nil && *p.Email != "" {
		emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
		if !emailRegex.MatchString(*p.Email) {
			return errors.New("invalid email format")
		}
	}

	// Validate region length if provided
	if p.Region != nil && len(*p.Region) > 100 {
		return errors.New("region too long (max 100 characters)")
	}

	// Validate what's up message length if provided
	if p.WhatsUp != nil && len(*p.WhatsUp) > 1000 {
		return errors.New("what's up message too long (max 1000 characters)")
	}

	// Validate profile photo URL if provided
	if p.ProfilePhoto != nil && len(*p.ProfilePhoto) > 500 {
		return errors.New("profile photo URL too long (max 500 characters)")
	}

	return nil
}

// ValidatePeersID validates the peers ID format
func ValidatePeersID(peersID string) error {
	if peersID == "" {
		return errors.New("peers ID cannot be empty")
	}

	// Peers ID should be alphanumeric and underscores, 3-50 characters
	peersIDRegex := regexp.MustCompile(`^[a-zA-Z0-9_]{3,50}$`)
	if !peersIDRegex.MatchString(peersID) {
		return errors.New("peers ID must be 3-50 characters, alphanumeric and underscores only")
	}

	return nil
}
