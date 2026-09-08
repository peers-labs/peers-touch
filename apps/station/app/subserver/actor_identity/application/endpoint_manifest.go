package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

const (
	// EndpointManifestFormatVersion is the canonical Actor-owned manifest format.
	EndpointManifestFormatVersion uint32 = 1
	// EndpointManifestTTL bounds routing snapshots so device changes converge quickly.
	EndpointManifestTTL = 5 * time.Minute
)

// EndpointManifestRepository builds one transactionally consistent Actor snapshot.
type EndpointManifestRepository interface {
	BuildLocalEndpointManifestSnapshot(
		ctx context.Context,
		actor *actormodel.ActorRef,
		homeStationPeerID string,
		issuedAt time.Time,
		expiresAt time.Time,
	) (*actormodel.ActorEndpointManifest, error)
	AcceptVerifiedEndpointManifest(
		ctx context.Context,
		manifest *actormodel.ActorEndpointManifest,
		acceptedAt time.Time,
	) error
}

// EndpointManifestSigner applies the current Station identity to one manifest.
type EndpointManifestSigner interface {
	SignEndpointManifest(
		ctx context.Context,
		manifest *actormodel.ActorEndpointManifest,
	) error
}

// EndpointManifestSignerFunc adapts a function to EndpointManifestSigner.
type EndpointManifestSignerFunc func(
	context.Context,
	*actormodel.ActorEndpointManifest,
) error

// SignEndpointManifest delegates to the adapted signer.
func (f EndpointManifestSignerFunc) SignEndpointManifest(
	ctx context.Context,
	manifest *actormodel.ActorEndpointManifest,
) error {
	return f(ctx, manifest)
}

// EndpointManifestService owns Actor endpoint-directory snapshot semantics.
type EndpointManifestService struct {
	repository         EndpointManifestRepository
	signer             EndpointManifestSigner
	localStationPeerID string
	clock              Clock
}

// NewEndpointManifestService constructs the Actor-owned manifest capability.
func NewEndpointManifestService(
	repository EndpointManifestRepository,
	signer EndpointManifestSigner,
	localStationPeerID string,
	clock Clock,
) (*EndpointManifestService, error) {
	const operation = "actor_identity.new_endpoint_manifest_service"

	if repository == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"repository",
			"is required",
		)
	}
	if signer == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"signer",
			"is required",
		)
	}
	if localStationPeerID == "" ||
		localStationPeerID != strings.TrimSpace(localStationPeerID) {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"local_station_peer_id",
			"is required and must be canonical",
		)
	}
	if clock == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"clock",
			"is required",
		)
	}

	return &EndpointManifestService{
		repository:         repository,
		signer:             signer,
		localStationPeerID: localStationPeerID,
		clock:              clock,
	}, nil
}

// GetEndpointManifest returns a fresh Home Station-signed routing snapshot.
func (s *EndpointManifestService) GetEndpointManifest(
	ctx context.Context,
	sourceStationPeerID string,
	request *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	const operation = "actor_identity.get_endpoint_manifest"

	if sourceStationPeerID == "" ||
		sourceStationPeerID != strings.TrimSpace(sourceStationPeerID) {
		return nil, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"source_station_peer_id",
			"is required and must be canonical",
		)
	}
	if request == nil || request.GetActor() == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"actor",
			"is required",
		)
	}
	actor := proto.Clone(request.GetActor()).(*actormodel.ActorRef)
	if err := validateManifestActor(operation, actor); err != nil {
		return nil, err
	}

	issuedAt := s.clock().UTC().Truncate(time.Microsecond)
	manifest, err := s.repository.BuildLocalEndpointManifestSnapshot(
		ctx,
		actor,
		s.localStationPeerID,
		issuedAt,
		issuedAt.Add(EndpointManifestTTL),
	)
	if err != nil {
		return nil, err
	}
	if err := s.signer.SignEndpointManifest(ctx, manifest); err != nil {
		if domain.CodeOf(err) != "" {
			return nil, err
		}

		return nil, domain.WrapError(
			domain.ErrorCodeIdentityUnavailable,
			operation,
			err,
		)
	}

	return &actormodel.GetActorEndpointManifestResponse{
		Manifest: proto.Clone(manifest).(*actormodel.ActorEndpointManifest),
	}, nil
}

// AcceptVerifiedEndpointManifest records the verified Actor identity
// continuity key and highest directory version as one persistence operation.
// The caller must verify the Home Station signature before invoking this edge.
func (s *EndpointManifestService) AcceptVerifiedEndpointManifest(
	ctx context.Context,
	manifest *actormodel.ActorEndpointManifest,
) error {
	if s == nil || s.repository == nil || s.clock == nil || manifest == nil {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"actor_identity.accept_endpoint_manifest",
			"manifest",
			"is required",
		)
	}
	if err := ValidateEndpointManifest(
		manifest,
		manifest.GetActor().GetPtid(),
		manifest.GetHomeStationPeerId(),
		s.clock().UTC(),
	); err != nil {
		return err
	}

	return s.repository.AcceptVerifiedEndpointManifest(
		ctx,
		proto.Clone(manifest).(*actormodel.ActorEndpointManifest),
		s.clock().UTC(),
	)
}

