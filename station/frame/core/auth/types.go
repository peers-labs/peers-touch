package auth

import "time"

type Method string

const (
	MethodJWT Method = "jwt"
)

type Credentials struct {
	Scheme     string
	Token      string
	SubjectID  string
	Attributes map[string]string
}

type Subject struct {
	ID         string
	Attributes map[string]string
}

type Token struct {
	Value     string
	ExpiresAt time.Time
	Type      string
}
