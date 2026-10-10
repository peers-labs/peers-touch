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
	"net/url"
	"os"
	"strings"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthbridge "github.com/peers-labs/peers-touch/station/frame/touch/model/oauthbridge"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrBridgeSecretMissing     = errors.New("OAuth bridge secret is not configured")
	ErrBridgeVersionInvalid    = errors.New("unsupported OAuth bridge version")
	ErrBridgeRequestInvalid    = errors.New("invalid OAuth bridge request")
	ErrBridgeSignatureInvalid  = errors.New("invalid HMAC signature")
	ErrBridgeTimestampExpired  = errors.New("timestamp expired")
	ErrBridgeTimestampInvalid  = errors.New("invalid timestamp format")
	ErrBridgePurposeInvalid    = errors.New("invalid OAuth bridge purpose")
	ErrBridgeAssertionReplayed = errors.New("OAuth bridge assertion already consumed")
	ErrOAuthIdentityConflict   = coreauth.ErrOAuthIdentityConflict
)

const (
	bridgeTimestampWindow = 5 * time.Minute
	bridgeReplayRetention = 2 * bridgeTimestampWindow
)

// VerifyBridgeSignature validates the versioned canonical HMAC assertion.
func VerifyBridgeSignature(req *oauthbridge.BrokerOAuthBridgeRequest) error {
	secret := strings.TrimSpace(os.Getenv("PEERS_OAUTH_BRIDGE_SECRET"))
	if secret == "" {
		return ErrBridgeSecretMissing
	}
	if req == nil ||
		req.GetBridgeVersion() != "v1" ||
		strings.TrimSpace(req.GetSiteId()) == "" ||
		!validBridgeAssertionID(req.GetAssertionId()) ||
		strings.TrimSpace(req.GetReceiverId()) == "" ||
		!validBridgeReceiverProof(
			req.GetReceiverChallenge(),
			req.GetReceiverVerifier(),
		) ||
		strings.TrimSpace(req.GetProvider()) == "" ||
		strings.TrimSpace(req.GetProviderUserId()) == "" ||
		strings.TrimSpace(req.GetTs()) == "" ||
		strings.TrimSpace(req.GetSig()) == "" {
		if req != nil && req.GetBridgeVersion() != "v1" {
			return ErrBridgeVersionInvalid
		}
		return ErrBridgeRequestInvalid
	}
	if req.GetPurpose() != "account_login" && req.GetPurpose() != "connector_link" {
		return ErrBridgePurposeInvalid
	}
	if req.GetEmailVerified() != (strings.TrimSpace(req.GetEmail()) != "") {
		return ErrBridgeRequestInvalid
	}

	ts, err := time.Parse(time.RFC3339, req.GetTs())
	if err != nil {
		return ErrBridgeTimestampInvalid
	}
	if time.Since(ts).Abs() > bridgeTimestampWindow {
		return ErrBridgeTimestampExpired
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonicalBridgePayload(req)))
	provided, err := hex.DecodeString(req.GetSig())
	if err != nil || len(provided) != sha256.Size {
		return ErrBridgeSignatureInvalid
	}

	if !hmac.Equal(mac.Sum(nil), provided) {
		return ErrBridgeSignatureInvalid
	}
	return nil
}

func canonicalBridgePayload(req *oauthbridge.BrokerOAuthBridgeRequest) string {
	values := url.Values{
		"bridge_version":     []string{req.GetBridgeVersion()},
		"site_id":            []string{req.GetSiteId()},
		"purpose":            []string{req.GetPurpose()},
		"assertion_id":       []string{req.GetAssertionId()},
		"receiver_id":        []string{req.GetReceiverId()},
		"receiver_challenge": []string{req.GetReceiverChallenge()},
		"provider":           []string{req.GetProvider()},
		"provider_user_id":   []string{req.GetProviderUserId()},
		"email_verified":     []string{fmt.Sprintf("%t", req.GetEmailVerified())},
		"ts":                 []string{req.GetTs()},
	}
	optional := map[string]string{
		"union_id":     req.GetUnionId(),
		"username":     req.GetUsername(),
		"display_name": req.GetDisplayName(),
		"avatar_url":   req.GetAvatarUrl(),
		"email":        req.GetEmail(),
	}
	for key, value := range optional {
		if value != "" {
			values.Set(key, value)
		}
	}
	return values.Encode()
}

