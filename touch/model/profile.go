package model

import (
	"regexp"

	"github.com/peers-touch/peers-touch-go/touch/model/db"
)

// ProfileGetResponse represents the response for getting actor profile
type ProfileGetResponse struct {
	ProfilePhoto string    `json:"profile_photo"`
	Name         string    `json:"name"`
	Gender       db.Gender `json:"gender"`
	Region       string    `json:"region"`
	Email        string    `json:"email"`
	PeersID      string    `json:"peers_id"`
	WhatsUp      string    `json:"whats_up"`
}

// ProfileUpdateParams represents the parameters for updating actor profile
type ProfileUpdateParams struct {
	ProfilePhoto *string    `json:"profile_photo,omitempty"`
	Gender       *db.Gender `json:"gender,omitempty"`
	Region       *string    `json:"region,omitempty"`
	Email        *string    `json:"email,omitempty"`
	WhatsUp      *string    `json:"whats_up,omitempty"`
}

// Validate validates the profile update parameters
func (p *ProfileUpdateParams) Validate() error {
	// Validate gender if provided
	if p.Gender != nil {
		switch *p.Gender {
		case db.GenderMale, db.GenderFemale, db.GenderOther:
			// Valid gender
		default:
			return NewError("t20001", "Invalid gender value")
		}
	}

	// Validate email format if provided
	if p.Email != nil && *p.Email != "" {
		emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
		if !emailRegex.MatchString(*p.Email) {
			return NewError("t20002", "Invalid email format")
		}
	}

	// Validate region length if provided
	if p.Region != nil && len(*p.Region) > 100 {
		return NewError("t20003", "Region too long (max 100 characters)")
	}

	// Validate what's up message length if provided
	if p.WhatsUp != nil && len(*p.WhatsUp) > 1000 {
		return NewError("t20004", "What's up message too long (max 1000 characters)")
	}

	// Validate profile photo URL if provided
	if p.ProfilePhoto != nil && len(*p.ProfilePhoto) > 500 {
		return NewError("t20005", "Profile photo URL too long (max 500 characters)")
	}

	return nil
}

// ValidatePeersID validates the peers ID format
func ValidatePeersID(peersID string) error {
	if peersID == "" {
		return NewError("t20006", "Peers ID cannot be empty")
	}

	// Peers ID should be alphanumeric and underscores, 3-50 characters
	peersIDRegex := regexp.MustCompile(`^[a-zA-Z0-9_]{3,50}$`)
	if !peersIDRegex.MatchString(peersID) {
		return NewError("t20007", "Peers ID must be 3-50 characters, alphanumeric and underscores only")
	}

	return nil
}
