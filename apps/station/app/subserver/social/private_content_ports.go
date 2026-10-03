package social

import (
	"context"
	"crypto/ed25519"
	"errors"
	"sort"
	"strings"
	"time"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
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
		ctx context.Context,
		transaction federationdelivery.Transaction,
		actorPTID string,
		expectedHomeStationPeerID string,
		deviceID string,
		signingKeyID string,
	) (*actormodel.VerifiedActorDeviceSigningKey, error)
}

type privateContentKeyExchangeCapabilities interface {
	ClaimContentPreKeys(
		context.Context,
		*securecontentpb.ClaimContentPreKeysRequest,
	) (*securecontentpb.ClaimContentPreKeysResponse, error)
	ClaimRemoteContentPreKeys(
		context.Context,
		string,
		string,
		*securecontentpb.ClaimContentPreKeysRequest,
	) (*securecontentpb.ClaimContentPreKeysResponse, error)
	ValidateContentPreKeyClaims(
		context.Context,
		federationdelivery.Transaction,
		*securecontentpb.ClaimContentPreKeysRequest,
		*securecontentpb.ClaimContentPreKeysResponse,
	) error
}

type privateContentFriendFederationResolver interface {
	ResolveAcceptedFriendFederation(
		context.Context,
		string,
		string,
		string,
		string,
	) (string, error)
}

type privateContentFederationMembership interface {
	ValidateActiveStationPair(
		context.Context,
		string,
		string,
		string,
	) error
}

type privateContentRecipientDirectory struct {
	actors      privateContentActorCapabilities
	runtime     *sharedfederation.Runtime
	friendships privateContentFriendFederationResolver
	membership  privateContentFederationMembership
	now         func() time.Time
}

func newPrivateContentRecipientDirectory(
	actors privateContentActorCapabilities,
	runtime *sharedfederation.Runtime,
	friendships privateContentFriendFederationResolver,
	membership privateContentFederationMembership,
) (*privateContentRecipientDirectory, error) {
	if actors == nil ||
		runtime == nil ||
		friendships == nil ||
		membership == nil {
		return nil, nil
	}
	return &privateContentRecipientDirectory{
		actors:      actors,
		runtime:     runtime,
		friendships: friendships,
		membership:  membership,
		now:         time.Now,
	}, nil
}

func (d *privateContentRecipientDirectory) ResolveRecipientLocalities(
	ctx context.Context,
	authorPTID string,
	localStationPeerID string,
	recipientPTIDs []string,
) ([]socialdomain.RecipientLocality, error) {
	const operation = "social.private_content.resolve_recipient_localities"

	if strings.TrimSpace(localStationPeerID) == "" ||
		localStationPeerID != strings.TrimSpace(localStationPeerID) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"local_station_peer_id",
			"must be canonical",
		)
	}
	actors := append([]string(nil), recipientPTIDs...)
	sort.Strings(actors)
	localities := make([]socialdomain.RecipientLocality, 0, len(actors))
	previous := ""
	for _, actorPTID := range actors {
		if strings.TrimSpace(actorPTID) == "" ||
			actorPTID != strings.TrimSpace(actorPTID) ||
			actorPTID == previous {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"recipient_ptids",
				"must be canonical and unique",
			)
		}
		homeStationPeerID, err :=
			d.actors.ResolveActorHomeStationPeerID(ctx, actorPTID)
		if err != nil {
			var identityError *actoridentitydomain.Error
			if errors.As(err, &identityError) &&
				identityError.Code ==
					actoridentitydomain.ErrorCodeIdentityUnavailable &&
				identityError.Field == "home_station_peer_id" {
				return nil, socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentUnsupported,
					operation,
					err,
				)
			}
			return nil, err
		}
		if strings.TrimSpace(homeStationPeerID) == "" ||
			homeStationPeerID != strings.TrimSpace(homeStationPeerID) {
			return nil, errors.New(
				"Actor Identity returned an invalid Home Station",
			)
		}
		federationID := ""
		if homeStationPeerID != localStationPeerID {
			federationID, err = d.friendships.ResolveAcceptedFriendFederation(
				ctx,
				authorPTID,
				actorPTID,
				localStationPeerID,
				homeStationPeerID,
			)
			if err != nil {
				return nil, err
			}
			if err := d.membership.ValidateActiveStationPair(
				ctx,
				federationID,
				localStationPeerID,
				homeStationPeerID,
			); err != nil {
				return nil, socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentUnsupported,
					operation,
					err,
				)
			}
		}
		localities = append(localities, socialdomain.RecipientLocality{
			ActorPTID:         actorPTID,
			HomeStationPeerID: homeStationPeerID,
			FederationID:      federationID,
		})
		previous = actorPTID
	}

	return localities, nil
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
	return application.ErrPrivateContentInactiveEndpoint
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
	sourceStationPeerID string,
	recipientLocalities []socialdomain.RecipientLocality,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	provider, err := resolvePrivateContentKeyExchange()
	if err != nil {
		return nil, err
	}
	return claimContentPreKeyPartitions(
		ctx,
		provider,
		sourceStationPeerID,
		recipientLocalities,
		request,
	)
}

