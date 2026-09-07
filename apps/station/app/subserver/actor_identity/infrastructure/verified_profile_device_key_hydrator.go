package infrastructure

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

const (
	remoteCachedActorOrigin = "remote_cached"
	maxRemoteProfileBytes   = 1 << 20
)

type actorProfileLocator interface {
	Resolve(
		ctx context.Context,
		canonicalHandle string,
	) (*locatorpb.ActorLocatorRecord, error)
}

type remoteActorProfileFetcher interface {
	Fetch(
		ctx context.Context,
		canonicalHandle string,
		homeStationPeerID string,
	) (*profilepb.ActorProfileEnvelope, error)
}

type dhtActorProfileLocator struct {
	lookup  *locator.Lookup
	timeout time.Duration
}

func (l dhtActorProfileLocator) Resolve(
	ctx context.Context,
	canonicalHandle string,
) (*locatorpb.ActorLocatorRecord, error) {
	health := fednode.GetRoutingHealth()
	if !health.Ready {
		return nil, fmt.Errorf(
			"actor identity locator is not ready: peers=%d/%d",
			health.PeersInRoutingTable,
			health.MinDHTPeers,
		)
	}
	lookupCtx, cancel := context.WithTimeout(ctx, l.timeout)
	defer cancel()
	return l.lookup.GetByHandle(lookupCtx, canonicalHandle)
}

type relayActorProfileFetcher struct {
	client  *http.Client
	timeout time.Duration
}

func (f relayActorProfileFetcher) Fetch(
	ctx context.Context,
	canonicalHandle string,
	homeStationPeerID string,
) (*profilepb.ActorProfileEnvelope, error) {
	const operation = "actor_identity.fetch_remote_profile"
	relayClient := fednode.RelayClient()
	if relayClient == nil ||
		strings.TrimSpace(relayClient.BaseURL()) == "" ||
		strings.TrimSpace(relayClient.Token()) == "" {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			"relay",
			"is not available yet",
		)
	}

	target := fmt.Sprintf(
		"%s/relay/forward/%s/actor/federation/profile?handle=%s",
		strings.TrimRight(relayClient.BaseURL(), "/"),
		url.PathEscape(homeStationPeerID),
		url.QueryEscape(canonicalHandle),
	)
	requestCtx, cancel := context.WithTimeout(ctx, f.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, target, nil)
	if err != nil {
		return nil, actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			err,
		)
	}
	request.Header.Set("Authorization", "Bearer "+relayClient.Token())
	request.Header.Set("Accept", "application/json")

	response, err := f.client.Do(request)
	if err != nil {
		return nil, actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			err,
		)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxRemoteProfileBytes))
	if err != nil {
		return nil, actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			err,
		)
	}
	switch {
	case response.StatusCode == http.StatusNotFound:
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeUnauthorized,
			operation,
			"actor_ptid",
			"is not present at the claimed Home Station",
		)
	case response.StatusCode == http.StatusTooManyRequests ||
		response.StatusCode >= http.StatusInternalServerError:
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			"home_station_profile",
			"is temporarily unavailable",
		)
	case response.StatusCode < http.StatusOK ||
		response.StatusCode >= http.StatusMultipleChoices:
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeInvalidProof,
			operation,
			"home_station_profile",
			"was rejected by the claimed Home Station",
		)
	}
	if len(body) == 0 {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			"home_station_profile",
			"is empty",
		)
	}

	envelope := &profilepb.ActorProfileEnvelope{}
	if err := protojson.Unmarshal(body, envelope); err != nil {
		return nil, actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeInvalidProof,
			operation,
			err,
		)
	}
	return envelope, nil
}

// VerifiedProfileDeviceKeyHydrator resolves remote device keys from PTID and
// the authenticated Home Station. ActorRef.acct is display metadata and is
// deliberately absent from this interface.
type VerifiedProfileDeviceKeyHydrator struct {
	db       *gorm.DB
	locator  actorProfileLocator
	profiles remoteActorProfileFetcher
	peerKeys authfed.PeerKeyStore
	clock    func() time.Time
}

