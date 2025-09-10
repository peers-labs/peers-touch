package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/dirty-bro-tech/peers-touch-go/touch/model/db"
)

// JWTProvider implements JWT authentication
type JWTProvider struct {
	db            *gorm.DB
	secret        []byte
	expiry        time.Duration
	refreshExpiry time.Duration
}

// JWTClaims represents JWT token claims
type JWTClaims struct {
	ActorID uint64 `json:"actor_id"`
	Email   string `json:"email"`
	jwt.RegisteredClaims
}

// NewJWTProvider creates a new JWT authentication provider
func NewJWTProvider(db *gorm.DB, secret string, expiry, refreshExpiry time.Duration) *JWTProvider {
	// If no secret provided, generate a random one (not recommended for production)
	var secretBytes []byte
	if secret == "" {
		secretBytes = make([]byte, 32)
		rand.Read(secretBytes)
	} else {
		secretBytes = []byte(secret)
	}

	// Default expiry times
	if expiry == 0 {
		expiry = 24 * time.Hour // 24 hours
	}
	if refreshExpiry == 0 {
		refreshExpiry = 7 * 24 * time.Hour // 7 days
	}

	return &JWTProvider{
		db:            db,
		secret:        secretBytes,
		expiry:        expiry,
		refreshExpiry: refreshExpiry,
	}
}

// GetMethod returns the authentication method
func (j *JWTProvider) GetMethod() AuthMethod {
	return AuthMethodJWT
}

// Authenticate validates user credentials and returns JWT tokens
func (j *JWTProvider) Authenticate(ctx context.Context, credentials *Credentials) (*AuthResult, error) {
	if credentials.Email == "" || credentials.Password == "" {
		return nil, ErrInvalidCredentials
	}

	// Find user by email
	var user db.Actor
	err := j.db.WithContext(ctx).Where("email = ?", credentials.Email).First(&user).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("database error: %w", err)
	}

	// Verify password
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(credentials.Password))
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	// Generate access token
	accessToken, expiresAt, err := j.generateToken(user.ID, user.Email, j.expiry)
	if err != nil {
		return nil, fmt.Errorf("failed to generate access token: %w", err)
	}

	// Generate refresh token
	refreshToken, _, err := j.generateToken(user.ID, user.Email, j.refreshExpiry)
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token: %w", err)
	}

	return &AuthResult{
		Actor:        &user,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
		TokenType:    "Bearer",
	}, nil
}

// ValidateToken validates a JWT token and returns user info
func (j *JWTProvider) ValidateToken(ctx context.Context, tokenString string) (*TokenInfo, error) {
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return j.secret, nil
	})

	if err != nil {
		return nil, ErrJWTParsingFailed
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	// Check if token is expired
	if claims.ExpiresAt != nil && claims.ExpiresAt.Time.Before(time.Now()) {
		return nil, ErrTokenExpired
	}

	return &TokenInfo{
		ActorID:   claims.ActorID,
		Email:     claims.Email,
		ExpiresAt: claims.ExpiresAt.Time,
		IssuedAt:  claims.IssuedAt.Time,
	}, nil
}

// RefreshToken refreshes an existing token
func (j *JWTProvider) RefreshToken(ctx context.Context, refreshToken string) (*AuthResult, error) {
	// Validate the refresh token
	tokenInfo, err := j.ValidateToken(ctx, refreshToken)
	if err != nil {
		return nil, err
	}

	// Get user from database
	var user db.Actor
	err = j.db.WithContext(ctx).Where("id = ?", tokenInfo.ActorID).First(&user).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("database error: %w", err)
	}

	// Generate new access token
	accessToken, expiresAt, err := j.generateToken(user.ID, user.Email, j.expiry)
	if err != nil {
		return nil, fmt.Errorf("failed to generate access token: %w", err)
	}

	// Generate new refresh token
	newRefreshToken, _, err := j.generateToken(user.ID, user.Email, j.refreshExpiry)
	if err != nil {
		return nil, fmt.Errorf("failed to generate refresh token: %w", err)
	}

	return &AuthResult{
		Actor:        &user,
		AccessToken:  accessToken,
		RefreshToken: newRefreshToken,
		ExpiresAt:    expiresAt,
		TokenType:    "Bearer",
	}, nil
}

// RevokeToken revokes a token (for JWT, we can't truly revoke without a blacklist)
func (j *JWTProvider) RevokeToken(ctx context.Context, token string) error {
	// For JWT, we would need to implement a token blacklist
	// For now, we'll just validate the token to ensure it's valid
	_, err := j.ValidateToken(ctx, token)
	return err
}

// generateToken generates a JWT token with the given parameters
func (j *JWTProvider) generateToken(userID uint64, email string, expiry time.Duration) (string, time.Time, error) {
	now := time.Now()
	expiresAt := now.Add(expiry)

	claims := &JWTClaims{
		ActorID: userID,
		Email:   email,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			NotBefore: jwt.NewNumericDate(now),
			Issuer:    "peers-touch-go",
			Subject:   fmt.Sprintf("%d", userID),
			ID:        j.generateJTI(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(j.secret)
	if err != nil {
		return "", time.Time{}, ErrJWTSigningFailed
	}

	return tokenString, expiresAt, nil
}

// generateJTI generates a unique JWT ID
func (j *JWTProvider) generateJTI() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