func claimContentPreKeyPartitions(
	ctx context.Context,
	provider privateContentKeyExchangeCapabilities,
	sourceStationPeerID string,
	recipientLocalities []socialdomain.RecipientLocality,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	localityByActor := make(
		map[string]socialdomain.RecipientLocality,
		len(recipientLocalities),
	)
	for _, locality := range recipientLocalities {
		localityByActor[locality.ActorPTID] = locality
	}
	type claimPartition struct {
		stationPeerID string
		federationID  string
		targets       []*securecontentpb.ContentPreKeyClaimTarget
	}
	partitionsByStation := map[string]*claimPartition{}
	for _, target := range request.GetTargets() {
		actorPTID := target.GetRecoveryActor().GetPtid()
		if target.GetEndpoint() != nil {
			actorPTID = target.GetEndpoint().GetActor().GetPtid()
		}
		locality, found := localityByActor[actorPTID]
		stationPeerID := sourceStationPeerID
		federationID := ""
		if found {
			stationPeerID = locality.HomeStationPeerID
			if stationPeerID != sourceStationPeerID {
				federationID = locality.FederationID
			}
		}
		partition := partitionsByStation[stationPeerID]
		if partition == nil {
			partition = &claimPartition{
				stationPeerID: stationPeerID,
				federationID:  federationID,
			}
			partitionsByStation[stationPeerID] = partition
		} else if partition.federationID != federationID {
			return nil, errors.New(
				"recipient claim partition has conflicting Federation identities",
			)
		}
		partition.targets = append(
			partition.targets,
			proto.Clone(target).(*securecontentpb.ContentPreKeyClaimTarget),
		)
	}
	stationIDs := make([]string, 0, len(partitionsByStation))
	for stationPeerID := range partitionsByStation {
		stationIDs = append(stationIDs, stationPeerID)
	}
	sort.Strings(stationIDs)
	claimsByTarget := make(map[string]*securecontentpb.ClaimedContentPreKey)
	exactReplay := true
	for _, stationPeerID := range stationIDs {
		partition := partitionsByStation[stationPeerID]
		partitionRequest := &securecontentpb.ClaimContentPreKeysRequest{
			PlanId: request.GetPlanId(),
			PlanRequestSha256: append(
				[]byte(nil),
				request.GetPlanRequestSha256()...,
			),
			Targets: partition.targets,
		}
		var partitionResponse *securecontentpb.ClaimContentPreKeysResponse
		var partitionErr error
		if stationPeerID == sourceStationPeerID {
			partitionResponse, partitionErr = provider.ClaimContentPreKeys(
				ctx,
				partitionRequest,
			)
		} else {
			if partition.federationID == "" {
				return nil, errors.New(
					"remote recipient claim is missing a Federation identity",
				)
			}
			partitionResponse, partitionErr = provider.ClaimRemoteContentPreKeys(
				ctx,
				partition.federationID,
				stationPeerID,
				partitionRequest,
			)
		}
		if partitionErr != nil {
			return nil, partitionErr
		}
		if partitionResponse == nil ||
			len(partitionResponse.GetClaims()) != len(partition.targets) {
			return nil, errors.New(
				"Content PreKey partition returned an incomplete response",
			)
		}
		exactReplay = exactReplay && partitionResponse.GetExactReplay()
		for index, claim := range partitionResponse.GetClaims() {
			if !proto.Equal(claim.GetTarget(), partition.targets[index]) {
				return nil, errors.New(
					"Content PreKey partition reordered a claim target",
				)
			}
			targetBytes, marshalErr := proto.MarshalOptions{
				Deterministic: true,
			}.Marshal(claim.GetTarget())
			if marshalErr != nil {
				return nil, marshalErr
			}
			claimsByTarget[string(targetBytes)] = proto.Clone(
				claim,
			).(*securecontentpb.ClaimedContentPreKey)
		}
	}
	response := &securecontentpb.ClaimContentPreKeysResponse{
		ExactReplay: exactReplay,
	}
	for _, target := range request.GetTargets() {
		targetBytes, marshalErr := proto.MarshalOptions{
			Deterministic: true,
		}.Marshal(target)
		if marshalErr != nil {
			return nil, marshalErr
		}
		claim := claimsByTarget[string(targetBytes)]
		if claim == nil {
			return nil, errors.New(
				"Content PreKey partition omitted a claim target",
			)
		}
		response.Claims = append(response.Claims, claim)
	}
	return response, nil
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

func resolvePrivateContentFederationMembership() (
	privateContentFederationMembership,
	error,
) {
	instance := server.GetOptions().SubserverInstances["federation"]
	provider, ok := instance.(privateContentFederationMembership)
	if !ok || provider == nil {
		return nil, errors.New(
			"canonical Federation membership capability is unavailable",
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
	actors             privateContentActorCapabilities
	localStationPeerID string
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
		strings.TrimSpace(v.localStationPeerID) == "" ||
		sender == nil ||
		sender.GetActor() == nil ||
		len(canonical) == 0 ||
		len(signature) != ed25519.SignatureSize {
		return errors.New("Social private author signature is incomplete")
	}
	actorPTID := sender.GetActor().GetPtid()
	homeStationPeerID, err := v.actors.ResolveActorHomeStationPeerID(
		ctx,
		actorPTID,
	)
	if err != nil {
		return err
	}
	if homeStationPeerID != v.localStationPeerID {
		return errors.New("Social private author is not homed on this Station")
	}
	key, err := v.actors.ResolveVerifiedActorDeviceSigningKey(
		ctx,
		transaction,
		actorPTID,
		homeStationPeerID,
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
	if instance == nil {
		return nil, nil
	}
	provider, ok := instance.(privateContentActorCapabilities)
	if !ok {
		return nil, nil
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