// NewVerifiedProfileDeviceKeyHydrator constructs the Actor Identity-owned
// profile/locator mechanism over canonical Federation trust metadata.
func NewVerifiedProfileDeviceKeyHydrator(
	db *gorm.DB,
) (*VerifiedProfileDeviceKeyHydrator, error) {
	if db == nil {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeInvalidArgument,
			"actor_identity.new_verified_profile_device_key_hydrator",
			"db",
			"is required",
		)
	}

	const timeout = 15 * time.Second
	return &VerifiedProfileDeviceKeyHydrator{
		db: db,
		locator: dhtActorProfileLocator{
			lookup:  locator.NewLookup(locator.LookupConfig{}),
			timeout: timeout,
		},
		profiles: relayActorProfileFetcher{
			client:  &http.Client{Timeout: 30 * time.Second},
			timeout: timeout,
		},
		peerKeys: authfed.NewPeerKeyStoreGORMWithDB(db),
		clock:    time.Now,
	}, nil
}

// Hydrate verifies one fresh Home Station locator/profile chain and returns
// only authenticated device keys for transaction-bound canonical persistence.
func (h *VerifiedProfileDeviceKeyHydrator) Hydrate(
	ctx context.Context,
	actorPTID string,
	claimedHomeStationPeerID string,
) ([]*model.VerifiedActorDeviceSigningKey, error) {
	const operation = "actor_identity.hydrate_verified_profile_device_keys"
	if h == nil ||
		h.db == nil ||
		h.locator == nil ||
		h.profiles == nil ||
		h.peerKeys == nil ||
		h.clock == nil {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			"resolver",
			"is not configured",
		)
	}
	if err := actoridentitydomain.ValidatePTID(operation, actorPTID); err != nil {
		return nil, err
	}
	if claimedHomeStationPeerID == "" ||
		claimedHomeStationPeerID != strings.TrimSpace(claimedHomeStationPeerID) {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeInvalidArgument,
			operation,
			"home_station_peer_id",
			"is required and must be canonical",
		)
	}

	canonicalHandle, err := h.locateCanonicalHandle(
		ctx,
		actorPTID,
		claimedHomeStationPeerID,
	)
	if err != nil {
		return nil, err
	}
	pinnedPeerKey, err := h.loadPinnedPeerKey(
		ctx,
		claimedHomeStationPeerID,
	)
	if err != nil {
		return nil, err
	}
	locatorRecord, err := h.locator.Resolve(ctx, canonicalHandle)
	if err != nil {
		return nil, classifyVerifiedProfileResolutionError(operation, err)
	}
	if err := h.verifyLocator(
		locatorRecord,
		canonicalHandle,
		claimedHomeStationPeerID,
		pinnedPeerKey,
	); err != nil {
		return nil, err
	}

	envelope, err := h.profiles.Fetch(
		ctx,
		canonicalHandle,
		claimedHomeStationPeerID,
	)
	if err != nil {
		if actoridentitydomain.CodeOf(err) != "" {
			return nil, err
		}
		return nil, classifyVerifiedProfileResolutionError(operation, err)
	}
	if err := h.verifyProfile(
		envelope,
		canonicalHandle,
		actorPTID,
		claimedHomeStationPeerID,
		pinnedPeerKey,
	); err != nil {
		return nil, err
	}

	keys := make([]*model.VerifiedActorDeviceSigningKey, 0, len(envelope.GetDeviceSigningKeys()))
	for _, key := range envelope.GetDeviceSigningKeys() {
		if !matchesVerifiedProfileDeviceKey(
			key,
			actorPTID,
			claimedHomeStationPeerID,
		) {
			return nil, actoridentitydomain.NewError(
				actoridentitydomain.ErrorCodeInvalidProof,
				operation,
				"device_signing_keys",
				"contain identity material outside the verified actor and Home Station",
			)
		}
		keys = append(
			keys,
			proto.Clone(key).(*model.VerifiedActorDeviceSigningKey),
		)
	}

	return keys, nil
}

