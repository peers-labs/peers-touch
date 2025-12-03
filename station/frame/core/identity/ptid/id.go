package ptid

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// PTID represents a peers-touch identity identifier
// Format: ptid:v1:actor:<namespace>:<type>:<username>:<fingerprint>
type PTID struct {
	Version     string
	Namespace   string
	Type        AccountType
	Username    string
	Fingerprint string
}

type AccountType string

const (
	TypePerson       AccountType = "p"
	TypeGroup        AccountType = "g"
	TypeOrganization AccountType = "o"
	TypeService      AccountType = "s"
	TypeApplication  AccountType = "a"
)

var (
	// Regex for validation
	namespaceRegex = regexp.MustCompile(`^[a-z0-9._\-/]+$`)
	usernameRegex  = regexp.MustCompile(`^[a-z0-9._\-]{1,32}$`)

	ErrInvalidFormat    = errors.New("invalid PTID format")
	ErrInvalidVersion   = errors.New("unsupported PTID version")
	ErrInvalidNamespace = errors.New("invalid namespace format")
	ErrInvalidType      = errors.New("invalid account type")
	ErrInvalidUsername  = errors.New("invalid username format")
)

// Parse parses a string into a PTID
func Parse(s string) (*PTID, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 7 {
		return nil, ErrInvalidFormat
	}

	if parts[0] != "ptid" {
		return nil, ErrInvalidFormat
	}

	if parts[1] != "v1" {
		return nil, ErrInvalidVersion
	}

	if parts[2] != "actor" {
		return nil, ErrInvalidFormat
	}

	id := &PTID{
		Version:     parts[1],
		Namespace:   parts[3],
		Type:        AccountType(parts[4]),
		Username:    parts[5],
		Fingerprint: parts[6],
	}

	if err := id.Validate(); err != nil {
		return nil, err
	}

	return id, nil
}

// String returns the string representation of the PTID
func (id *PTID) String() string {
	return fmt.Sprintf("ptid:%s:actor:%s:%s:%s:%s",
		id.Version,
		id.Namespace,
		id.Type,
		id.Username,
		id.Fingerprint,
	)
}

// Validate validates the PTID fields
func (id *PTID) Validate() error {
	if id.Version != "v1" {
		return ErrInvalidVersion
	}

	if !namespaceRegex.MatchString(id.Namespace) {
		return ErrInvalidNamespace
	}

	switch id.Type {
	case TypePerson, TypeGroup, TypeOrganization, TypeService, TypeApplication:
		// valid
	default:
		return ErrInvalidType
	}

	if !usernameRegex.MatchString(id.Username) {
		return ErrInvalidUsername
	}

	if id.Fingerprint == "" {
		return errors.New("fingerprint cannot be empty")
	}

	return nil
}
