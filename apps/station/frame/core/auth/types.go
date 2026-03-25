package auth

import "time"

type Method string

const (
	MethodJWT         Method = "jwt"
	MethodOAuth2      Method = "oauth2"
	MethodConnections Method = "connections"
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
