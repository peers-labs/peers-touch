package key_exchange

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	"google.golang.org/protobuf/encoding/protojson"
	"gorm.io/gorm"
)

// Fetch uses POST /key-exchange/keys/bundle/fetch (proto body) because upload already uses POST /key-exchange/keys/bundle; the mux cannot register two POST handlers on the same path.

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	deviceIDWrapper := serverwrapper.DeviceID()
	return []server.Handler{
		server.NewTypedHandler("ke-upload-bundle", "/key-exchange/keys/bundle", server.POST, s.handleUploadKeyBundle, logIDWrapper, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-fetch-bundle", "/key-exchange/keys/bundle/fetch", server.POST, s.handleFetchKeyBundle, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-federated-fetch-bundle", "/key-exchange/keys/bundle/federated-fetch", server.POST, s.handleFederatedFetchKeyBundle, logIDWrapper, s.federationFetchWrapper),
		server.NewTypedHandler("ke-replenish", "/key-exchange/keys/replenish", server.POST, s.handleReplenishOPKs, logIDWrapper, deviceIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-opk-count", "/key-exchange/keys/count", server.GET, s.handleOPKCount, logIDWrapper, deviceIDWrapper, s.jwtWrapper),
	}
}

func (s *subServer) handleUploadKeyBundle(ctx context.Context, req *kemodel.UploadKeyBundleRequest) (*kemodel.UploadKeyBundleResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	ikPub, err := decodeBase64Field("ik_pub", req.GetIkPub())
	if err != nil {
		return nil, server.BadRequestWithCause("invalid ik_pub", err)
	}
	spkPub, err := decodeBase64Field("spk_pub", req.GetSpkPub())
	if err != nil {
		return nil, server.BadRequestWithCause("invalid spk_pub", err)
	}
	spkSig, err := decodeBase64Field("spk_sig", req.GetSpkSig())
	if err != nil {
		return nil, server.BadRequestWithCause("invalid spk_sig", err)
	}
	opkIDs := req.GetOpkIds()
	opkPubs := req.GetOpkPubs()
	if len(opkIDs) != len(opkPubs) {
		return nil, server.BadRequest("opk_ids and opk_pubs must have the same length")
	}
	opks := make([]domain.OneTimePreKey, 0, len(opkIDs))
	for i := range opkIDs {
		pk, derr := decodeBase64Field("opk_pubs", opkPubs[i])
		if derr != nil {
			return nil, server.BadRequestWithCause("invalid opk_pubs entry", derr)
		}
		opks = append(opks, domain.OneTimePreKey{ID: opkIDs[i], PublicKey: pk, Consumed: false})
	}
	devID, err := selectAuthenticatedDeviceID(serverwrapper.GetDeviceID(ctx), req.GetDeviceId())
	if err != nil {
		return nil, err
	}
	if err := s.requireVerifiedActiveDevice(ctx, subject.ID, devID); err != nil {
		return nil, err
	}
	if err := s.service.UploadKeyBundle(subject.ID, devID, ikPub, req.GetSpkId(), spkPub, spkSig, opks, req.GetSupportedVersions()); err != nil {
		return nil, server.InternalErrorWithCause("failed to upload key bundle", err)
	}
	return &kemodel.UploadKeyBundleResponse{}, nil
}

func (s *subServer) handleFetchKeyBundle(ctx context.Context, req *kemodel.FetchKeyBundleRequest) (*kemodel.FetchKeyBundleResponse, error) {
	if auth.GetSubject(ctx) == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GetPtid() == "" {
		return nil, server.BadRequest("did is required")
	}
	homeStationPeerID := strings.TrimSpace(req.GetHomeStationPeerId())
	if homeStationPeerID == "" {
		actorRecord, resolveErr := touchactor.GetActorByPTID(ctx, req.GetPtid())
		if resolveErr != nil {
			return nil, server.InternalErrorWithCause("resolve actor Home Station failed", resolveErr)
		}
		if actorRecord != nil {
			homeStationPeerID = strings.TrimSpace(actorRecord.HomeStationPeerID)
		}
	}
	if homeStationPeerID != "" && homeStationPeerID != strings.TrimSpace(s.currentLocalStationID()) {
		resp, err := s.fetchFederatedKeyBundle(ctx, homeStationPeerID, req)
		if err != nil {
			return nil, err
		}
		return resp, nil
	}

	return s.fetchLocalKeyBundle(ctx, req)
}

func (s *subServer) handleFederatedFetchKeyBundle(ctx context.Context, req *kemodel.FetchKeyBundleRequest) (*kemodel.FetchKeyBundleResponse, error) {
	if req.GetPtid() == "" {
		return nil, server.BadRequest("did is required")
	}
	if err := validateFederatedFetchClaims(ctx, req); err != nil {
		return nil, err
	}
	return s.fetchLocalKeyBundle(ctx, req)
}

