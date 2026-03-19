package auth

import "context"

type Provider interface {
	Method() Method
	Authenticate(ctx context.Context, cred Credentials) (*Subject, *Token, error)
	Validate(ctx context.Context, token string) (*Subject, error)
	Revoke(ctx context.Context, token string) error
}
