package key_exchange

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"gorm.io/gorm"
)

// JSON request/response types (wire format); protobuf for this domain is not defined yet.

type uploadKeyBundleRequest struct {
	IkPub   string   `json:"ik_pub"`
	SpkID   int32    `json:"spk_id"`
	SpkPub  string   `json:"spk_pub"`
	SpkSig  string   `json:"spk_sig"`
	OpkIDs  []int32  `json:"opk_ids"`
	OpkPubs []string `json:"opk_pubs"`
}

type replenishOPKsRequest struct {
	OpkIDs  []int32  `json:"opk_ids"`
	OpkPubs []string `json:"opk_pubs"`
}

type fetchKeyBundleResponse struct {
	ActorDID    string `json:"actor_did"`
	IkPub       string `json:"ik_pub"`
	Fingerprint string `json:"fingerprint"`
	SpkID       int32  `json:"spk_id"`
	SpkPub      string `json:"spk_pub"`
	SpkSig      string `json:"spk_sig"`
	OpkID       int32  `json:"opk_id"`
	OpkPub      string `json:"opk_pub"`
}

type opkCountResponse struct {
	Count int64 `json:"count"`
}

func (s *subServer) Handlers() []server.Handler {
	logIDWrapper := serverwrapper.LogID()
	return []server.Handler{
		server.NewTypedHandler("ke-upload-bundle", "/key-exchange/keys/bundle", server.POST, s.handleUploadKeyBundle, logIDWrapper, s.jwtWrapper),
		server.NewSimpleHandler("ke-fetch-bundle", "/key-exchange/keys/bundle", server.GET, s.handleFetchKeyBundleHTTP, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-replenish", "/key-exchange/keys/replenish", server.POST, s.handleReplenishOPKs, logIDWrapper, s.jwtWrapper),
		server.NewTypedHandler("ke-opk-count", "/key-exchange/keys/count", server.GET, s.handleOPKCount, logIDWrapper, s.jwtWrapper),
	}
}

type emptyOK struct{}

func (s *subServer) handleUploadKeyBundle(ctx context.Context, req *uploadKeyBundleRequest) (*emptyOK, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	ikPub, err := decodeBase64Field("ik_pub", req.IkPub)
	if err != nil {
		return nil, server.BadRequestWithCause("invalid ik_pub", err)
	}
	spkPub, err := decodeBase64Field("spk_pub", req.SpkPub)
	if err != nil {
		return nil, server.BadRequestWithCause("invalid spk_pub", err)
	}
	spkSig, err := decodeBase64Field("spk_sig", req.SpkSig)
	if err != nil {
		return nil, server.BadRequestWithCause("invalid spk_sig", err)
	}
	if len(req.OpkIDs) != len(req.OpkPubs) {
		return nil, server.BadRequest("opk_ids and opk_pubs must have the same length")
	}
	opks := make([]domain.OneTimePreKey, 0, len(req.OpkIDs))
	for i := range req.OpkIDs {
		pk, derr := decodeBase64Field("opk_pubs", req.OpkPubs[i])
		if derr != nil {
			return nil, server.BadRequestWithCause("invalid opk_pubs entry", derr)
		}
		opks = append(opks, domain.OneTimePreKey{ID: req.OpkIDs[i], PublicKey: pk, Consumed: false})
	}
	if err := s.service.UploadKeyBundle(subject.ID, ikPub, req.SpkID, spkPub, spkSig, opks); err != nil {
		return nil, server.InternalErrorWithCause("failed to upload key bundle", err)
	}
	return &emptyOK{}, nil
}

func (s *subServer) handleFetchKeyBundleHTTP(ctx context.Context, req server.Request, resp server.Response) error {
	if auth.GetSubject(ctx) == nil {
		return server.Unauthorized("authentication required")
	}

	did, err := parseDidQuery(req.Path())
	if err != nil {
		return server.BadRequest(err.Error())
	}
	bundle, err := s.service.FetchKeyBundle(did)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return server.NotFound("key bundle not found or no prekeys available")
		}
		return server.InternalErrorWithCause("failed to fetch key bundle", err)
	}
	if len(bundle.OneTimePreKeys) == 0 {
		return server.NotFound("no one-time prekey available")
	}
	opk := bundle.OneTimePreKeys[0]
	out := fetchKeyBundleResponse{
		ActorDID:    bundle.ActorDID,
		IkPub:       base64.StdEncoding.EncodeToString(bundle.IdentityKeyPub),
		Fingerprint: bundle.KeyFingerprint,
		SpkID:       bundle.SignedPreKey.ID,
		SpkPub:      base64.StdEncoding.EncodeToString(bundle.SignedPreKey.PublicKey),
		SpkSig:      base64.StdEncoding.EncodeToString(bundle.SignedPreKey.Signature),
		OpkID:       opk.ID,
		OpkPub:      base64.StdEncoding.EncodeToString(opk.PublicKey),
	}
	data, err := json.Marshal(out)
	if err != nil {
		return server.InternalErrorWithCause("failed to encode response", err)
	}
	resp.SetHeader("Content-Type", "application/json")
	resp.WriteHeader(http.StatusOK)
	_, _ = resp.Write(data)
	return nil
}

func (s *subServer) handleReplenishOPKs(ctx context.Context, req *replenishOPKsRequest) (*emptyOK, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if len(req.OpkIDs) != len(req.OpkPubs) {
		return nil, server.BadRequest("opk_ids and opk_pubs must have the same length")
	}
	opks := make([]domain.OneTimePreKey, 0, len(req.OpkIDs))
	for i := range req.OpkIDs {
		pk, err := decodeBase64Field("opk_pubs", req.OpkPubs[i])
		if err != nil {
			return nil, server.BadRequestWithCause("invalid opk_pubs entry", err)
		}
		opks = append(opks, domain.OneTimePreKey{ID: req.OpkIDs[i], PublicKey: pk, Consumed: false})
	}
	if err := s.service.ReplenishOPKs(subject.ID, opks); err != nil {
		return nil, server.InternalErrorWithCause("failed to replenish one-time prekeys", err)
	}
	return &emptyOK{}, nil
}

type emptyGET struct{}

func (s *subServer) handleOPKCount(ctx context.Context, _ *emptyGET) (*opkCountResponse, error) {
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	n, err := s.service.CountOPKs(subject.ID)
	if err != nil {
		return nil, server.InternalErrorWithCause("failed to count one-time prekeys", err)
	}
	return &opkCountResponse{Count: n}, nil
}

func decodeBase64Field(field, value string) ([]byte, error) {
	if strings.TrimSpace(value) == "" {
		return nil, errors.New(field + " is empty")
	}
	return base64.StdEncoding.DecodeString(value)
}

func parseDidQuery(fullPath string) (string, error) {
	idx := strings.IndexByte(fullPath, '?')
	if idx < 0 || idx >= len(fullPath)-1 {
		return "", errors.New("did query parameter is required")
	}
	q, err := url.ParseQuery(fullPath[idx+1:])
	if err != nil {
		return "", errors.New("invalid query string")
	}
	did := strings.TrimSpace(q.Get("did"))
	if did == "" {
		return "", errors.New("did is required")
	}
	return did, nil
}
