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
	keyring    StationAccessKeyring
	useShared  bool
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

func WithStationAccessKeyring(keyring StationAccessKeyring) Option {
	return func(p *jwtProvider) {
		p.keyring = keyring
	}
}

func NewJWTProvider(secret string, ttl time.Duration, opts ...Option) Provider {
	config := Get()
	if ttl == 0 {
		ttl = config.AccessTTL
	}
	p := &jwtProvider{
		secret:    []byte(secret),
		accessTTL: ttl,
		useShared: secret == config.Secret,
	}
	for _, opt := range opts {
		opt(p)
	}
	// Auto-load previous secret from config if not set and available
	if len(p.prevSecret) == 0 {
		if prev := config.PreviousSecret; prev != "" {
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
	key, err := p.keyringForRequest().Current(ctx)
	if err != nil {
		return nil, nil, err
	}
	t.Header["kid"] = key.ID
	s, err := t.SignedString(key.Material)
	if err != nil {
		return nil, nil, err
	}
	return &Subject{ID: cred.SubjectID, SessionID: cred.SessionID, Attributes: cred.Attributes}, &Token{Value: s, ExpiresAt: exp, Type: "Bearer"}, nil
}

func (p *jwtProvider) Validate(ctx context.Context, token string) (*Subject, error) {
	parser := jwt.NewParser(jwt.WithValidMethods([]string{
		jwt.SigningMethodHS256.Alg(),
	}))
	unverified, _, err := parser.ParseUnverified(token, &jwtClaims{})
	if err != nil {
		return nil, err
	}
	keyID := ""
	if raw, present := unverified.Header["kid"]; present {
		value, ok := raw.(string)
		if !ok || value == "" {
			return nil, errors.New("jwt: invalid key id")
		}
		keyID = value
	}
	keys, err := p.keyringForRequest().ValidationKeys(ctx, keyID)
	if err != nil {
		return nil, err
	}

	var (
		tok     *jwt.Token
		lastErr error
	)
	for _, key := range keys {
		tok, lastErr = parser.ParseWithClaims(
			token,
			&jwtClaims{},
			func(t *jwt.Token) (interface{}, error) {
				if t.Method != jwt.SigningMethodHS256 {
					return nil, errors.New("jwt: invalid signing method")
				}
				if keyID != "" && key.ID != keyID {
					return nil, errors.New("jwt: key id mismatch")
				}
				return key.Material, nil
			},
		)
		if lastErr == nil {
			break
		}
	}
	if lastErr != nil {
		return nil, lastErr
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

func (p *jwtProvider) keyringForRequest() StationAccessKeyring {
	if p.keyring != nil {
		return p.keyring
	}
	if p.useShared {
		if shared := getStationAccessKeyring(); shared != nil {
			return shared
		}
	}
	current := StationAccessKey{
		ID:       stationAccessKeyID(p.secret),
		Material: append([]byte(nil), p.secret...),
	}
	var previous *StationAccessKey
	if len(p.prevSecret) > 0 {
		previous = &StationAccessKey{
			ID:       stationAccessKeyID(p.prevSecret),
			Material: append([]byte(nil), p.prevSecret...),
		}
	}
	return staticStationAccessKeyring{
		current:  current,
		previous: previous,
	}
}
