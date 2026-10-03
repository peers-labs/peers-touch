package social

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	actoridentity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity"
	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type recordingContentPreKeyPartitionProvider struct {
	localRequests  []*securecontentpb.ClaimContentPreKeysRequest
	remoteRequests []*securecontentpb.ClaimContentPreKeysRequest
	federationID   string
	targetStation  string
}

func (p *recordingContentPreKeyPartitionProvider) ClaimContentPreKeys(
	_ context.Context,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	p.localRequests = append(
		p.localRequests,
		proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
	)
	return partitionClaimResponse("local", request), nil
}

func (p *recordingContentPreKeyPartitionProvider) ClaimRemoteContentPreKeys(
	_ context.Context,
	federationID string,
	targetStationPeerID string,
	request *securecontentpb.ClaimContentPreKeysRequest,
) (*securecontentpb.ClaimContentPreKeysResponse, error) {
	p.federationID = federationID
	p.targetStation = targetStationPeerID
	p.remoteRequests = append(
		p.remoteRequests,
		proto.Clone(request).(*securecontentpb.ClaimContentPreKeysRequest),
	)
	return partitionClaimResponse("remote", request), nil
}

func (*recordingContentPreKeyPartitionProvider) ValidateContentPreKeyClaims(
	context.Context,
	federationdelivery.Transaction,
	*securecontentpb.ClaimContentPreKeysRequest,
	*securecontentpb.ClaimContentPreKeysResponse,
) error {
	return nil
}

func TestRemoteRecipientAdmissionPartitionsPreKeysByHomeStation(t *testing.T) {
	provider := &recordingContentPreKeyPartitionProvider{}
	request := &securecontentpb.ClaimContentPreKeysRequest{
		PlanId:            "plan-one",
		PlanRequestSha256: make([]byte, 32),
		Targets: []*securecontentpb.ContentPreKeyClaimTarget{
			contentPreKeyEndpointTarget("ptid:alice", "alice-device"),
			contentPreKeyRecoveryTarget("ptid:alice"),
			contentPreKeyEndpointTarget("ptid:bob", "bob-device"),
			contentPreKeyRecoveryTarget("ptid:bob"),
		},
	}
	request.PlanRequestSha256[0] = 1
	response, err := claimContentPreKeyPartitions(
		context.Background(),
		provider,
		"station-local",
		[]socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-remote",
			FederationID:      "federation-one",
		}},
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(provider.localRequests) != 1 ||
		len(provider.localRequests[0].GetTargets()) != 2 ||
		len(provider.remoteRequests) != 1 ||
		len(provider.remoteRequests[0].GetTargets()) != 2 {
		t.Fatalf(
			"claim partitions local=%d/%d remote=%d/%d",
			len(provider.localRequests),
			len(provider.localRequests[0].GetTargets()),
			len(provider.remoteRequests),
			len(provider.remoteRequests[0].GetTargets()),
		)
	}
	if provider.federationID != "federation-one" ||
		provider.targetStation != "station-remote" {
		t.Fatalf(
			"remote route = federation %q Station %q",
			provider.federationID,
			provider.targetStation,
		)
	}
	if len(response.GetClaims()) != len(request.GetTargets()) {
		t.Fatalf("combined claims = %d", len(response.GetClaims()))
	}
	for index, claim := range response.GetClaims() {
		if !proto.Equal(claim.GetTarget(), request.GetTargets()[index]) {
			t.Fatalf("combined claim %d was reordered", index)
		}
	}
}

