package social

import (
	"context"
	"crypto/ed25519"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	sharedfederation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

type privateContentActorCapabilities interface {
	GetEndpointManifest(
		context.Context,
		string,
		*actormodel.GetActorEndpointManifestRequest,
	) (*actormodel.GetActorEndpointManifestResponse, error)
	ResolveActorHomeStationPeerID(context.Context, string) (string, error)
	ValidateEndpointManifest(
		*actormodel.ActorEndpointManifest,
		string,
		string,
		time.Time,
	) error
	AcceptVerifiedEndpointManifest(
		context.Context,
		*actormodel.ActorEndpointManifest,
	) error
	ResolveVerifiedActorDeviceSigningKey(
		context.Context,
		federationdelivery.Transaction,
		string,
		string,
		string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
}

type privateContentKeyExchangeCapabilities interface {
	ClaimContentPreKeys(
		context.Context,
		*securecontentpb.ClaimContentPreKeysRequest,
	) (*securecontentpb.ClaimContentPreKeysResponse, error)
	ValidateContentPreKeyClaims(
		context.Context,
		federationdelivery.Transaction,
		*securecontentpb.ClaimContentPreKeysRequest,
		*securecontentpb.ClaimContentPreKeysResponse,
	) error
}

type privateContentRecipientDirectory struct {
	actors  privateContentActorCapabilities
	runtime *sharedfederation.Runtime
	now     func() time.Time
}

func newPrivateContentRecipientDirectory(
	actors privateContentActorCapabilities,
	runtime *sharedfederation.Runtime,
) (*privateContentRecipientDirectory, error) {
	if actors == nil || runtime == nil {
		return nil, errors.New(
			"Social private recipient directory requires Actor Identity and Federation",
		)
	}
	return &privateContentRecipientDirectory{
		actors:  actors,
		runtime: runtime,
		now:     time.Now,
	}, nil
}

func (d *privateContentRecipientDirectory) ResolveContentPreKeyTargets(
	ctx context.Context,
	author *actormodel.ActorDeviceRef,
	recipientPTIDs []string,
) ([]*securecontentpb.ContentPreKeyClaimTarget, error) {
	if author == nil || author.GetActor() == nil {
		return nil, errors.New("Social private recipient author is required")
	}
	actors := append(
		[]string{author.GetActor().GetPtid()},
		recipientPTIDs...,
	)
	sort.Strings(actors)
	unique := actors[:0]
	for _, actorPTID := range actors {
		if strings.TrimSpace(actorPTID) == "" {
			return nil, errors.New("Social private recipient PTID is empty")
		}
		if len(unique) == 0 || unique[len(unique)-1] != actorPTID {
			unique = append(unique, actorPTID)
		}
	}

	targets := make(
		[]*securecontentpb.ContentPreKeyClaimTarget,
		0,
		len(unique)*2,
	)
	for _, actorPTID := range unique {
		manifest, err := d.endpointManifest(ctx, actorPTID)
		if err != nil {
			return nil, err
		}
		authorDeviceFound := actorPTID != author.GetActor().GetPtid()
		entries := append(
			[]*actormodel.ActorEndpointManifestEntry(nil),
			manifest.GetActiveEndpoints()...,
		)
		sort.Slice(entries, func(left int, right int) bool {
			return entries[left].GetEndpoint().GetDeviceId() <
				entries[right].GetEndpoint().GetDeviceId()
		})
		for _, entry := range entries {
			endpoint := entry.GetEndpoint()
			if endpoint == nil ||
				endpoint.GetActor() == nil ||
				endpoint.GetActor().GetPtid() != actorPTID ||
				strings.TrimSpace(endpoint.GetDeviceId()) == "" {
				return nil, errors.New(
					"Actor Identity returned an invalid active endpoint",
				)
			}
			if actorPTID == author.GetActor().GetPtid() &&
				endpoint.GetDeviceId() == author.GetDeviceId() {
				authorDeviceFound = true
			}
			targets = append(targets, contentEndpointTarget(
				actorPTID,
				endpoint.GetDeviceId(),
			))
		}
		if !authorDeviceFound {
			return nil, errors.New(
				"authenticated author device is not active in Actor Identity",
			)
		}
		targets = append(targets, contentRecoveryTarget(actorPTID))
	}
	return targets, nil
}

func (d *privateContentRecipientDirectory) ValidateActiveEndpoint(
	ctx context.Context,
	endpoint *actormodel.ActorDeviceRef,
) error {
	if endpoint == nil || endpoint.GetActor() == nil {
		return errors.New("active endpoint is required")
	}
	manifest, err := d.endpointManifest(
		ctx,
		endpoint.GetActor().GetPtid(),
	)
	if err != nil {
		return err
	}
	for _, entry := range manifest.GetActiveEndpoints() {
		if proto.Equal(entry.GetEndpoint(), endpoint) {
			return nil
		}
	}
	return errors.New("endpoint is not active in Actor Identity")
}

func (d *privateContentRecipientDirectory) endpointManifest(
	ctx context.Context,
	actorPTID string,
) (*actormodel.ActorEndpointManifest, error) {
	homeStation, err := d.actors.ResolveActorHomeStationPeerID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	localStation := d.runtime.LocalStationPeerID()
	request := &actormodel.GetActorEndpointManifestRequest{
		Actor: &actormodel.ActorRef{
			Ptid: actorPTID,
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
	}
	response := &actormodel.GetActorEndpointManifestResponse{}
	if homeStation == localStation {
		response, err = d.actors.GetEndpointManifest(
			ctx,
			localStation,
			request,
		)
	} else {
		err = d.runtime.CallPeer(ctx, sharedfederation.PeerCall{
			TargetStationPeerID: homeStation,
			Route:               sharedfederation.PeerRouteActorEndpointManifest,
			Subject:             localStation,
			Claims: map[string]string{
				sharedfederation.ClaimActorPTID:           actorPTID,
				sharedfederation.ClaimSourceStationPeerID: localStation,
				sharedfederation.ClaimTargetStationPeerID: homeStation,
			},
			Request:  request,
			Response: response,
		})
	}
	if err != nil {
		return nil, err
	}
	manifest := response.GetManifest()
	if err := d.actors.ValidateEndpointManifest(
		manifest,
		actorPTID,
		homeStation,
		d.now().UTC(),
	); err != nil {
		return nil, err
	}
	if homeStation != localStation {
		signingBytes, err := privateEndpointManifestSigningBytes(manifest)
		if err != nil {
			return nil, err
		}
		if err := d.runtime.VerifyPeerSignature(
			ctx,
			homeStation,
			manifest.GetSigningKeyId(),
			signingBytes,
			manifest.GetStationSignature(),
		); err != nil {
			return nil, err
		}
	}
	if err := d.actors.AcceptVerifiedEndpointManifest(ctx, manifest); err != nil {
		return nil, err
	}
	return proto.Clone(manifest).(*actormodel.ActorEndpointManifest), nil
}

type privateContentKeyExchangePort struct{}

func (privateContentKeyExchangePort) ClaimContentPreKeys(
	ctx context.Context,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	provider, err := resolvePrivateContentKeyExchange()
	if err != nil {
		return nil, err
	}
	return provider.ClaimContentPreKeys(ctx, request)
}

func (privateContentKeyExchangePort) ValidateContentPreKeyClaims(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
) error {
	provider, err := resolvePrivateContentKeyExchange()
	if err != nil {
		return err
	}
	return provider.ValidateContentPreKeyClaims(
		ctx,
		transaction,
		request,
		response,
	)
}

func resolvePrivateContentKeyExchange() (
	privateContentKeyExchangeCapabilities,
	error,
) {
	instance := server.GetOptions().SubserverInstances["key_exchange"]
	provider, ok := instance.(privateContentKeyExchangeCapabilities)
	if !ok || provider == nil {
		return nil, errors.New(
			"canonical Key Exchange Content PreKey capability is unavailable",
		)
	}
	return provider, nil
}

type privateContentStationSigner struct {
	stationPeerID     string
	proofKeyAuthority *authfed.ContentProofKeyAuthority
}

func (s privateContentStationSigner) SigningKeyID(
	ctx context.Context,
) (string, error) {
	if s.proofKeyAuthority == nil {
		return "", errors.New("Social private Station signer is unavailable")
	}
	return s.proofKeyAuthority.CurrentSigningKeyID(ctx)
}

func (s privateContentStationSigner) SigningKeyIDInTransaction(
	ctx context.Context,
	transaction federationdelivery.Transaction,
) (string, error) {
	if s.proofKeyAuthority == nil ||
		transaction == nil ||
		transaction.DB() == nil {
		return "", errors.New(
			"Social private transactional Station signer is unavailable",
		)
	}
	return s.proofKeyAuthority.CurrentSigningKeyIDInTransaction(
		ctx,
		transaction.DB(),
	)
}

func (s privateContentStationSigner) Sign(
	ctx context.Context,
	keyID string,
	canonical []byte,
) ([]byte, error) {
	if s.proofKeyAuthority == nil {
		return nil, errors.New("Social private Station signing input is invalid")
	}
	return s.proofKeyAuthority.SignWithCurrentKey(ctx, keyID, canonical)
}

func (s privateContentStationSigner) SignInTransaction(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	keyID string,
	canonical []byte,
) ([]byte, error) {
	if s.proofKeyAuthority == nil ||
		transaction == nil ||
		transaction.DB() == nil {
		return nil, errors.New(
			"Social private transactional Station signing input is invalid",
		)
	}
	return s.proofKeyAuthority.SignWithCurrentKeyInTransaction(
		ctx,
		transaction.DB(),
		keyID,
		canonical,
	)
}

func (s privateContentStationSigner) Verify(
	ctx context.Context,
	keyID string,
	canonical []byte,
	signature []byte,
) error {
	if s.proofKeyAuthority == nil ||
		strings.TrimSpace(s.stationPeerID) == "" ||
		strings.TrimSpace(keyID) == "" ||
		len(canonical) == 0 ||
		len(signature) != ed25519.SignatureSize {
		return errors.New("Social private Station verification input is invalid")
	}
	publicKey, err :=
		s.proofKeyAuthority.ResolveContentProofVerificationKey(
			ctx,
			s.stationPeerID,
			keyID,
		)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, canonical, signature) {
		return errors.New("Social private Station signature is invalid")
	}
	return nil
}

func (s privateContentStationSigner) VerifyInTransaction(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	keyID string,
	canonical []byte,
	signature []byte,
) error {
	if s.proofKeyAuthority == nil ||
		transaction == nil ||
		transaction.DB() == nil ||
		strings.TrimSpace(s.stationPeerID) == "" ||
		strings.TrimSpace(keyID) == "" ||
		len(canonical) == 0 ||
		len(signature) != ed25519.SignatureSize {
		return errors.New(
			"Social private transactional Station verification input is invalid",
		)
	}
	publicKey, err :=
		s.proofKeyAuthority.ResolveContentProofVerificationKeyInTransaction(
			ctx,
			transaction.DB(),
			s.stationPeerID,
			keyID,
		)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, canonical, signature) {
		return errors.New("Social private Station signature is invalid")
	}
	return nil
}

func (s privateContentStationSigner) AttestContentProofVerificationKey(
	ctx context.Context,
	signingKeyID string,
	now time.Time,
) (*securecontentpb.StationContentSigningKeyAttestation, error) {
	if s.proofKeyAuthority == nil {
		return nil, errors.New(
			"Social private Station proof-key authority is unavailable",
		)
	}
	return s.proofKeyAuthority.AttestContentProofVerificationKey(
		ctx,
		signingKeyID,
		now,
	)
}

type privateContentAuthorSignatureVerifier struct {
	actors privateContentActorCapabilities
}

func (v privateContentAuthorSignatureVerifier) Verify(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	sender *actormodel.ActorDeviceRef,
	signingKeyID string,
	canonical []byte,
	signature []byte,
) error {
	if v.actors == nil ||
		sender == nil ||
		sender.GetActor() == nil ||
		len(canonical) == 0 ||
		len(signature) != ed25519.SignatureSize {
		return errors.New("Social private author signature is incomplete")
	}
	key, err := v.actors.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		transaction,
		sender.GetActor().GetPtid(),
		sender.GetDeviceId(),
		signingKeyID,
	)
	if err != nil {
		return err
	}
	if key == nil ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		!ed25519.Verify(
			ed25519.PublicKey(key.GetEd25519PublicKey()),
			canonical,
			signature,
		) {
		return errors.New("Social private author signature is invalid")
	}
	return nil
}

