package key_exchange

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	kemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"gorm.io/gorm"
)

// Fetch uses POST /key-exchange/keys/bundle/fetch (proto body) because upload already uses POST /key-exchange/keys/bundle; the mux cannot register two POST handlers on the same path.

func normalizeDeviceID(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "legacy"
	}
	return s
}

// protoDeviceID turns a DB device key into the wire form (legacy -> "").
func protoDeviceID(stored string) string {
	if stored == "legacy" {
		return ""
	}
	return stored
}

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	return []server.Handler{
		server.NewTypedHandler("ke-upload-bundle", "/key-exchange/keys/bundle", server.POST, s.handleUploadKeyBundle, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-fetch-bundle", "/key-exchange/keys/bundle/fetch", server.POST, s.handleFetchKeyBundle, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-replenish", "/key-exchange/keys/replenish", server.POST, s.handleReplenishOPKs, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-opk-count", "/key-exchange/keys/count", server.GET, s.handleOPKCount, logIDWrapper, s.jwtWrapper),
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
	devID := normalizeDeviceID(req.GetDeviceId())
	if err := s.service.UploadKeyBundle(subject.ID, devID, ikPub, req.GetSpkId(), spkPub, spkSig, opks, req.GetSupportedVersions()); err != nil {
		return nil, server.InternalErrorWithCause("failed to upload key bundle", err)
	}
	return &kemodel.UploadKeyBundleResponse{}, nil
}

func (s *subServer) handleFetchKeyBundle(ctx context.Context, req *kemodel.FetchKeyBundleRequest) (*kemodel.FetchKeyBundleResponse, error) {
	if auth.GetSubject(ctx) == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.GetDid() == "" {
		return nil, server.BadRequest("did is required")
	}

	filter := ""
	if strings.TrimSpace(req.GetDeviceId()) != "" {
		filter = normalizeDeviceID(req.GetDeviceId())
	}

	bundles, err := s.service.FetchKeyBundles(req.GetDid(), filter)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, server.NotFound("key bundle not found or no identity for that device filter")
		}
		return nil, server.InternalErrorWithCause("failed to fetch key bundle", err)
	}
	if len(bundles) == 0 {
		return nil, server.NotFound("key bundle not found")
	}

	out := make([]*kemodel.KeyBundle, 0, len(bundles))
	for _, b := range bundles {
		opkStrs := make([]string, 0, len(b.OneTimePreKeys))
		for _, opk := range b.OneTimePreKeys {
			opkStrs = append(opkStrs, base64.StdEncoding.EncodeToString(opk.PublicKey))
		}
		out = append(out, &kemodel.KeyBundle{
			Did:               b.ActorDID,
			DeviceId:          protoDeviceID(b.DeviceID),
			IkPub:             base64.StdEncoding.EncodeToString(b.IdentityKeyPub),
			SpkPub:            base64.StdEncoding.EncodeToString(b.SignedPreKey.PublicKey),
			SpkSig:            base64.StdEncoding.EncodeToString(b.SignedPreKey.Signature),
			Opks:              opkStrs,
			PublishedAtUnixMs: b.PublishedAtUnixMs,
			SupportedVersions: b.SupportedVersions,
		})
	}

	return &kemodel.FetchKeyBundleResponse{Bundles: out}, nil
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
	devID := normalizeDeviceID(req.GetDeviceId())
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
	devID := normalizeDeviceID(req.GetDeviceId())
	n, err := s.service.CountOPKs(subject.ID, devID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to count one-time prekeys", err)
	}
	return &kemodel.OpkCountResponse{Count: n}, nil
}

func decodeBase64Field(field, value string) ([]byte, error) {
	if strings.TrimSpace(value) == "" {
		return nil, errors.New(field + " is empty")
	}
	return base64.StdEncoding.DecodeString(value)
}