func partitionClaimResponse(
	prefix string,
	request *securecontentpb.ClaimContentPreKeysRequest,
) *securecontentpb.ClaimContentPreKeysResponse {
	response := &securecontentpb.ClaimContentPreKeysResponse{}
	for index, target := range request.GetTargets() {
		prekey := &securecontentpb.ContentOneTimePreKey{
			Kind:                   target.GetKind(),
			KeyId:                  prefix + "-key-" + string(rune('a'+index)),
			X25519PublicKey:        make([]byte, 32),
			ProfileOrRecoveryEpoch: 1,
			IssuerSignature:        make([]byte, ed25519.SignatureSize),
		}
		if target.GetEndpoint() != nil {
			prekey.Principal = &securecontentpb.ContentOneTimePreKey_Endpoint{
				Endpoint: proto.Clone(
					target.GetEndpoint(),
				).(*actormodel.ActorDeviceRef),
			}
		} else {
			prekey.Principal =
				&securecontentpb.ContentOneTimePreKey_RecoveryActor{
					RecoveryActor: proto.Clone(
						target.GetRecoveryActor(),
					).(*actormodel.ActorRef),
				}
		}
		response.Claims = append(
			response.Claims,
			&securecontentpb.ClaimedContentPreKey{
				ClaimId:              prefix + "-claim-" + string(rune('a'+index)),
				Target:               target,
				Prekey:               prekey,
				IrreversiblyConsumed: true,
			},
		)
	}
	return response
}

func contentPreKeyEndpointTarget(
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

func contentPreKeyRecoveryTarget(
	actorPTID string,
) *securecontentpb.ContentPreKeyClaimTarget {
	return &securecontentpb.ContentPreKeyClaimTarget{
		Kind: securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY,
		Principal: &securecontentpb.ContentPreKeyClaimTarget_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{Ptid: actorPTID},
		},
	}
}

func TestPrivateContentActorCapabilitiesMatchCanonicalActorIdentity(
	t *testing.T,
) {
	provider := actoridentity.NewActorIdentitySubServer()
	if _, ok := provider.(privateContentActorCapabilities); !ok {
		t.Fatalf(
			"canonical Actor Identity %T does not implement Social private content capabilities",
			provider,
		)
	}
}

func TestPrivateContentAuthorSignatureVerifierUsesAuthorHomeStation(
	t *testing.T,
) {
	publicKey, privateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	actors := &recordingPrivateContentActorCapabilities{
		homeStationPeerID: "station-author-home",
		key: &actormodel.VerifiedActorDeviceSigningKey{
			Ed25519PublicKey: publicKey,
		},
	}
	canonical := []byte("private-content-author-signature")
	sender := &actormodel.ActorDeviceRef{
		Actor:    &actormodel.ActorRef{Ptid: "alice"},
		DeviceId: "alice-device",
	}

	err = (privateContentAuthorSignatureVerifier{
		actors:             actors,
		localStationPeerID: actors.homeStationPeerID,
	}).Verify(
		context.Background(),
		testFederationTransaction{},
		sender,
		"alice-signing-key",
		canonical,
		ed25519.Sign(privateKey, canonical),
	)
	if err != nil {
		t.Fatal(err)
	}
	if actors.resolvedActorPTID != sender.GetActor().GetPtid() ||
		actors.resolvedHomeStationPeerID != actors.homeStationPeerID ||
		actors.resolvedDeviceID != sender.GetDeviceId() ||
		actors.resolvedSigningKeyID != "alice-signing-key" {
		t.Fatalf(
			"resolved identity = actor %q, home %q, device %q, key %q",
			actors.resolvedActorPTID,
			actors.resolvedHomeStationPeerID,
			actors.resolvedDeviceID,
			actors.resolvedSigningKeyID,
		)
	}
}

type recordingPrivateContentActorCapabilities struct {
	privateContentActorCapabilities

	homeStationPeerID         string
	homeStationError          error
	key                       *actormodel.VerifiedActorDeviceSigningKey
	resolvedActorPTID         string
	resolvedHomeStationPeerID string
	resolvedDeviceID          string
	resolvedSigningKeyID      string
}

type recordingPrivateContentFriendFederation struct {
	federationID  string
	err           error
	authorPTID    string
	recipientPTID string
	sourceStation string
	targetStation string
}