type privateContentSystemClock struct{}

func (privateContentSystemClock) Now() time.Time {
	return time.Now().UTC()
}

func resolvePrivateContentActorCapabilities() (
	privateContentActorCapabilities,
	error,
) {
	instance := server.GetOptions().SubserverInstances["actor_identity"]
	provider, ok := instance.(privateContentActorCapabilities)
	if !ok || provider == nil {
		return nil, errors.New(
			"canonical Actor Identity capability is unavailable",
		)
	}
	return provider, nil
}

func contentEndpointTarget(
	actorPTID string,
	deviceID string,
) *securecontentpb.ContentPreKeyClaimTarget {
	return &securecontentpb.ContentPreKeyClaimTarget{
		Kind: securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
		Principal: &securecontentpb.ContentPreKeyClaimTarget_Endpoint{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor:    &actormodel.ActorRef{Ptid: actorPTID},
				DeviceId: deviceID,
			},
		},
	}
}

func contentRecoveryTarget(
	actorPTID string,
) *securecontentpb.ContentPreKeyClaimTarget {
	return &securecontentpb.ContentPreKeyClaimTarget{
		Kind: securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY,
		Principal: &securecontentpb.ContentPreKeyClaimTarget_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{Ptid: actorPTID},
		},
	}
}

