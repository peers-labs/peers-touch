// Package bootstrapblob owns bounded, opaque network bootstrap material.
package bootstrapblob

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

const (
	RetrievalPath  = "/.well-known/peers-touch/bootstrap"
	PublishPath    = "/api/v1/relay/bootstrap-blobs"
	maxEntries     = 256
	maxNodeEntries = 16
)

var (
	ErrUnavailable = errors.New("bootstrap blob unavailable")
	ErrCapacity    = errors.New("bootstrap blob capacity exceeded")
	ErrSourceLimit = errors.New("bootstrap blob source limit reached")
)

type record struct {
	message       *peerpb.PublishBootstrapBlobRequest
	verified      *peerpb.VerifiedBootstrapBlob
	ownerRevision uint64
	sources       map[string]uint32
}

// Store is volatile. Restart discards outstanding ciphertext and fails closed.
// The caller fences enrollment changes around Publish/Retrieve.
type Store struct {
	mu      sync.Mutex
	entries map[string]record
}

func NewStore() *Store { return &Store{entries: make(map[string]record)} }

func (s *Store) Publish(message *peerpb.PublishBootstrapBlobRequest, endpointID string, ownerRevision uint64, now time.Time) (*peerpb.PublishBootstrapBlobResponse, error) {
	if s == nil || ownerRevision == 0 {
		return nil, ErrUnavailable
	}
	verified, err := peerpb.VerifyBootstrapBlob(message, now)
	if err != nil {
		return nil, err
	}
	statement := verified.Statement
	if statement.GetRetrievalEndpointIdentity() != endpointID {
		return nil, peerpb.ErrBootstrapBlobInvalid
	}
	key := hex.EncodeToString(statement.GetLocatorDigest())
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep(now)
	if existing, ok := s.entries[key]; ok {
		if existing.ownerRevision != ownerRevision || !proto.Equal(existing.message, message) {
			return nil, peerpb.ErrBootstrapBlobInvalid
		}
		return result(statement), nil
	}
	if len(s.entries) >= maxEntries {
		return nil, ErrCapacity
	}
	nodeEntries := 0
	for _, entry := range s.entries {
		if entry.verified.Authorization.Statement.GetNodePeerId() == verified.Authorization.Statement.GetNodePeerId() {
			nodeEntries++
		}
	}
	if nodeEntries >= maxNodeEntries {
		return nil, ErrCapacity
	}
	s.entries[key] = record{
		message:  proto.Clone(message).(*peerpb.PublishBootstrapBlobRequest),
		verified: verified, ownerRevision: ownerRevision, sources: make(map[string]uint32),
	}
	return result(statement), nil
}

func result(statement *peerpb.BootstrapBlobStatement) *peerpb.PublishBootstrapBlobResponse {
	return &peerpb.PublishBootstrapBlobResponse{
		BlobDigest: append([]byte(nil), statement.GetBlobDigest()...), ExpiresAtUnixMs: statement.GetExpiresAtUnixMs(),
	}
}

// Retrieve checks the current owner before consuming one source slot. It does
// not redeem a connection grant or publish a Circuit permit.
func (s *Store) Retrieve(
	ctx context.Context, request *peerpb.RetrieveBootstrapBlobRequest, endpointID string,
	now time.Time, current func(context.Context, *peerpb.VerifiedBootstrapBlob, uint64) bool,
) (*peerpb.RetrieveBootstrapBlobResponse, error) {
	if s == nil || request == nil || len(request.GetLocator()) != sha256.Size ||
		len(request.ProtoReflect().GetUnknown()) != 0 || current == nil {
		return nil, ErrUnavailable
	}
	digest := sha256.Sum256(request.GetLocator())
	source, err := peerpb.VerifyAccessEndpointSourceProof(request.GetSourceProof())
	if err != nil || !bytes.Equal(source.Statement.GetConnectionGrantDigest(), digest[:]) ||
		source.Statement.GetRelayPeerId() != endpointID || source.Statement.GetClientProtocolVersion() != 1 {
		return nil, peerpb.ErrAccessEndpointSourceProofInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep(now)
	entry, ok := s.entries[hex.EncodeToString(digest[:])]
	if !ok || !current(ctx, entry.verified, entry.ownerRevision) {
		return nil, ErrUnavailable
	}
	if entry.verified.Statement.GetRetrievalEndpointIdentity() != endpointID {
		return nil, ErrUnavailable
	}
	id := source.SourcePeerID.String()
	if _, exists := entry.sources[id]; !exists {
		if uint32(len(entry.sources)) >= entry.verified.Statement.GetMaxSources() {
			return nil, ErrSourceLimit
		}
	}
	// Retries retain their source slot, but cannot produce unbounded traffic.
	if entry.sources[id] >= 16 {
		return nil, ErrCapacity
	}
	entry.sources[id]++
	return &peerpb.RetrieveBootstrapBlobResponse{
		StatementBytes:    append([]byte(nil), entry.message.GetStatementBytes()...),
		SealedBlob:        append([]byte(nil), entry.message.GetSealedBlob()...),
		NodeSignature:     append([]byte(nil), entry.message.GetNodeSignature()...),
		NodeAuthorization: proto.Clone(entry.message.GetNodeAuthorization()).(*peerpb.StationNodeAuthorization),
	}, nil
}

func (s *Store) InvalidateNode(stationID, nodeID string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, entry := range s.entries {
		auth := entry.verified.Authorization.Statement
		if auth.GetStationPeerId() == stationID && auth.GetNodePeerId() == nodeID {
			delete(s.entries, key)
		}
	}
}

func (s *Store) Clear() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	clear(s.entries)
}

func (s *Store) sweep(now time.Time) {
	for key, entry := range s.entries {
		if entry.verified.Statement.GetExpiresAtUnixMs() <= now.UnixMilli() {
			delete(s.entries, key)
		}
	}
}