func validBridgeReceiverProof(challenge, verifier string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(challenge))
	if err != nil || len(decoded) != sha256.Size || strings.TrimSpace(verifier) == "" {
		return false
	}
	actual := sha256.Sum256([]byte(verifier))
	return hmac.Equal(decoded, actual[:])
}

func validBridgeAssertionID(value string) bool {
	decoded, err := hex.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == sha256.Size
}

func consumeOAuthBridgeAssertion(
	ctx context.Context,
	rds *gorm.DB,
	req *oauthbridge.BrokerOAuthBridgeRequest,
) error {
	if rds == nil || req == nil || !validBridgeAssertionID(req.GetAssertionId()) {
		return ErrBridgeRequestInvalid
	}
	assertedAt, err := time.Parse(time.RFC3339, req.GetTs())
	if err != nil {
		return ErrBridgeTimestampInvalid
	}
	sum := sha256.Sum256([]byte(req.GetAssertionId()))
	consumedAt := time.Now().UTC()
	record := db.OAuthBridgeAssertion{
		ID:         hex.EncodeToString(sum[:]),
		Purpose:    req.GetPurpose(),
		ConsumedAt: consumedAt,
		ExpiresAt:  assertedAt.Add(bridgeReplayRetention),
	}
	return rds.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at < ?", consumedAt).
			Delete(&db.OAuthBridgeAssertion{}).Error; err != nil {
			return fmt.Errorf("delete expired OAuth bridge assertions: %w", err)
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&record)
		if result.Error != nil {
			return fmt.Errorf("consume OAuth bridge assertion: %w", result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrBridgeAssertionReplayed
		}
		return nil
	})
}

func consumeOAuthBridgeAssertionFromStore(
	ctx context.Context,
	req *oauthbridge.BrokerOAuthBridgeRequest,
) error {
	rds, err := store.GetRDS(ctx)
	if err != nil {
		return err
	}
	return consumeOAuthBridgeAssertion(ctx, rds, req)
}

// ConsumeOAuthBridgeAssertion durably fences one account-login assertion
// before actor resolution or OAuth candidate creation.
func ConsumeOAuthBridgeAssertion(
	ctx context.Context,
	req *oauthbridge.BrokerOAuthBridgeRequest,
) error {
	if req == nil || req.GetPurpose() != "account_login" {
		return ErrBridgePurposeInvalid
	}
	return consumeOAuthBridgeAssertionFromStore(ctx, req)
}

// ResolveOAuthBridgeActor resolves the provider identity without creating a
// session. OAuth attempt flows use this boundary so later Access Gates can run
// before any business credential exists.
func ResolveOAuthBridgeActor(ctx context.Context, req *oauthbridge.BrokerOAuthBridgeRequest, baseURL string) (*db.Actor, error) {
	identity, err := BridgeIdentity(req)
	if err != nil {
		return nil, err
	}
	return ResolveOAuthIdentityActor(ctx, identity, baseURL)
}

// BridgeIdentity converts a verified broker assertion into provider identity
// input without mutating actor or session state.
func BridgeIdentity(req *oauthbridge.BrokerOAuthBridgeRequest) (*coreauth.OAuth2Identity, error) {
	if req == nil ||
		strings.TrimSpace(req.GetProvider()) == "" ||
		strings.TrimSpace(req.GetProviderUserId()) == "" ||
		req.GetEmailVerified() != (strings.TrimSpace(req.GetEmail()) != "") {
		return nil, ErrBridgeRequestInvalid
	}
	return &coreauth.OAuth2Identity{
		ProviderID:     coreauth.OAuth2ProviderID(req.GetProvider()),
		ProviderUserID: req.GetProviderUserId(),
		ProviderUnion:  req.GetUnionId(),
		Username:       req.GetUsername(),
		DisplayName:    req.GetDisplayName(),
		AvatarURL:      req.GetAvatarUrl(),
		Email:          req.GetEmail(),
		EmailVerified:  req.GetEmailVerified(),
	}, nil
}

func bridgeIdentity(req *oauthbridge.BrokerOAuthBridgeRequest) (*coreauth.OAuth2Identity, error) {
	return BridgeIdentity(req)
}