func (h *VerifiedProfileDeviceKeyHydrator) locateCanonicalHandle(
	ctx context.Context,
	actorPTID string,
	claimedHomeStationPeerID string,
) (string, error) {
	const operation = "actor_identity.locate_remote_profile"

	if h.db.Migrator().HasTable("touch_actor") {
		var cached struct {
			FederatedHandle string `gorm:"column:federated_handle"`
		}
		err := h.db.WithContext(ctx).
			Table("touch_actor").
			Select("federated_handle").
			Where(
				"ptid = ? AND home_station_peer_id = ? AND origin = ?",
				actorPTID,
				claimedHomeStationPeerID,
				remoteCachedActorOrigin,
			).
			First(&cached).Error
		switch {
		case err == nil:
			handle, canonicalErr := locator.CanonicalHandle(cached.FederatedHandle)
			if canonicalErr != nil {
				return "", actoridentitydomain.WrapError(
					actoridentitydomain.ErrorCodeInvalidProof,
					operation,
					canonicalErr,
				)
			}
			return handle, nil
		case !errors.Is(err, gorm.ErrRecordNotFound):
			return "", actoridentitydomain.WrapError(
				actoridentitydomain.ErrorCodePersistence,
				operation,
				err,
			)
		}
	}

	parsedPTID, err := identity.Parse(actorPTID)
	if err != nil {
		return "", actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeInvalidArgument,
			operation,
			err,
		)
	}
	if !h.db.Migrator().HasTable("federation_station_membership") {
		return "", actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			"home_station_route",
			"is not available yet",
		)
	}

	var memberships []struct {
		StationURL string `gorm:"column:station_url"`
	}
	if err := h.db.WithContext(ctx).
		Table("federation_station_membership").
		Select("station_url").
		Where(
			"station_peer_id = ? AND status = ?",
			claimedHomeStationPeerID,
			"active",
		).
		Find(&memberships).Error; err != nil {
		return "", actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodePersistence,
			operation,
			err,
		)
	}

	handles := make(map[string]struct{})
	for _, membership := range memberships {
		stationURL, parseErr := url.Parse(strings.TrimSpace(membership.StationURL))
		if parseErr != nil ||
			(stationURL.Scheme != "http" && stationURL.Scheme != "https") ||
			stationURL.Host == "" ||
			stationURL.User != nil ||
			stationURL.RawQuery != "" ||
			stationURL.Fragment != "" {
			return "", actoridentitydomain.NewError(
				actoridentitydomain.ErrorCodeInvalidProof,
				operation,
				"home_station_route",
				"is not a verified absolute HTTP endpoint",
			)
		}
		handle, canonicalErr := locator.CanonicalHandle(
			parsedPTID.Username + "@" + stationURL.Host,
		)
		if canonicalErr != nil {
			return "", actoridentitydomain.WrapError(
				actoridentitydomain.ErrorCodeInvalidProof,
				operation,
				canonicalErr,
			)
		}
		handles[handle] = struct{}{}
	}
	if len(handles) == 0 {
		return "", actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			"home_station_route",
			"is not available yet",
		)
	}
	if len(handles) != 1 {
		return "", actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityConflict,
			operation,
			"home_station_route",
			"has conflicting active locations",
		)
	}
	for handle := range handles {
		return handle, nil
	}

	return "", actoridentitydomain.NewError(
		actoridentitydomain.ErrorCodeIdentityUnavailable,
		operation,
		"home_station_route",
		"is not available yet",
	)
}

func (h *VerifiedProfileDeviceKeyHydrator) loadPinnedPeerKey(
	ctx context.Context,
	claimedHomeStationPeerID string,
) (*authfed.PeerKey, error) {
	const operation = "actor_identity.load_home_station_key"
	pinnedPeerKey, err := h.peerKeys.Get(ctx, claimedHomeStationPeerID)
	if err != nil {
		return nil, actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodePersistence,
			operation,
			err,
		)
	}
	if pinnedPeerKey == nil ||
		pinnedPeerKey.StationID != claimedHomeStationPeerID ||
		strings.TrimSpace(pinnedPeerKey.PubPEM) == "" {
		return nil, actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			"home_station_signing_key",
			"is not available yet",
		)
	}
	_, derivedKeyID, err := authfed.ParsePeerJWKPEM(pinnedPeerKey.PubPEM)
	if err != nil || derivedKeyID != pinnedPeerKey.Kid {
		return nil, actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeInvalidProof,
			operation,
			errors.Join(errors.New("pinned Home Station key is invalid"), err),
		)
	}

	return pinnedPeerKey, nil
}