// SignEndpointManifest signs the canonical protobuf projection with one Station key.
func SignEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	signingKeyID string,
	privateKey ed25519.PrivateKey,
) error {
	const operation = "actor_identity.sign_endpoint_manifest"

	if manifest == nil ||
		signingKeyID == "" ||
		signingKeyID != strings.TrimSpace(signingKeyID) ||
		len(privateKey) != ed25519.PrivateKeySize {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"signing_identity",
			"is incomplete",
		)
	}
	manifest.FormatVersion = EndpointManifestFormatVersion
	manifest.SigningKeyId = signingKeyID
	if err := validateEndpointManifestShape(operation, manifest); err != nil {
		return err
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		endpointManifestSigningInput(manifest),
	)
	if err != nil {
		return domain.WrapError(domain.ErrorCodeInvalidProof, operation, err)
	}
	manifest.StationSignature = ed25519.Sign(privateKey, signingBytes)

	return nil
}

// VerifyEndpointManifest validates identity, freshness, shape, and Station signature.
func VerifyEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	expectedActorPTID string,
	expectedHomeStationPeerID string,
	expectedSigningKeyID string,
	publicKey ed25519.PublicKey,
	now time.Time,
) error {
	const operation = "actor_identity.verify_endpoint_manifest"

	if manifest == nil || manifest.GetSigningKeyId() != expectedSigningKeyID ||
		len(publicKey) != ed25519.PublicKeySize ||
		len(manifest.GetStationSignature()) != ed25519.SignatureSize {
		return domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"manifest_binding",
			"does not match the expected Actor and Home Station",
		)
	}
	if err := ValidateEndpointManifest(
		manifest,
		expectedActorPTID,
		expectedHomeStationPeerID,
		now,
	); err != nil {
		return err
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		endpointManifestSigningInput(manifest),
	)
	if err != nil {
		return domain.WrapError(domain.ErrorCodeInvalidProof, operation, err)
	}
	if !ed25519.Verify(publicKey, signingBytes, manifest.GetStationSignature()) {
		return domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"station_signature",
			"is invalid",
		)
	}

	return nil
}

// ValidateEndpointManifest checks the Actor-owned snapshot binding, canonical
// shape, and lifetime independently from the caller's Station key resolver.
func ValidateEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	expectedActorPTID string,
	expectedHomeStationPeerID string,
	now time.Time,
) error {
	const operation = "actor_identity.validate_endpoint_manifest"

	if manifest == nil ||
		manifest.GetActor().GetPtid() != expectedActorPTID ||
		manifest.GetHomeStationPeerId() != expectedHomeStationPeerID {
		return domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"manifest_binding",
			"does not match the expected Actor and Home Station",
		)
	}
	if err := validateEndpointManifestShape(operation, manifest); err != nil {
		return err
	}
	if !manifest.GetExpiresAt().AsTime().After(now.UTC()) ||
		manifest.GetIssuedAt().AsTime().After(now.UTC().Add(time.Minute)) {
		return domain.NewError(
			domain.ErrorCodeIdentityUnavailable,
			operation,
			"manifest_lifetime",
			"is expired or not yet valid",
		)
	}

	return nil
}

