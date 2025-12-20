package auth

import (
	"context"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type jwtProvider struct {
	secret     []byte
	prevSecret []byte
	accessTTL  time.Duration
}

type jwtClaims struct {
	SubjectID string `json:"subject_id"`
	jwt.RegisteredClaims
}

type Option func(*jwtProvider)

func WithPreviousSecret(secret string) Option {
	return func(p *jwtProvider) {
		p.prevSecret = []byte(secret)
	}
}

func NewJWTProvider(secret string, ttl time.Duration, opts ...Option) Provider {
	if ttl == 0 {
		ttl = Get().AccessTTL
	}
	p := &jwtProvider{secret: []byte(secret), accessTTL: ttl}
	for _, opt := range opts {
		opt(p)
	}
	// Auto-load previous secret from config if not set and available
	if len(p.prevSecret) == 0 {
		if prev := Get().PreviousSecret; prev != "" {
			p.prevSecret = []byte(prev)
		}
	}
	return p
}

func (p *jwtProvider) Method() Method { return MethodJWT }

func (p *jwtProvider) Authenticate(ctx context.Context, cred Credentials) (*Subject, *Token, error) {
	now := time.Now()
	exp := now.Add(p.accessTTL)
	claims := jwtClaims{SubjectID: cred.SubjectID, RegisteredClaims: jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(exp)}}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := t.SignedString(p.secret)
	if err != nil {
		return nil, nil, err
	}
	return &Subject{ID: cred.SubjectID, Attributes: cred.Attributes}, &Token{Value: s, ExpiresAt: exp, Type: "Bearer"}, nil
}

func (p *jwtProvider) Validate(ctx context.Context, token string) (*Subject, error) {
	// Try primary secret
	tok, err := jwt.ParseWithClaims(token, &jwtClaims{}, func(t *jwt.Token) (interface{}, error) { return p.secret, nil })
	
	// If failed and we have a previous secret, try that
	if err != nil && len(p.prevSecret) > 0 {
		tok, err = jwt.ParseWithClaims(token, &jwtClaims{}, func(t *jwt.Token) (interface{}, error) { return p.prevSecret, nil })
	}

	if err != nil {
		return nil, err
	}
	c, ok := tok.Claims.(*jwtClaims)
	if !ok || !tok.Valid {
		return nil, err
	}
	return &Subject{ID: c.SubjectID, Attributes: map[string]string{}}, nil
}

func (p *jwtProvider) Revoke(ctx context.Context, token string) error { return nil }
