package application

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"sort"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

const EndpointManifestFormatVersion uint32 = 1

func SignEndpointManifest(
	manifest *chat.FederatedEndpointManifest,
	signingKeyID string,
	privateKey ed25519.PrivateKey,
) error {
	if manifest == nil || signingKeyID == "" || len(privateKey) != ed25519.PrivateKeySize {
		return messaging.ErrEndpointManifestInvalid
	}
	manifest.FormatVersion = EndpointManifestFormatVersion
	manifest.SigningKeyId = signingKeyID
	if err := validateEndpointManifestShape(manifest); err != nil {
		return err
	}
	input := endpointManifestSigningInput(manifest)
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	manifest.StationSignature = ed25519.Sign(privateKey, signingBytes)
	return nil
}

func VerifyEndpointManifest(
	manifest *chat.FederatedEndpointManifest,
	expectedActorPTID string,
	expectedHomeStationID string,
	expectedSigningKeyID string,
	publicKey ed25519.PublicKey,
	now time.Time,
) error {
	if manifest == nil ||
		expectedActorPTID == "" ||
		expectedHomeStationID == "" ||
		expectedSigningKeyID == "" ||
		manifest.ActorPtid != expectedActorPTID ||
		manifest.HomeStationId != expectedHomeStationID ||
		manifest.SigningKeyId != expectedSigningKeyID ||
		len(publicKey) != ed25519.PublicKeySize ||
		len(manifest.StationSignature) != ed25519.SignatureSize {
		return messaging.ErrEndpointManifestInvalid
	}
	if err := validateEndpointManifestShape(manifest); err != nil {
		return err
	}
	if manifest.ExpiresAt.AsTime().Before(now) ||
		manifest.IssuedAt.AsTime().After(now.Add(time.Minute)) {
		return messaging.ErrEndpointManifestExpired
	}
	input := endpointManifestSigningInput(manifest)
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, signingBytes, manifest.StationSignature) {
		return messaging.ErrEndpointManifestSignature
	}
	return nil
}

func EndpointManifestSHA256(
	manifest *chat.FederatedEndpointManifest,
) ([]byte, []byte, error) {
	manifestBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(manifest)
	if err != nil {
		return nil, nil, err
	}
	hash := sha256.Sum256(manifestBytes)
	return manifestBytes, hash[:], nil
}

func SameEndpointManifestState(
	left *chat.FederatedEndpointManifest,
	right *chat.FederatedEndpointManifest,
) bool {
	if left == nil || right == nil {
		return false
	}
	return proto.Equal(
		&chat.FederatedEndpointManifestSigningInput{
			FormatVersion:          left.FormatVersion,
			ActorPtid:              left.ActorPtid,
			HomeStationId:          left.HomeStationId,
			DirectoryVersion:       left.DirectoryVersion,
			ActiveEndpoints:        left.ActiveEndpoints,
			ActorIdentityPublicKey: left.ActorIdentityPublicKey,
			ActorProfileVersion:    left.ActorProfileVersion,
		},
		&chat.FederatedEndpointManifestSigningInput{
			FormatVersion:          right.FormatVersion,
			ActorPtid:              right.ActorPtid,
			HomeStationId:          right.HomeStationId,
			DirectoryVersion:       right.DirectoryVersion,
			ActiveEndpoints:        right.ActiveEndpoints,
			ActorIdentityPublicKey: right.ActorIdentityPublicKey,
			ActorProfileVersion:    right.ActorProfileVersion,
		},
	)
}

func validateEndpointManifestShape(manifest *chat.FederatedEndpointManifest) error {
	if manifest.FormatVersion != EndpointManifestFormatVersion ||
		manifest.ManifestId == "" ||
		manifest.ActorPtid == "" ||
		manifest.HomeStationId == "" ||
		manifest.DirectoryVersion == 0 ||
		len(manifest.ActorIdentityPublicKey) != ed25519.PublicKeySize ||
		manifest.ActorProfileVersion == 0 ||
		len(manifest.ActiveEndpoints) == 0 ||
		manifest.IssuedAt == nil ||
		manifest.ExpiresAt == nil ||
		!manifest.ExpiresAt.AsTime().After(manifest.IssuedAt.AsTime()) ||
		manifest.ExpiresAt.AsTime().After(manifest.IssuedAt.AsTime().Add(time.Hour)) {
		return messaging.ErrEndpointManifestInvalid
	}
	previous := ""
	for _, entry := range manifest.ActiveEndpoints {
		if entry == nil ||
			entry.Endpoint == nil ||
			entry.Endpoint.Ptid != manifest.ActorPtid ||
			entry.Endpoint.DeviceId == "" ||
			entry.SigningKeyId == "" ||
			len(entry.PublicMaterialSha256) == 0 {
			return messaging.ErrEndpointManifestInvalid
		}
		key := entry.Endpoint.Ptid + "\x00" + entry.Endpoint.DeviceId
		if previous != "" && key <= previous {
			return messaging.ErrEndpointManifestInvalid
		}
		previous = key
		if !sort.SliceIsSorted(entry.PublicMaterialSha256, func(i, j int) bool {
			return bytes.Compare(
				entry.PublicMaterialSha256[i],
				entry.PublicMaterialSha256[j],
			) < 0
		}) {
			return messaging.ErrEndpointManifestInvalid
		}
		for index, materialHash := range entry.PublicMaterialSha256 {
			if len(materialHash) != sha256.Size ||
				(index > 0 &&
					bytes.Equal(materialHash, entry.PublicMaterialSha256[index-1])) {
				return messaging.ErrEndpointManifestInvalid
			}
		}
	}
	return nil
}

func endpointManifestSigningInput(
	manifest *chat.FederatedEndpointManifest,
) *chat.FederatedEndpointManifestSigningInput {
	return &chat.FederatedEndpointManifestSigningInput{
		FormatVersion:          manifest.FormatVersion,
		ManifestId:             manifest.ManifestId,
		ActorPtid:              manifest.ActorPtid,
		HomeStationId:          manifest.HomeStationId,
		DirectoryVersion:       manifest.DirectoryVersion,
		ActiveEndpoints:        manifest.ActiveEndpoints,
		IssuedAt:               manifest.IssuedAt,
		ExpiresAt:              manifest.ExpiresAt,
		SigningKeyId:           manifest.SigningKeyId,
		ActorIdentityPublicKey: manifest.ActorIdentityPublicKey,
		ActorProfileVersion:    manifest.ActorProfileVersion,
	}
}
