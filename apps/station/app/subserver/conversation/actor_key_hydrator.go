package conversation

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	feddomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	fedprofile "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"google.golang.org/protobuf/encoding/protojson"
)

type VerifiedProfileActorKeyHydrator struct {
	memberships feddomain.MembershipRepository
	peerKeys    authfed.PeerKeyStore
	deviceStore *touchactor.DeviceStore
	client      *http.Client
	clock       func() time.Time
}

func NewVerifiedProfileActorKeyHydrator(
	memberships feddomain.MembershipRepository,
	peerKeys authfed.PeerKeyStore,
	deviceStore *touchactor.DeviceStore,
) *VerifiedProfileActorKeyHydrator {
	return &VerifiedProfileActorKeyHydrator{
		memberships: memberships,
		peerKeys:    peerKeys,
		deviceStore: deviceStore,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		clock: time.Now,
	}
}

func (h *VerifiedProfileActorKeyHydrator) Hydrate(
	ctx context.Context,
	federationID string,
	homeStationPeerID string,
	actorPtid string,
) error {
	if h.memberships == nil || h.peerKeys == nil || h.deviceStore == nil {
		return fmt.Errorf("conversation: actor key hydrator is not configured")
	}
	membership, err := h.memberships.GetByStation(
		ctx,
		federationID,
		homeStationPeerID,
	)
	if err != nil {
		return err
	}
	if membership == nil ||
		membership.Status != "active" ||
		strings.TrimSpace(membership.StationURL) == "" {
		return fmt.Errorf("conversation: inactive actor Home Station")
	}
	parsedPtid, err := identity.Parse(actorPtid)
	if err != nil {
		return fmt.Errorf("conversation: parse actor PTID: %w", err)
	}
	stationURL, err := url.Parse(strings.TrimSpace(membership.StationURL))
	if err != nil || stationURL.Scheme == "" || stationURL.Host == "" {
		return fmt.Errorf("conversation: invalid actor Home Station URL")
	}
	expectedHandle := parsedPtid.Username + "@" + stationURL.Host
	endpoint := strings.TrimRight(stationURL.String(), "/") +
		"/actor/federation/profile?handle=" +
		url.QueryEscape(expectedHandle)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return fmt.Errorf("conversation: fetch actor profile: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf(
			"conversation: actor profile rejected with status %d",
			resp.StatusCode,
		)
	}
	envelope := &profilepb.ActorProfileEnvelope{}
	if err := protojson.Unmarshal(body, envelope); err != nil {
		return fmt.Errorf("conversation: decode actor profile: %w", err)
	}
	peerKey, err := h.peerKeys.Get(ctx, homeStationPeerID)
	if err != nil {
		return err
	}
	if peerKey == nil || strings.TrimSpace(peerKey.PubPEM) == "" {
		return fmt.Errorf("conversation: actor Home Station peer key unavailable")
	}
	if err := fedprofile.Verify(envelope, fedprofile.VerifyOptions{
		ExpectedHandle:        expectedHandle,
		ExpectedSigningKeyPEM: peerKey.PubPEM,
		Now:                   h.clock(),
	}); err != nil {
		return fmt.Errorf("conversation: verify actor profile: %w", err)
	}
	if envelope.HomeStationPeerId != homeStationPeerID ||
		envelope.GetProfile().GetPeersTouch().GetNetworkId() != actorPtid {
		return fmt.Errorf("conversation: actor profile identity mismatch")
	}
	for _, key := range envelope.DeviceSigningKeys {
		if key == nil ||
			key.ActorPtid != actorPtid ||
			key.HomeStationPeerId != homeStationPeerID {
			return fmt.Errorf("conversation: actor profile device key mismatch")
		}
		if err := h.deviceStore.UpsertVerifiedRemote(ctx, key); err != nil {
			return err
		}
	}
	return nil
}