func validateEndpointManifestShape(
	operation string,
	manifest *actormodel.ActorEndpointManifest,
) error {
	if manifest == nil ||
		manifest.GetFormatVersion() != EndpointManifestFormatVersion ||
		strings.TrimSpace(manifest.GetManifestId()) == "" ||
		manifest.GetHomeStationPeerId() == "" ||
		manifest.GetHomeStationPeerId() !=
			strings.TrimSpace(manifest.GetHomeStationPeerId()) ||
		manifest.GetDirectoryVersion() == 0 ||
		len(manifest.GetActorIdentityPublicKey()) != ed25519.PublicKeySize ||
		manifest.GetActorProfileVersion() == 0 ||
		len(manifest.GetActiveEndpoints()) == 0 ||
		manifest.GetIssuedAt() == nil ||
		manifest.GetIssuedAt().CheckValid() != nil ||
		manifest.GetExpiresAt() == nil ||
		manifest.GetExpiresAt().CheckValid() != nil ||
		!manifest.GetExpiresAt().AsTime().After(manifest.GetIssuedAt().AsTime()) ||
		manifest.GetExpiresAt().AsTime().After(
			manifest.GetIssuedAt().AsTime().Add(time.Hour),
		) ||
		manifest.GetSigningKeyId() == "" ||
		manifest.GetSigningKeyId() != strings.TrimSpace(manifest.GetSigningKeyId()) {
		return domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"manifest",
			"has an invalid canonical shape",
		)
	}
	if err := validateManifestActor(operation, manifest.GetActor()); err != nil {
		return err
	}

	previousEndpoint := ""
	for _, entry := range manifest.GetActiveEndpoints() {
		if entry == nil ||
			entry.GetEndpoint() == nil ||
			entry.GetEndpoint().GetActor() == nil ||
			!proto.Equal(entry.GetEndpoint().GetActor(), manifest.GetActor()) ||
			entry.GetEndpoint().GetDeviceId() == "" ||
			entry.GetEndpoint().GetDeviceId() !=
				strings.TrimSpace(entry.GetEndpoint().GetDeviceId()) ||
			entry.GetSigningKeyId() == "" ||
			entry.GetSigningKeyId() != strings.TrimSpace(entry.GetSigningKeyId()) ||
			len(entry.GetPublicMaterialSha256()) == 0 {
			return domain.NewError(
				domain.ErrorCodeInvalidProof,
				operation,
				"active_endpoints",
				"contain an invalid Actor device binding",
			)
		}
		endpointKey := entry.GetEndpoint().GetActor().GetPtid() +
			"\x00" + entry.GetEndpoint().GetDeviceId()
		if previousEndpoint != "" && endpointKey <= previousEndpoint {
			return domain.NewError(
				domain.ErrorCodeInvalidProof,
				operation,
				"active_endpoints",
				"must be strictly ordered and unique",
			)
		}
		previousEndpoint = endpointKey
		if !sort.SliceIsSorted(
			entry.GetPublicMaterialSha256(),
			func(left int, right int) bool {
				return bytes.Compare(
					entry.GetPublicMaterialSha256()[left],
					entry.GetPublicMaterialSha256()[right],
				) < 0
			},
		) {
			return domain.NewError(
				domain.ErrorCodeInvalidProof,
				operation,
				"public_material_sha256",
				"must be sorted",
			)
		}
		for index, materialHash := range entry.GetPublicMaterialSha256() {
			if len(materialHash) != 32 ||
				(index > 0 &&
					bytes.Equal(
						materialHash,
						entry.GetPublicMaterialSha256()[index-1],
					)) {
				return domain.NewError(
					domain.ErrorCodeInvalidProof,
					operation,
					"public_material_sha256",
					"must contain unique SHA-256 values",
				)
			}
		}
	}

	return nil
}

func validateManifestActor(operation string, actor *actormodel.ActorRef) error {
	if actor == nil {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"actor",
			"is required",
		)
	}
	if err := domain.ValidatePTID(operation, actor.GetPtid()); err != nil {
		return err
	}
	if actor.GetAcct() != strings.TrimSpace(actor.GetAcct()) {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"actor.acct",
			"must be canonical",
		)
	}
	switch actor.GetKind() {
	case actormodel.ActorKind_ACTOR_KIND_PERSON,
		actormodel.ActorKind_ACTOR_KIND_GROUP,
		actormodel.ActorKind_ACTOR_KIND_ORGANIZATION,
		actormodel.ActorKind_ACTOR_KIND_SERVICE,
		actormodel.ActorKind_ACTOR_KIND_APPLICATION,
		actormodel.ActorKind_ACTOR_KIND_NODE:
		return nil
	default:
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"actor.kind",
			"must identify a concrete Actor kind",
		)
	}
}

func endpointManifestSigningInput(
	manifest *actormodel.ActorEndpointManifest,
) *actormodel.ActorEndpointManifestSigningInput {
	return &actormodel.ActorEndpointManifestSigningInput{
		FormatVersion:          manifest.GetFormatVersion(),
		ManifestId:             manifest.GetManifestId(),
		Actor:                  proto.Clone(manifest.GetActor()).(*actormodel.ActorRef),
		HomeStationPeerId:      manifest.GetHomeStationPeerId(),
		DirectoryVersion:       manifest.GetDirectoryVersion(),
		ActiveEndpoints:        cloneEndpointManifestEntries(manifest.GetActiveEndpoints()),
		IssuedAt:               manifest.GetIssuedAt(),
		ExpiresAt:              manifest.GetExpiresAt(),
		SigningKeyId:           manifest.GetSigningKeyId(),
		ActorIdentityPublicKey: append([]byte(nil), manifest.GetActorIdentityPublicKey()...),
		ActorProfileVersion:    manifest.GetActorProfileVersion(),
	}
}

func cloneEndpointManifestEntries(
	entries []*actormodel.ActorEndpointManifestEntry,
) []*actormodel.ActorEndpointManifestEntry {
	cloned := make([]*actormodel.ActorEndpointManifestEntry, 0, len(entries))
	for _, entry := range entries {
		cloned = append(
			cloned,
			proto.Clone(entry).(*actormodel.ActorEndpointManifestEntry),
		)
	}

	return cloned
}