func (r *recordingPrivateContentFriendFederation) ResolveAcceptedFriendFederation(
	_ context.Context,
	authorPTID string,
	recipientPTID string,
	sourceStationPeerID string,
	targetStationPeerID string,
) (string, error) {
	r.authorPTID = authorPTID
	r.recipientPTID = recipientPTID
	r.sourceStation = sourceStationPeerID
	r.targetStation = targetStationPeerID
	return r.federationID, r.err
}

type recordingPrivateContentFederationMembership struct {
	err           error
	federationID  string
	sourceStation string
	targetStation string
}

func (r *recordingPrivateContentFederationMembership) ValidateActiveStationPair(
	_ context.Context,
	federationID string,
	sourceStationPeerID string,
	targetStationPeerID string,
) error {
	r.federationID = federationID
	r.sourceStation = sourceStationPeerID
	r.targetStation = targetStationPeerID
	return r.err
}

func TestRemoteRecipientAdmissionResolvesAcceptedActiveFederation(t *testing.T) {
	friendship := &recordingPrivateContentFriendFederation{
		federationID: "federation-one",
	}
	membership := &recordingPrivateContentFederationMembership{}
	directory := &privateContentRecipientDirectory{
		actors: &recordingPrivateContentActorCapabilities{
			homeStationPeerID: "station-remote",
		},
		friendships: friendship,
		membership:  membership,
	}

	localities, err := directory.ResolveRecipientLocalities(
		context.Background(),
		"ptid:author",
		"station-local",
		[]string{"ptid:remote"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(localities) != 1 ||
		localities[0].ActorPTID != "ptid:remote" ||
		localities[0].HomeStationPeerID != "station-remote" ||
		localities[0].FederationID != "federation-one" {
		t.Fatalf("remote locality = %+v", localities)
	}
	if friendship.authorPTID != "ptid:author" ||
		friendship.recipientPTID != "ptid:remote" ||
		friendship.sourceStation != "station-local" ||
		friendship.targetStation != "station-remote" {
		t.Fatalf("friendship lookup = %+v", friendship)
	}
	if membership.federationID != "federation-one" ||
		membership.sourceStation != "station-local" ||
		membership.targetStation != "station-remote" {
		t.Fatalf("membership check = %+v", membership)
	}
}

func (a *recordingPrivateContentActorCapabilities) ResolveActorHomeStationPeerID(
	_ context.Context,
	actorPTID string,
) (string, error) {
	a.resolvedActorPTID = actorPTID

	return a.homeStationPeerID, a.homeStationError
}

func (a *recordingPrivateContentActorCapabilities) ResolveVerifiedActorDeviceSigningKey(
	_ context.Context,
	_ federationdelivery.Transaction,
	actorPTID string,
	expectedHomeStationPeerID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	a.resolvedActorPTID = actorPTID
	a.resolvedHomeStationPeerID = expectedHomeStationPeerID
	a.resolvedDeviceID = deviceID
	a.resolvedSigningKeyID = signingKeyID

	return a.key, nil
}

func TestPrivateContentRecipientDirectoryRejectsUnresolvedHomeStationAsUnsupported(
	t *testing.T,
) {
	identityUnavailable := actoridentitydomain.NewError(
		actoridentitydomain.ErrorCodeIdentityUnavailable,
		"actor_identity.resolve_actor_home_station",
		"home_station_peer_id",
		"is not available from Actor Identity",
	)
	directory := &privateContentRecipientDirectory{
		actors: &recordingPrivateContentActorCapabilities{
			homeStationError: identityUnavailable,
		},
	}

	localities, err := directory.ResolveRecipientLocalities(
		context.Background(),
		"ptid:author",
		"station-local",
		[]string{"ptid:remote"},
	)
	if localities != nil {
		t.Fatalf("localities = %+v, want nil", localities)
	}
	if !socialdomain.IsPrivateContentCode(
		err,
		socialdomain.PrivateContentUnsupported,
	) {
		t.Fatalf("unresolved Home Station error = %v, want unsupported", err)
	}
	if !actoridentitydomain.IsCode(
		err,
		actoridentitydomain.ErrorCodeIdentityUnavailable,
	) {
		t.Fatalf("unresolved Home Station cause was not preserved: %v", err)
	}
}

func TestPrivateContentRecipientDirectoryPreservesActorIdentityFailures(
	t *testing.T,
) {
	persistenceFailure := actoridentitydomain.NewError(
		actoridentitydomain.ErrorCodePersistence,
		"actor_identity.resolve_actor_home_station",
		"repository",
		"is unavailable",
	)
	directory := &privateContentRecipientDirectory{
		actors: &recordingPrivateContentActorCapabilities{
			homeStationError: persistenceFailure,
		},
	}

	_, err := directory.ResolveRecipientLocalities(
		context.Background(),
		"ptid:author",
		"station-local",
		[]string{"ptid:recipient"},
	)
	if !actoridentitydomain.IsCode(
		err,
		actoridentitydomain.ErrorCodePersistence,
	) {
		t.Fatalf("Actor Identity persistence error = %v", err)
	}
	if code := socialdomain.PrivateContentCodeOf(err); code != "" {
		t.Fatalf("persistence error was remapped to %q", code)
	}
}

func TestPrivateContentStationSignerVerifiesRetainedProofKeyAfterRotation(
	t *testing.T,
) {
	ctx := context.Background()
	const stationPeerID = "station-social-test"

	keys := authfed.NewInMemoryKeyStore()
	oldKey, err := authfed.MintLocalKey(time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := keys.PutCurrent(ctx, oldKey); err != nil {
		t.Fatal(err)
	}
	authority, err := authfed.NewContentProofKeyAuthority(
		stationPeerID,
		keys,
	)
	if err != nil {
		t.Fatal(err)
	}
	adapter := privateContentStationSigner{
		stationPeerID:     stationPeerID,
		proofKeyAuthority: authority,
	}
	canonical := []byte("durable-content-proof")
	oldSigningKeyID, err := adapter.SigningKeyID(ctx)
	if err != nil || oldSigningKeyID != oldKey.Kid {
		t.Fatalf("initial signing key = %q, %v", oldSigningKeyID, err)
	}
	signature, err := adapter.Sign(ctx, oldSigningKeyID, canonical)
	if err != nil {
		t.Fatal(err)
	}

	newKey, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := keys.Rotate(ctx, stationPeerID, newKey); err != nil {
		t.Fatal(err)
	}
	previous, err := keys.Load(ctx, authfed.SlotPrev)
	if err != nil {
		t.Fatal(err)
	}
	cleared, err := keys.ClearPrev(
		ctx,
		previous.Kid,
		previous.UpdatedAt,
	)
	if err != nil || !cleared {
		t.Fatalf("clear previous key = %v, %v", cleared, err)
	}
	if _, err := adapter.Sign(ctx, oldKey.Kid, canonical); err == nil {
		t.Fatal("retired Station key remained usable for new signatures")
	}
	currentSigningKeyID, err := adapter.SigningKeyID(ctx)
	if err != nil || currentSigningKeyID != newKey.Kid {
		t.Fatalf("rotated signing key = %q, %v", currentSigningKeyID, err)
	}
	currentSignature, err := adapter.Sign(
		ctx,
		currentSigningKeyID,
		canonical,
	)
	if err != nil ||
		!ed25519.Verify(newKey.Pub, canonical, currentSignature) {
		t.Fatalf("current Station signing failed after rotation: %v", err)
	}
	if err := adapter.Verify(
		ctx,
		oldKey.Kid,
		canonical,
		signature,
	); err != nil {
		t.Fatalf("verify retained proof key after rotation: %v", err)
	}

	issuedAt := time.Now().UTC().Truncate(time.Microsecond)
	attestation, err := adapter.AttestContentProofVerificationKey(
		ctx,
		oldKey.Kid,
		issuedAt,
	)
	if err != nil {
		t.Fatalf("attest retained proof key after rotation: %v", err)
	}
	if attestation.GetProofSigningKeyId() != oldKey.Kid ||
		attestation.GetAttestingSigningKeyId() != newKey.Kid ||
		!attestation.GetIssuedAt().AsTime().Equal(issuedAt) {
		t.Fatalf("retained proof-key attestation = %+v", attestation)
	}
}

func TestPrivateContentStationSignerUsesCallerTransactionOnSingleConnectionSQLite(
	t *testing.T,
) {
	ctx := context.Background()
	database, err := gorm.Open(
		sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase.SetMaxOpenConns(1)
	if err := authfed.MigrateSchema(ctx, database); err != nil {
		t.Fatal(err)
	}
	keys := authfed.NewKeyStoreGORMWithDB(database)
	key, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := keys.PutCurrent(ctx, key); err != nil {
		t.Fatal(err)
	}
	authority, err := authfed.NewContentProofKeyAuthority(
		"station-sqlite-test",
		keys,
	)
	if err != nil {
		t.Fatal(err)
	}
	adapter := privateContentStationSigner{
		stationPeerID:     "station-sqlite-test",
		proofKeyAuthority: authority,
	}

	done := make(chan error, 1)
	go func() {
		done <- database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			transaction := testFederationTransaction{database: tx}
			keyID, err := adapter.SigningKeyIDInTransaction(
				ctx,
				transaction,
			)
			if err != nil {
				return err
			}
			canonical := []byte("transactional-proof")
			signature, err := adapter.SignInTransaction(
				ctx,
				transaction,
				keyID,
				canonical,
			)
			if err != nil {
				return err
			}
			return adapter.VerifyInTransaction(
				ctx,
				transaction,
				keyID,
				canonical,
				signature,
			)
		})
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("transactional proof-key access deadlocked")
	}
}

type recordingPrivateContentAuthorKeyResolver struct {
	privateContentActorCapabilities
	expectedHomeStationPeerID string
	publicKey                 ed25519.PublicKey
}

func (r *recordingPrivateContentAuthorKeyResolver) ResolveVerifiedActorDeviceSigningKey(
	_ context.Context,
	_ federationdelivery.Transaction,
	_ string,
	expectedHomeStationPeerID string,
	_ string,
	_ string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	r.expectedHomeStationPeerID = expectedHomeStationPeerID
	return &actormodel.VerifiedActorDeviceSigningKey{
		Ed25519PublicKey: append([]byte(nil), r.publicKey...),
	}, nil
}

func (r *recordingPrivateContentAuthorKeyResolver) ResolveActorHomeStationPeerID(
	_ context.Context,
	_ string,
) (string, error) {
	return "station-local", nil
}

func TestPrivateContentAuthorSignatureVerifierBindsLocalHomeStation(
	t *testing.T,
) {
	privateKey := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	canonical := []byte("private-content-author-signature")
	resolver := &recordingPrivateContentAuthorKeyResolver{
		publicKey: privateKey.Public().(ed25519.PublicKey),
	}
	verifier := privateContentAuthorSignatureVerifier{
		actors:             resolver,
		localStationPeerID: "station-local",
	}

	err := verifier.Verify(
		context.Background(),
		nil,
		&actormodel.ActorDeviceRef{
			Actor:    &actormodel.ActorRef{Ptid: "actor-alice"},
			DeviceId: "device-one",
		},
		"signing-key-one",
		canonical,
		ed25519.Sign(privateKey, canonical),
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolver.expectedHomeStationPeerID != "station-local" {
		t.Fatalf(
			"expected Home Station = %q, want station-local",
			resolver.expectedHomeStationPeerID,
		)
	}
}

type testFederationTransaction struct {
	database *gorm.DB
}

func (t testFederationTransaction) DB() *gorm.DB {
	return t.database
}

func (testFederationTransaction) Outbox() federationdelivery.OutboxWriter {
	return nil
}