// ResolveOAuthIdentityActor performs find-or-register and provider binding
// without issuing a token or creating a session.
func ResolveOAuthIdentityActor(
	ctx context.Context,
	identity *coreauth.OAuth2Identity,
	baseURL string,
) (*db.Actor, error) {
	if identity == nil || identity.ProviderID == "" || identity.ProviderUserID == "" {
		return nil, fmt.Errorf("OAuth identity provider and provider user ID are required")
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
	return bootstrapMissingOAuthProfile(ctx, actorRow, identity, baseURL)
}

// BindOAuthConnector verifies ownership at the authenticated actor boundary
// without issuing or replacing a login session.
func BindOAuthConnector(ctx context.Context, req *oauthbridge.BrokerOAuthBridgeRequest, actorRow *db.Actor) error {
	if actorRow == nil {
		return ErrBridgeRequestInvalid
	}
	if req.GetPurpose() != "connector_link" {
		return ErrBridgePurposeInvalid
	}
	if err := consumeOAuthBridgeAssertionFromStore(ctx, req); err != nil {
		return err
	}
	identity, err := bridgeIdentity(req)
	if err != nil {
		return err
	}
	identityStore := GetOAuth2IdentityStore()
	_, boundActorID, err := identityStore.GetByProviderUser(
		ctx,
		identity.ProviderID,
		identity.ProviderUserID,
	)
	switch {
	case err == nil && boundActorID != uint64(actorRow.ID):
		return ErrOAuthIdentityConflict
	case err == nil:
		return nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return fmt.Errorf("identity lookup: %w", err)
	}
	if err := identityStore.BindActor(ctx, uint64(actorRow.ID), identity, false); err != nil {
		return fmt.Errorf("bind OAuth connector: %w", err)
	}
	return nil
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

func oauthProfileBootstrapRequest(
	actorRow *db.Actor,
	identity *coreauth.OAuth2Identity,
	observedRevision uint64,
) (actor.UpdateProfileRequest, bool) {
	if actorRow == nil || identity == nil || strings.TrimSpace(actorRow.Icon) != "" {
		return actor.UpdateProfileRequest{}, false
	}
	avatarURL := strings.TrimSpace(identity.AvatarURL)
	if avatarURL == "" {
		return actor.UpdateProfileRequest{}, false
	}
	return actor.UpdateProfileRequest{
		Avatar:           &avatarURL,
		ObservedRevision: observedRevision,
	}, true
}

func bootstrapMissingOAuthProfile(
	ctx context.Context,
	actorRow *db.Actor,
	identity *coreauth.OAuth2Identity,
	baseURL string,
) (*db.Actor, error) {
	if actorRow == nil || identity == nil || strings.TrimSpace(actorRow.Icon) != "" ||
		strings.TrimSpace(identity.AvatarURL) == "" {
		return actorRow, nil
	}
	profile, err := actor.GetWebProfileByID(ctx, actorRow.ID, baseURL)
	if err != nil {
		return nil, fmt.Errorf("load OAuth actor profile: %w", err)
	}
	request, ok := oauthProfileBootstrapRequest(actorRow, identity, profile.ProfileRevision)
	if !ok {
		return actorRow, nil
	}
	result, err := actor.UpdateProfileByID(ctx, actorRow.ID, baseURL, request)
	if err != nil {
		return nil, fmt.Errorf("bootstrap OAuth actor profile: %w", err)
	}
	if result.Profile != nil {
		actorRow.Icon = result.Profile.Avatar
	}
	return actorRow, nil
}

func findOrRegisterOAuthActor(ctx context.Context, identity *coreauth.OAuth2Identity, baseURL string) (*db.Actor, error) {
	return findOrRegisterOAuthActorWith(
		ctx,
		identity,
		baseURL,
		actor.GetActorByEmail,
		ensureUniqueUsername,
		actor.SignUp,
	)
}

func findOrRegisterOAuthActorWith(
	ctx context.Context,
	identity *coreauth.OAuth2Identity,
	baseURL string,
	findByEmail func(context.Context, string) (*db.Actor, error),
	resolveUsername func(context.Context, string) (string, error),
	signUp func(context.Context, *model.ActorSignRequest, string) error,
) (*db.Actor, error) {
	email := strings.TrimSpace(identity.Email)
	verified := identity.EmailVerified && email != ""
	if !verified {
		email = syntheticOAuthEmail(identity.ProviderID, identity.ProviderUserID)
	}

	existing, err := findByEmail(ctx, email)
	if err == nil && existing != nil {
		if verified {
			// Identity is keyed by the provider's identity ID, never by an
			// email. A different provider identity that resolves to an email
			// already owned by an actor is a conflict, never a silent merge.
			return nil, newOAuthEmailConflict()
		}
		// Unverified identity uses a provider-scoped synthetic email; an
		// existing row is this same identity's actor (e.g. its binding row was
		// lost), so reuse it — idempotent recovery, not cross-provider merge.
		return existing, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("find OAuth actor by email: %w", err)
	}

	username, err := resolveUsername(
		ctx,
		normalizedOAuthUsername(
			identity.ProviderID,
			identity.ProviderUserID,
			identity.Username,
		),
	)
	if err != nil {
		return nil, fmt.Errorf("ensure unique username: %w", err)
	}

	randomPasswordPrefix, err := generateRandomHex(8)
	if err != nil {
		return nil, fmt.Errorf("generate OAuth actor password: %w", err)
	}
	password := randomPasswordPrefix + "Aa1!"

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

	if err := signUp(ctx, signReq, baseURL); err != nil {
		// Concurrent registrations can race for the same verified email. If a
		// row now exists, report that conflict rather than a raw signup error.
		if verified {
			if racer, lookupErr := findByEmail(ctx, email); lookupErr == nil && racer != nil {
				return nil, newOAuthEmailConflict()
			}
		}
		return nil, fmt.Errorf("signup: %w", err)
	}

	registered, err := findByEmail(ctx, email)
	if err != nil {
		return nil, fmt.Errorf("load registered actor: %w", err)
	}
	return registered, nil
}

// newOAuthEmailConflict builds the typed error returned when a brand-new
// provider identity's verified email is already owned by another actor. Peers
// identifies users by the provider's identity ID and never auto-links
// providers, so this collision must be surfaced to the user instead of logging
// them into an existing account.
func newOAuthEmailConflict() error {
	return model.NewErrorResponse(
		model.ErrorCode_ERROR_CODE_ACTOR_EXISTS,
		"oauth email is already used by another actor",
	)
}

func syntheticOAuthEmail(provider coreauth.OAuth2ProviderID, providerUserID string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(string(provider)) + ":" + providerUserID))
	return fmt.Sprintf("oauth-%s@identity.invalid", hex.EncodeToString(sum[:16]))
}

