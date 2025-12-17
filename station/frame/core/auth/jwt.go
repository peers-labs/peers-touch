package auth

import (
	"context"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type jwtProvider struct {
	secret    []byte
	accessTTL time.Duration
}

type jwtClaims struct {
	SubjectID string `json:"subject_id"`
	jwt.RegisteredClaims
}

func NewJWTProvider(secret string, ttl time.Duration) Provider {
	if ttl == 0 {
		ttl = Get().AccessTTL
	}
	return &jwtProvider{secret: []byte(secret), accessTTL: ttl}
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
	tok, err := jwt.ParseWithClaims(token, &jwtClaims{}, func(t *jwt.Token) (interface{}, error) { return p.secret, nil })
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