func validateFederatedFetchClaims(ctx context.Context, req *kemodel.FetchKeyBundleRequest) error {
	claims := serverwrapper.GetVerifiedFederationClaims(ctx, nil)
	if claims == nil {
		return nil
	}
	if claims.Scope != keyExchangeFederatedFetchScopeName {
		return server.Unauthorized("invalid federation scope")
	}
	if v, ok := claims.Get(keyExchangeClaimActor); !ok || v != req.GetPtid() {
		return server.Forbidden("federation actor claim does not match key bundle request")
	}
	if v, ok := claims.Get(keyExchangeClaimDevice); ok && v != req.GetDeviceId() {
		return server.Forbidden("federation device claim does not match key bundle request")
	}
	return nil
}

func (s *subServer) fetchLocalKeyBundle(
	ctx context.Context,
	req *kemodel.FetchKeyBundleRequest,
) (*kemodel.FetchKeyBundleResponse, error) {
	filter := ""
	if strings.TrimSpace(req.GetDeviceId()) != "" {
		filter = strings.TrimSpace(req.GetDeviceId())
	}

	bundles, err := s.service.FetchKeyBundles(req.GetPtid(), filter)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, server.NotFound("key bundle not found or no identity for that device filter")
		}
		return nil, server.InternalErrorWithCause("failed to fetch key bundle", err)
	}
	if len(bundles) == 0 {
		return nil, server.NotFound("key bundle not found")
	}
	activeDevices, err := s.deviceStore.ListActive(ctx, req.GetPtid())
	if err != nil {
		return nil, server.InternalErrorWithCause("resolve active devices failed", err)
	}
	activeDeviceIDs := make(map[string]struct{}, len(activeDevices))
	for _, device := range activeDevices {
		activeDeviceIDs[device.DeviceID] = struct{}{}
	}

	out := make([]*kemodel.KeyBundle, 0, len(bundles))
	for _, b := range bundles {
		if _, active := activeDeviceIDs[b.DeviceID]; !active {
			continue
		}
		opkStrs := make([]string, 0, len(b.OneTimePreKeys))
		opkIDs := make([]int32, 0, len(b.OneTimePreKeys))
		for _, opk := range b.OneTimePreKeys {
			opkStrs = append(opkStrs, base64.StdEncoding.EncodeToString(opk.PublicKey))
			opkIDs = append(opkIDs, opk.ID)
		}
		out = append(out, &kemodel.KeyBundle{
			Ptid:              b.ActorPtid,
			DeviceId:          b.DeviceID,
			IkPub:             base64.StdEncoding.EncodeToString(b.IdentityKeyPub),
			SpkId:             b.SignedPreKey.ID,
			SpkPub:            base64.StdEncoding.EncodeToString(b.SignedPreKey.PublicKey),
			SpkSig:            base64.StdEncoding.EncodeToString(b.SignedPreKey.Signature),
			Opks:              opkStrs,
			OpkIds:            opkIDs,
			PublishedAtUnixMs: b.PublishedAtUnixMs,
			SupportedVersions: b.SupportedVersions,
		})
	}
	if len(out) == 0 {
		return nil, server.NotFound("no active device key bundle found")
	}

	return &kemodel.FetchKeyBundleResponse{Bundles: out}, nil
}

func (s *subServer) fetchFederatedKeyBundle(ctx context.Context, targetStationPeerID string, req *kemodel.FetchKeyBundleRequest) (*kemodel.FetchKeyBundleResponse, error) {
	rc := nativefed.RelayClient()
	if rc == nil {
		return nil, server.InternalError("federated key bundle fetch requires Relay client")
	}
	base := strings.TrimRight(rc.BaseURL(), "/")
	relayToken := strings.TrimSpace(rc.Token())
	if base == "" || relayToken == "" {
		return nil, server.InternalError("federated key bundle fetch requires Relay configuration")
	}
	token, err := s.mintFederatedFetchToken(ctx, targetStationPeerID, req.GetPtid(), req.GetDeviceId())
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to mint key bundle federation token", err)
	}
	forwardReq := &kemodel.FetchKeyBundleRequest{
		Ptid:     req.GetPtid(),
		DeviceId: req.GetDeviceId(),
	}
	body, err := protojson.Marshal(forwardReq)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to encode key bundle federation request", err)
	}
	target := fmt.Sprintf("%s/relay/forward/%s/key-exchange/keys/bundle/federated-fetch", base, url.PathEscape(targetStationPeerID))
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to create key bundle federation request", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+relayToken)
	httpReq.Header.Set(nativefed.ForwardAuthorizationHeader, "Bearer "+token)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, server.InternalErrorWithCause("federated key bundle fetch failed", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to read federated key bundle response", err)
	}
	if resp.StatusCode >= 300 {
		detail := string(raw)
		if len(detail) > 200 {
			detail = detail[:200]
		}
		return nil, server.InternalError(fmt.Sprintf("federated key bundle fetch failed status=%d body=%s", resp.StatusCode, detail))
	}
	var decoded kemodel.FetchKeyBundleResponse
	if err := protojson.Unmarshal(raw, &decoded); err != nil {
		return nil, server.InternalErrorWithCause("failed to decode federated key bundle response", err)
	}
	return &decoded, nil
}