func normalizedOAuthUsername(
	provider coreauth.OAuth2ProviderID,
	providerUserID, raw string,
) string {
	var builder strings.Builder
	lastSeparator := false
	for _, char := range strings.ToLower(strings.TrimSpace(raw)) {
		allowed := char >= 'a' && char <= 'z' ||
			char >= '0' && char <= '9' ||
			char == '.' ||
			char == '_' ||
			char == '-'
		if allowed {
			builder.WriteRune(char)
			lastSeparator = char == '.' || char == '_' || char == '-'
			continue
		}
		if builder.Len() > 0 && !lastSeparator {
			builder.WriteByte('-')
			lastSeparator = true
		}
	}
	base := strings.Trim(builder.String(), "._-")
	if len(base) > 20 {
		base = strings.TrimRight(base[:20], "._-")
	}
	if len(base) >= 5 {
		return base
	}
	sum := sha256.Sum256([]byte(strings.ToLower(string(provider)) + ":" + providerUserID))
	suffix := hex.EncodeToString(sum[:4])
	if base == "" {
		base = "oauth"
	}
	maxBaseLength := 20 - len(suffix) - 1
	if len(base) > maxBaseLength {
		base = strings.TrimRight(base[:maxBaseLength], "._-")
	}
	return base + "-" + suffix
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
			suffix, randomErr := rand.Int(rand.Reader, big.NewInt(9999))
			if randomErr != nil {
				return "", fmt.Errorf("generate username suffix: %w", randomErr)
			}
			prefix := base
			if len(prefix) > 15 {
				prefix = strings.TrimRight(prefix[:15], "._-")
			}
			candidate := fmt.Sprintf("%s_%04d", prefix, suffix.Int64())
			_, err := actor.GetActorByUsername(ctx, candidate)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return candidate, nil
			}
		}
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", base, time.Now().UnixNano())))
		return fmt.Sprintf("%.11s_%s", base, hex.EncodeToString(sum[:4])), nil
	}
	return "", err
}

func generateRandomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
