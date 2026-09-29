package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"os"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"

	"gorm.io/gorm"
)

var (
	ErrBridgeSignatureInvalid = errors.New("invalid HMAC signature")
	ErrBridgeTimestampExpired = errors.New("timestamp expired")
	ErrBridgeTimestampInvalid = errors.New("invalid timestamp format")
)

const bridgeTimestampWindow = 5 * time.Minute

// VerifyBridgeSignature validates the HMAC-SHA256 signature and timestamp window.
// When no secret is configured (dev mode), verification is skipped.
func VerifyBridgeSignature(req *model.OAuthBridgeRequest) error {
	secret := os.Getenv("PEERS_OAUTH_BRIDGE_SECRET")
	if secret == "" {
		return nil
	}

	ts, err := time.Parse(time.RFC3339, req.GetTs())
	if err != nil {
		return ErrBridgeTimestampInvalid
	}
	if time.Since(ts).Abs() > bridgeTimestampWindow {
		return ErrBridgeTimestampExpired
	}

	message := fmt.Sprintf("%s:%s:%s:%s",
		req.GetProvider(), req.GetProviderUserId(), req.GetEmail(), req.GetTs())

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(req.GetSig())) {
		return ErrBridgeSignatureInvalid
	}
	return nil
}

// ResolveOAuthBridgeActor resolves the provider identity without creating a
// session. OAuth attempt flows use this boundary so later Access Gates can run
// before any business credential exists.
func ResolveOAuthBridgeActor(ctx context.Context, req *model.OAuthBridgeRequest, baseURL string) (*db.Actor, error) {
	identity := &coreauth.OAuth2Identity{
		ProviderID:     coreauth.OAuth2ProviderID(req.GetProvider()),
		ProviderUserID: req.GetProviderUserId(),
		Username:       req.GetUsername(),
		DisplayName:    req.GetDisplayName(),
		AvatarURL:      req.GetAvatarUrl(),
		Email:          req.GetEmail(),
	}
	return ResolveOAuthIdentityActor(ctx, identity, baseURL)
}

// ResolveOAuthIdentityActor performs find-or-register and provider binding
// without issuing a token or creating a session.
func ResolveOAuthIdentityActor(
	ctx context.Context,
	identity *coreauth.OAuth2Identity,
	baseURL string,
) (*db.Actor, error) {
	if identity == nil || identity.ProviderID == "" || identity.ProviderUserID == "" || identity.Email == "" {
		return nil, fmt.Errorf("OAuth identity provider, provider user ID, and email are required")
	}

	identityStore := GetOAuth2IdentityStore()

	_, actorID, err := identityStore.GetByProviderUser(
		ctx,
		identity.ProviderID,
		identity.ProviderUserID,
	)

	var actorRow *db.Actor

	if err == nil && actorID > 0 {
		actorRow, err = loadActor(ctx, actorID)
		if err != nil {
			return nil, fmt.Errorf("load bound actor: %w", err)
		}
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		actorRow, err = findOrRegisterOAuthActor(ctx, identity, baseURL)
		if err != nil {
			return nil, fmt.Errorf("find-or-register actor: %w", err)
		}
	} else {
		return nil, fmt.Errorf("identity lookup: %w", err)
	}

	isPrimary := actorID == 0
	if err := identityStore.BindActor(ctx, uint64(actorRow.ID), identity, isPrimary); err != nil {
		return nil, fmt.Errorf("bind OAuth identity: %w", err)
	}
	return actorRow, nil
}

// OAuthBridgeLogin preserves the external bridge flow while sharing the
// side-effect-free actor resolution used by native OAuth attempts.
func OAuthBridgeLogin(ctx context.Context, req *model.OAuthBridgeRequest, baseURL, clientIP, userAgent string) (*SessionLoginResult, error) {
	actorRow, err := ResolveOAuthBridgeActor(ctx, req, baseURL)
	if err != nil {
		return nil, err
	}
	return IssueTokenAndSession(ctx, actorRow, clientIP, userAgent, "desktop",
		map[string]interface{}{"auth_method": "oauth", "provider": req.GetProvider()})
}

func loadActor(ctx context.Context, actorID uint64) (*db.Actor, error) {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, err
	}
	var row db.Actor
	if err := rds.WithContext(ctx).Where("id = ?", actorID).First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func findOrRegisterOAuthActor(ctx context.Context, identity *coreauth.OAuth2Identity, baseURL string) (*db.Actor, error) {
	if identity.Email != "" {
		existing, err := actor.GetActorByEmail(ctx, identity.Email)
		if err == nil && existing != nil {
			return existing, nil
		}
	}

	username, err := ensureUniqueUsername(ctx, identity.Username)
	if err != nil {
		return nil, fmt.Errorf("ensure unique username: %w", err)
	}

	password, err := generateOAuthPassword()
	if err != nil {
		return nil, err
	}

	email := identity.Email
	if email == "" {
		email = fmt.Sprintf("%s@oauth.local", username)
	}

	// ActorSignRequest.Check enforces 5–20 char names; OAuth gateway usernames can be short.
	for len(username) < 5 {
		username = username + "0"
	}
	if len(username) > 20 {
		username = username[:20]
	}

	signReq := &model.ActorSignRequest{
		Name:     username,
		Email:    email,
		Password: password,
	}
	if err := signReq.Check(); err != nil {
		return nil, fmt.Errorf("signup params: %w", err)
	}

	if err := actor.SignUp(ctx, signReq, baseURL); err != nil {
		return nil, fmt.Errorf("signup: %w", err)
	}

	registered, err := actor.GetActorByEmail(ctx, email)
	if err != nil {
		return nil, fmt.Errorf("load registered actor: %w", err)
	}
	return registered, nil
}

func ensureUniqueUsername(ctx context.Context, base string) (string, error) {
	if base == "" {
		base = "user"
	}

	_, err := actor.GetActorByUsername(ctx, base)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return base, nil
	}
	if err == nil {
		for range 5 {
			suffix, _ := rand.Int(rand.Reader, big.NewInt(9999))
			candidate := fmt.Sprintf("%s_%04d", base, suffix.Int64())
			_, err := actor.GetActorByUsername(ctx, candidate)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return candidate, nil
			}
		}
		return fmt.Sprintf("%s_%d", base, time.Now().UnixMilli()), nil
	}
	return "", err
}

func generateOAuthPassword() (string, error) {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("generate OAuth account password: %w", err)
	}
	return "A1!" + base64.RawURLEncoding.EncodeToString(random), nil
}