func (s *subServer) mintFederatedFetchToken(ctx context.Context, targetStationPeerID, actorPTID, deviceID string) (string, error) {
	if s.keyCache == nil {
		return "", errors.New("federation key cache is not configured")
	}
	issuer := strings.TrimSpace(s.currentLocalStationID())
	if issuer == "" {
		issuer = keyExchangeLocalFederationAudience()
	}
	if issuer == "" || strings.TrimSpace(targetStationPeerID) == "" || strings.TrimSpace(actorPTID) == "" {
		return "", errors.New("issuer, audience, and actor PTID are required")
	}
	return authfed.Mint(ctx, s.keyCache, authfed.MintRequest{
		Scope:    keyExchangeFederatedFetchScopeName,
		Issuer:   issuer,
		Audience: strings.TrimSpace(targetStationPeerID),
		Subject:  issuer,
		TTL:      keyExchangeFederationTTL,
		Custom: map[string]string{
			keyExchangeClaimActor:  actorPTID,
			keyExchangeClaimDevice: deviceID,
		},
	})
}

func (s *subServer) handleReplenishOPKs(ctx context.Context, req *kemodel.ReplenishOpksRequest) (*kemodel.ReplenishOpksResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	opkIDs := req.GetOpkIds()
	opkPubs := req.GetOpkPubs()
	if len(opkIDs) != len(opkPubs) {
		return nil, server.BadRequest("opk_ids and opk_pubs must have the same length")
	}
	opks := make([]domain.OneTimePreKey, 0, len(opkIDs))
	for i := range opkIDs {
		pk, err := decodeBase64Field("opk_pubs", opkPubs[i])
		if err != nil {
			return nil, server.BadRequestWithCause("invalid opk_pubs entry", err)
		}
		opks = append(opks, domain.OneTimePreKey{ID: opkIDs[i], PublicKey: pk, Consumed: false})
	}
	devID, err := selectAuthenticatedDeviceID(serverwrapper.GetDeviceID(ctx), req.GetDeviceId())
	if err != nil {
		return nil, err
	}
	if err := s.requireVerifiedActiveDevice(ctx, subject.ID, devID); err != nil {
		return nil, err
	}
	if err := s.service.ReplenishOPKs(subject.ID, devID, opks); err != nil {
		return nil, server.InternalErrorWithCause("failed to replenish one-time prekeys", err)
	}
	return &kemodel.ReplenishOpksResponse{}, nil
}

func (s *subServer) handleOPKCount(ctx context.Context, req *kemodel.OpkCountRequest) (*kemodel.OpkCountResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	devID, err := selectAuthenticatedDeviceID(serverwrapper.GetDeviceID(ctx), req.GetDeviceId())
	if err != nil {
		return nil, err
	}
	if err := s.requireVerifiedActiveDevice(ctx, subject.ID, devID); err != nil {
		return nil, err
	}
	n, err := s.service.CountOPKs(subject.ID, devID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to count one-time prekeys", err)
	}
	return &kemodel.OpkCountResponse{Count: n}, nil
}

func (s *subServer) requireVerifiedActiveDevice(
	ctx context.Context,
	ptid string,
	deviceID string,
) error {
	active, err := s.deviceStore.IsVerifiedActive(ctx, ptid, deviceID)
	if err != nil {
		return server.InternalErrorWithCause("failed to verify messaging device", err)
	}
	if !active {
		return server.Forbidden("verified active messaging device required")
	}
	return nil
}

func decodeBase64Field(field, value string) ([]byte, error) {
	if strings.TrimSpace(value) == "" {
		return nil, errors.New(field + " is empty")
	}
	return base64.StdEncoding.DecodeString(value)
}

func selectAuthenticatedDeviceID(authenticatedDeviceID, requestedDeviceID string) (string, error) {
	authenticatedDeviceID = strings.TrimSpace(authenticatedDeviceID)
	requestedDeviceID = strings.TrimSpace(requestedDeviceID)
	if authenticatedDeviceID == "" {
		return "", server.BadRequest("X-Device-ID is required")
	}
	if requestedDeviceID != "" && requestedDeviceID != authenticatedDeviceID {
		return "", server.BadRequest("device_id does not match authenticated X-Device-ID")
	}
	return authenticatedDeviceID, nil
}