func (h *VerifiedProfileDeviceKeyHydrator) verifyLocator(
	record *locatorpb.ActorLocatorRecord,
	canonicalHandle string,
	claimedHomeStationPeerID string,
	pinnedPeerKey *authfed.PeerKey,
) error {
	const operation = "actor_identity.verify_remote_profile_locator"
	if record == nil ||
		record.GetTombstone() ||
		record.GetHomeStationPeerId() != claimedHomeStationPeerID ||
		strings.TrimSpace(record.GetSigningKeyPem()) !=
			strings.TrimSpace(pinnedPeerKey.PubPEM) ||
		record.GetSigningKeyKid() != pinnedPeerKey.Kid {
		return actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeInvalidProof,
			operation,
			"locator",
			"does not bind the actor handle to the pinned claimed Home Station",
		)
	}
	if err := locator.Verify(
		record,
		locator.VerifyOptions{
			ExpectedHandle: canonicalHandle,
			Now:            h.clock().UTC(),
		},
	); err != nil {
		return classifyVerifiedProfileResolutionError(operation, err)
	}

	return nil
}

func (h *VerifiedProfileDeviceKeyHydrator) verifyProfile(
	envelope *profilepb.ActorProfileEnvelope,
	canonicalHandle string,
	actorPTID string,
	claimedHomeStationPeerID string,
	pinnedPeerKey *authfed.PeerKey,
) error {
	const operation = "actor_identity.verify_remote_profile"
	if envelope == nil ||
		envelope.GetHomeStationPeerId() != claimedHomeStationPeerID ||
		envelope.GetProfile().GetPeersTouch().GetNetworkId() != actorPTID ||
		strings.TrimSpace(envelope.GetSigningKeyPem()) !=
			strings.TrimSpace(pinnedPeerKey.PubPEM) ||
		envelope.GetSigningKeyKid() != pinnedPeerKey.Kid {
		return actoridentitydomain.NewError(
			actoridentitydomain.ErrorCodeInvalidProof,
			operation,
			"profile",
			"does not bind the PTID to the pinned claimed Home Station",
		)
	}
	if err := fedprofile.Verify(
		envelope,
		fedprofile.VerifyOptions{
			ExpectedHandle:        canonicalHandle,
			ExpectedSigningKeyPEM: pinnedPeerKey.PubPEM,
			Now:                   h.clock().UTC(),
		},
	); err != nil {
		return classifyVerifiedProfileResolutionError(operation, err)
	}

	return nil
}

func matchesVerifiedProfileDeviceKey(
	key *model.VerifiedActorDeviceSigningKey,
	actorPTID string,
	claimedHomeStationPeerID string,
) bool {
	if key == nil ||
		key.GetActorPtid() != actorPTID ||
		key.GetActorDeviceId() == "" ||
		key.GetHomeStationPeerId() != claimedHomeStationPeerID ||
		key.GetSigningKeyId() == "" ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		key.GetProfileVersion() <= 0 ||
		key.GetValidFromUnixMs() <= 0 ||
		key.GetRevokedAtUnixMs() != 0 {
		return false
	}
	switch key.GetVerificationSource() {
	case model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR:
		return true
	default:
		return false
	}
}

func classifyVerifiedProfileResolutionError(
	operation string,
	err error,
) error {
	switch {
	case errors.Is(err, fedprofile.ErrEnvelopeExpired),
		errors.Is(err, locator.ErrRecordStale),
		errors.Is(err, locator.ErrNotFound):
		return actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			err,
		)
	case errors.Is(err, locator.ErrEmptyRecord),
		errors.Is(err, locator.ErrSignatureMissing),
		errors.Is(err, locator.ErrSignatureInvalid),
		errors.Is(err, locator.ErrKeyKidMismatch),
		errors.Is(err, locator.ErrHandleMismatch),
		errors.Is(err, locator.ErrInvalidPubKey),
		errors.Is(err, fedprofile.ErrEmptyEnvelope),
		errors.Is(err, fedprofile.ErrSignatureMissing),
		errors.Is(err, fedprofile.ErrSignatureInvalid),
		errors.Is(err, fedprofile.ErrKeyKidMismatch),
		errors.Is(err, fedprofile.ErrHandleMismatch),
		errors.Is(err, fedprofile.ErrInvalidPubKey):
		return actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeInvalidProof,
			operation,
			err,
		)
	default:
		return actoridentitydomain.WrapError(
			actoridentitydomain.ErrorCodeIdentityUnavailable,
			operation,
			err,
		)
	}
}