func privateEndpointManifestSigningBytes(
	manifest *actormodel.ActorEndpointManifest,
) ([]byte, error) {
	if manifest == nil {
		return nil, errors.New("Actor endpoint manifest is required")
	}
	entries := make(
		[]*actormodel.ActorEndpointManifestEntry,
		0,
		len(manifest.GetActiveEndpoints()),
	)
	for _, entry := range manifest.GetActiveEndpoints() {
		entries = append(
			entries,
			proto.Clone(entry).(*actormodel.ActorEndpointManifestEntry),
		)
	}
	input := &actormodel.ActorEndpointManifestSigningInput{
		FormatVersion:          manifest.GetFormatVersion(),
		ManifestId:             manifest.GetManifestId(),
		Actor:                  proto.Clone(manifest.GetActor()).(*actormodel.ActorRef),
		HomeStationPeerId:      manifest.GetHomeStationPeerId(),
		DirectoryVersion:       manifest.GetDirectoryVersion(),
		ActiveEndpoints:        entries,
		IssuedAt:               manifest.GetIssuedAt(),
		ExpiresAt:              manifest.GetExpiresAt(),
		SigningKeyId:           manifest.GetSigningKeyId(),
		ActorIdentityPublicKey: append([]byte(nil), manifest.GetActorIdentityPublicKey()...),
		ActorProfileVersion:    manifest.GetActorProfileVersion(),
	}
	return proto.MarshalOptions{Deterministic: true}.Marshal(input)
}

var (
	_ application.PrivateRecipientDirectory             = (*privateContentRecipientDirectory)(nil)
	_ application.PrivateContentKeyExchange             = privateContentKeyExchangePort{}
	_ application.PrivateContentStationSigner           = privateContentStationSigner{}
	_ application.PrivateContentAuthorSignatureVerifier = privateContentAuthorSignatureVerifier{}
)
