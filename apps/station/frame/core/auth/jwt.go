package auth

import (
	"context"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type jwtProvider struct {
	secret     []byte
	prevSecret []byte
	accessTTL  time.Duration
}

type jwtClaims struct {
	SubjectPTID string `json:"subject_ptid"`
	SessionID   string `json:"session_id,omitempty"`
	// Attributes carries arbitrary string→string metadata the
	// caller passed via Credentials.Attributes. Round-tripped
	// verbatim. Intended for per-module business fields
	// (admin_id, role, username, …) that the receiver wants
	// without re-querying the DB. Optional; tokens minted before
	// this field existed deserialise with Attributes == nil.
	Attributes map[string]string `json:"attrs,omitempty"`
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
	claims := jwtClaims{
		SubjectPTID:      cred.SubjectID,
		SessionID:        cred.SessionID,
		Attributes:       cred.Attributes,
		RegisteredClaims: jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(exp)},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := t.SignedString(p.secret)
	if err != nil {
		return nil, nil, err
	}
	return &Subject{ID: cred.SubjectID, SessionID: cred.SessionID, Attributes: cred.Attributes}, &Token{Value: s, ExpiresAt: exp, Type: "Bearer"}, nil
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
		return nil, errors.New("jwt: invalid claims")
	}
	if c.SubjectPTID == "" {
		return nil, errors.New("jwt: subject_ptid is required")
	}
	attrs := c.Attributes
	if attrs == nil {
		attrs = map[string]string{}
	}
	return &Subject{ID: c.SubjectPTID, SessionID: c.SessionID, Attributes: attrs}, nil
}

func (p *jwtProvider) Revoke(ctx context.Context, token string) error { return nil }
