package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	keyexchangedomain "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	privateContentPostKindText  = "TEXT"
	privateContentPostKindImage = "IMAGE"
	privateContentActiveState   = "ACTIVE"

	privateCommentRateWindow = time.Hour
	privateCommentActorLimit = int64(30)
	privateCommentPostLimit  = int64(600)
)

// ErrPrivateContentInactiveEndpoint is returned only after Actor Identity
// successfully verifies a manifest that does not contain the requested
// endpoint. Lookup and verification failures must return their original error.
var ErrPrivateContentInactiveEndpoint = errors.New(
	"private-content endpoint is inactive",
)

// PrivateContentStore is the current Social W6 durable prepare/submit
// substrate. The alias keeps production composition on the existing store
// contract rather than introducing a second persistence authority.
type PrivateContentStore = infrastructure.PrivateContentStore

// PrivateAudienceAuthority resolves Social's accepted relationship projections.
// A nil transaction is used during prepare. Submit passes the exact Social
// transaction so the current projection remains fenced through commit.
type PrivateAudienceAuthority interface {
	ResolveFriendsPostSnapshot(
		context.Context,
		federationdelivery.Transaction,
		string,
	) (socialdomain.FriendsSnapshot, error)
	ResolveFollowersPostSnapshot(
		context.Context,
		federationdelivery.Transaction,
		string,
	) (socialdomain.FriendsSnapshot, error)
	ResolveCirclePostSnapshot(
		context.Context,
		federationdelivery.Transaction,
		string,
		uint64,
	) (socialdomain.FriendsSnapshot, error)
	ResolveGroupPostSnapshot(
		context.Context,
		federationdelivery.Transaction,
		string,
		uint64,
	) (socialdomain.FriendsSnapshot, error)
	ResolveCustomAllowPostSnapshot(
		context.Context,
		federationdelivery.Transaction,
		string,
		[]string,
	) (socialdomain.FriendsSnapshot, error)
	ResolveCustomDenyPostSnapshot(
		context.Context,
		federationdelivery.Transaction,
		string,
		[]string,
		actormodel.Audience_Kind,
	) (socialdomain.FriendsSnapshot, error)
	ResolvePrivateCommentSnapshot(
		context.Context,
		federationdelivery.Transaction,
		string,
		string,
		string,
	) (socialdomain.FriendsSnapshot, error)
}

// PrivateRecipientDirectory expands each actor in a frozen snapshot to every
// required active endpoint and exactly one actor-recovery principal.
type PrivateRecipientDirectory interface {
	ResolveContentPreKeyTargets(
		context.Context,
		*actormodel.ActorDeviceRef,
		[]string,
	) ([]*securecontentpb.ContentPreKeyClaimTarget, error)
	ValidateActiveEndpoint(
		context.Context,
		*actormodel.ActorDeviceRef,
	) error
}

// PrivateContentKeyExchange is implemented by Key Exchange's internal
// ContentPreKeyCapabilities. It intentionally exposes no public route.
type PrivateContentKeyExchange interface {
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

type PrivateContentStationSigner interface {
	SigningKeyID(context.Context) (string, error)
	SigningKeyIDInTransaction(
		context.Context,
		federationdelivery.Transaction,
	) (string, error)
	Sign(context.Context, string, []byte) ([]byte, error)
	SignInTransaction(
		context.Context,
		federationdelivery.Transaction,
		string,
		[]byte,
	) ([]byte, error)
	Verify(context.Context, string, []byte, []byte) error
	VerifyInTransaction(
		context.Context,
		federationdelivery.Transaction,
		string,
		[]byte,
		[]byte,
	) error
	AttestContentProofVerificationKey(
		context.Context,
		string,
		time.Time,
	) (*securecontentpb.StationContentSigningKeyAttestation, error)
}

// PrivateContentAuthorSignatureVerifier verifies author-device envelope
// signatures against the current key authority while the Social UOW is open.
type PrivateContentAuthorSignatureVerifier interface {
	Verify(
		context.Context,
		federationdelivery.Transaction,
		*actormodel.ActorDeviceRef,
		string,
		[]byte,
		[]byte,
	) error
}

type PrivateContentClock interface {
	Now() time.Time
}

type PrivateContentService struct {
	store             PrivateContentStore
	audiences         PrivateAudienceAuthority
	recipients        PrivateRecipientDirectory
	keyExchange       PrivateContentKeyExchange
	stationSigner     PrivateContentStationSigner
	signatureVerifier PrivateContentAuthorSignatureVerifier
	clock             PrivateContentClock
	policy            securecontentkernel.Policy
}

func NewPrivateContentService(
	store PrivateContentStore,
	audiences PrivateAudienceAuthority,
	recipients PrivateRecipientDirectory,
	keyExchange PrivateContentKeyExchange,
	stationSigner PrivateContentStationSigner,
	signatureVerifier PrivateContentAuthorSignatureVerifier,
	clock PrivateContentClock,
) (*PrivateContentService, error) {
	const operation = "social.private_content.new_service"
	if store == nil ||
		audiences == nil ||
		recipients == nil ||
		keyExchange == nil ||
		stationSigner == nil ||
		signatureVerifier == nil ||
		clock == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"dependencies",
			"all private-content ports are required",
		)
	}
	policy := securecontentkernel.DefaultPolicy()
	if err := policy.Validate(); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentInternal,
			operation,
			err,
		)
	}
	return &PrivateContentService{
		store:             store,
		audiences:         audiences,
		recipients:        recipients,
		keyExchange:       keyExchange,
		stationSigner:     stationSigner,
		signatureVerifier: signatureVerifier,
		clock:             clock,
		policy:            policy,
	}, nil
}

func (s *PrivateContentService) now() time.Time {
	return s.clock.Now().UTC().Truncate(time.Microsecond)
}

func (s *PrivateContentService) PreparePrivateMoment(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	request *privatecontentpb.PreparePrivateMomentRequest,
) (*privatecontentpb.PreparePrivateMomentResponse, error) {
	const operation = "social.private_content.prepare_moment"
	if err := author.Validate(operation); err != nil {
		return nil, err
	}
	material, err := socialdomain.CanonicalizePrivateMomentPrepare(request)
	if err != nil {
		return nil, err
	}
	if response, found, err := s.resumePrepare(
		ctx,
		author,
		material,
	); found || err != nil {
		return response, err
	}
	snapshot, err := s.resolvePostSnapshot(
		ctx,
		nil,
		author.Endpoint.GetActor().GetPtid(),
		request.GetAudience(),
	)
	if err != nil {
		return nil, mapPrivateDependencyError(operation, err)
	}
	return s.prepare(ctx, author, material, snapshot)
}

func (s *PrivateContentService) PreparePrivateComment(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	request *privatecontentpb.PreparePrivateCommentRequest,
) (*privatecontentpb.PreparePrivateCommentResponse, error) {
	const operation = "social.private_content.prepare_comment"
	if err := author.Validate(operation); err != nil {
		return nil, err
	}
	material, err := socialdomain.CanonicalizePrivateCommentPrepare(request)
	if err != nil {
		return nil, err
	}
	if response, found, err := s.resumePrepare(
		ctx,
		author,
		material,
	); found || err != nil {
		if err != nil {
			return nil, err
		}
		return &privatecontentpb.PreparePrivateCommentResponse{
			Plan: response.GetPlan(),
		}, nil
	}
	snapshot, err := s.audiences.ResolvePrivateCommentSnapshot(
		ctx,
		nil,
		material.ParentPostID,
		material.ReplyToCommentID,
		author.Endpoint.GetActor().GetPtid(),
	)
	if err != nil {
		return nil, mapPrivateDependencyError(operation, err)
	}
	material.Audience = proto.Clone(
		snapshot.Audience,
	).(*actormodel.Audience)
	material.AudienceKind = material.Audience.GetKind()
	response, err := s.prepare(ctx, author, material, snapshot)
	if err != nil {
		return nil, err
	}
	return &privatecontentpb.PreparePrivateCommentResponse{
		Plan: response.GetPlan(),
	}, nil
}

func (s *PrivateContentService) prepare(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	material socialdomain.PrivatePrepareMaterial,
	snapshot socialdomain.FriendsSnapshot,
) (*privatecontentpb.PreparePrivateMomentResponse, error) {
	const operation = "social.private_content.prepare"
	authorPTID := author.Endpoint.GetActor().GetPtid()
	normalizedSnapshot, snapshotHash, err := socialdomain.NormalizeFriendsSnapshot(
		operation,
		authorPTID,
		snapshot,
	)
	if err != nil {
		return nil, err
	}
	if material.Audience == nil {
		material.Audience = proto.Clone(
			normalizedSnapshot.Audience,
		).(*actormodel.Audience)
		material.AudienceKind = material.Audience.GetKind()
	} else if !proto.Equal(material.Audience, normalizedSnapshot.Audience) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			"audience",
			"resolved audience differs from the prepare request",
		)
	}
	audienceBytes, err := socialdomain.CanonicalProtoBytes(material.Audience)
	if err != nil {
		return nil, err
	}
	audienceHash := sha256.Sum256(audienceBytes)
	emptySubtypeHash := sha256.Sum256(nil)

	targets, err := s.recipients.ResolveContentPreKeyTargets(
		ctx,
		proto.Clone(author.Endpoint).(*actormodel.ActorDeviceRef),
		append([]string(nil), normalizedSnapshot.RecipientPTIDs...),
	)
	if err != nil {
		return nil, mapPrivateDependencyError(operation, err)
	}
	targets, err = normalizeClaimTargets(
		operation,
		author.Endpoint,
		normalizedSnapshot.RecipientPTIDs,
		targets,
	)
	if err != nil {
		return nil, err
	}

	planID := deterministicPrivateID(
		"plan",
		authorPTID,
		material.CommandID,
	)
	snapshotID := deterministicPrivateID("snapshot", planID)
	claimRequest := &securecontentpb.ClaimContentPreKeysRequest{
		PlanId:            planID,
		PlanRequestSha256: material.CanonicalSHA256[:],
		Targets:           targets,
	}
	claimRequestBytes, err := socialdomain.CanonicalProtoBytes(claimRequest)
	if err != nil {
		return nil, err
	}
	claimRequestHash := sha256.Sum256(claimRequestBytes)
	now := s.now()
	candidate := dbmodel.SocialPrivateContentPlan{
		PlanID:                  planID,
		AuthorPTID:              authorPTID,
		PrepareCommandID:        material.CommandID,
		ContentID:               material.ContentID,
		Generation:              1,
		ResourceKind:            string(material.ResourceKind),
		AudienceKind:            material.AudienceKind.String(),
		AuthorDeviceID:          author.Endpoint.GetDeviceId(),
		AuthorHomeStationPeerID: author.HomeStationPeerID,
		AudienceSnapshotID:      snapshotID,
		AuthorizationSnapshotSHA256: cloneApplicationBytes(
			snapshotHash[:],
		),
		CanonicalPrepareBytes:  cloneApplicationBytes(material.CanonicalBytes),
		CanonicalPrepareSHA256: cloneApplicationBytes(material.CanonicalSHA256[:]),
		ClaimRequestBytes:      claimRequestBytes,
		ClaimRequestSHA256:     claimRequestHash[:],
		State:                  dbmodel.SocialPrivatePlanStatePreparing,
		ExpiresAt:              now.Add(socialdomain.PrivateContentPlanLifetime),
	}
	preparing, err := s.store.ClaimPreparing(
		ctx,
		candidate,
		infrastructure.PrivatePrepareBinding{
			AudienceBytes:                 audienceBytes,
			AudienceSHA256:                audienceHash[:],
			SubtypePrepareAuthoritySHA256: emptySubtypeHash[:],
		},
	)
	if err != nil {
		return nil, mapPrivateStoreError(operation, err)
	}
	return s.completePrepare(ctx, author, material, preparing.Plan)
}

func (s *PrivateContentService) resumePrepare(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	material socialdomain.PrivatePrepareMaterial,
) (*privatecontentpb.PreparePrivateMomentResponse, bool, error) {
	existing, found, err := s.store.FindPrepare(
		ctx,
		author.Endpoint.GetActor().GetPtid(),
		material.CommandID,
		material.CanonicalSHA256[:],
	)
	if err != nil {
		return nil, false, mapPrivateStoreError(
			"social.private_content.resume_prepare",
			err,
		)
	}
	if !found {
		return nil, false, nil
	}
	if existing.Plan.ContentID != material.ContentID ||
		existing.Plan.ResourceKind != string(material.ResourceKind) ||
		existing.Plan.AuthorDeviceID != author.Endpoint.GetDeviceId() ||
		existing.Plan.AuthorHomeStationPeerID != author.HomeStationPeerID {
		return nil, true, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			"social.private_content.resume_prepare",
			"prepare_identity",
			"does not match the durable prepare plan",
		)
	}
	response, err := s.completePrepare(ctx, author, material, existing.Plan)
	return response, true, err
}

func (s *PrivateContentService) completePrepare(
	ctx context.Context,
	author socialdomain.PrivateContentAuthor,
	material socialdomain.PrivatePrepareMaterial,
	persisted dbmodel.SocialPrivateContentPlan,
) (*privatecontentpb.PreparePrivateMomentResponse, error) {
	const operation = "social.private_content.complete_prepare"
	if persisted.State == dbmodel.SocialPrivatePlanStateConsumed {
		plan, err := s.decodePreparedPlan(ctx, persisted)
		if err != nil {
			return nil, err
		}
		return &privatecontentpb.PreparePrivateMomentResponse{Plan: plan}, nil
	}
	if !persisted.ExpiresAt.After(s.now()) {
		if err := s.store.ExpirePlan(
			ctx,
			persisted.PlanID,
			s.now(),
		); err != nil {
			return nil, mapPrivateStoreError(operation, err)
		}
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentExpiredPlan,
			operation,
			"plan",
			"has expired",
		)
	}
	switch persisted.State {
	case dbmodel.SocialPrivatePlanStatePrepared:
		plan, err := s.decodePreparedPlan(ctx, persisted)
		if err != nil {
			return nil, err
		}
		return &privatecontentpb.PreparePrivateMomentResponse{Plan: plan}, nil
	case dbmodel.SocialPrivatePlanStatePreparing,
		dbmodel.SocialPrivatePlanStatePreKeysClaimed:
	case dbmodel.SocialPrivatePlanStateExpired:
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentExpiredPlan,
			operation,
			"plan",
			"is expired",
		)
	default:
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			"plan",
			"is terminal and cannot be prepared again",
		)
	}
	persistedClaimRequest := &securecontentpb.ClaimContentPreKeysRequest{}
	if err := proto.Unmarshal(
		persisted.ClaimRequestBytes,
		persistedClaimRequest,
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	claimResponse, err := s.keyExchange.ClaimContentPreKeys(
		ctx,
		persistedClaimRequest,
	)
	if err != nil {
		return nil, mapPrivateDependencyError(operation, err)
	}
	normalizedClaimResponse, slots, requiredSlots, err := buildClaimedSlots(
		operation,
		persisted.PlanID,
		persistedClaimRequest,
		claimResponse,
		s.now(),
	)
	if err != nil {
		return nil, err
	}

	plan, err := s.signPreparedPlan(
		ctx,
		author.Endpoint,
		material,
		persisted,
		requiredSlots,
	)
	if err != nil {
		return nil, err
	}
	claimResponseBytes, err := socialdomain.CanonicalProtoBytes(
		normalizedClaimResponse,
	)
	if err != nil {
		return nil, err
	}
	claimResponseHash := sha256.Sum256(claimResponseBytes)
	signedPlanBytes, err := socialdomain.CanonicalProtoBytes(plan)
	if err != nil {
		return nil, err
	}
	signedPlanHash := sha256.Sum256(signedPlanBytes)
	prepared, err := s.store.MarkPrepared(
		ctx,
		infrastructure.PreparedPlan{
			PlanID: persisted.PlanID,
			CanonicalPrepareSHA256: cloneApplicationBytes(
				persisted.CanonicalPrepareSHA256,
			),
			ClaimResponseBytes:  claimResponseBytes,
			ClaimResponseSHA256: claimResponseHash[:],
			CanonicalPlanSHA256: cloneApplicationBytes(
				plan.GetCanonicalPlanSha256(),
			),
			SignedPlanBytes:  signedPlanBytes,
			SignedPlanSHA256: signedPlanHash[:],
			Slots:            slots,
			PreparedAt:       s.now(),
		},
	)
	if err != nil {
		return nil, mapPrivateStoreError(operation, err)
	}
	persistedPlan, err := s.decodePreparedPlan(ctx, prepared.Plan)
	if err != nil {
		return nil, err
	}
	return &privatecontentpb.PreparePrivateMomentResponse{
		Plan: persistedPlan,
	}, nil
}

func (s *PrivateContentService) signPreparedPlan(
	ctx context.Context,
	author *actormodel.ActorDeviceRef,
	material socialdomain.PrivatePrepareMaterial,
	persisted dbmodel.SocialPrivateContentPlan,
	requiredSlots []*securecontentpb.RequiredContentRecipientSlot,
) (*securecontentpb.ContentEncryptionPlan, error) {
	const operation = "social.private_content.sign_plan"
	keyID, err := s.stationSigner.SigningKeyID(ctx)
	if err != nil {
		return nil, mapPrivateDependencyError(operation, err)
	}
	if strings.TrimSpace(keyID) == "" || keyID != strings.TrimSpace(keyID) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			"station_signing_key_id",
			"signer returned a non-canonical key ID",
		)
	}

	objectIDs := make([]string, 0, material.ObjectCount)
	for index := uint32(0); index < material.ObjectCount; index++ {
		objectIDs = append(
			objectIDs,
			deterministicPrivateID(
				"object",
				persisted.PlanID,
				strconv.FormatUint(uint64(index), 10),
			),
		)
	}
	sort.Strings(objectIDs)
	plan := &securecontentpb.ContentEncryptionPlan{
		FormatVersion: socialdomain.PrivateContentFormatVersion,
		PlanId:        persisted.PlanID,
		Resource: &securecontentpb.SecureResourceRef{
			OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:   material.ContentID,
			Generation:  persisted.Generation,
		},
		Author: proto.Clone(author).(*actormodel.ActorDeviceRef),
		AuthorizationSnapshotSha256: cloneApplicationBytes(
			persisted.AuthorizationSnapshotSHA256,
		),
		RequiredSlots:       cloneRequiredSlots(requiredSlots),
		ObjectIds:           objectIDs,
		ExpiresAt:           timestamppb.New(persisted.ExpiresAt.UTC()),
		StationSigningKeyId: keyID,
		DomainBindingSha256: cloneApplicationBytes(material.DomainBindingHash[:]),
	}
	planHash, err := socialdomain.CanonicalEncryptionPlanHash(plan)
	if err != nil {
		return nil, err
	}
	plan.CanonicalPlanSha256 = planHash[:]
	signingBytes, err := socialdomain.CanonicalEncryptionPlanSigningBytes(plan)
	if err != nil {
		return nil, err
	}
	signature, err := s.stationSigner.Sign(ctx, keyID, signingBytes)
	if err != nil {
		return nil, mapPrivateDependencyError(operation, err)
	}
	plan.StationSignature = cloneApplicationBytes(signature)
	if err := securecontentkernel.ValidateContentEncryptionPlan(
		plan,
		s.policy,
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	return plan, nil
}

func (s *PrivateContentService) SubmitPrivateMoment(
	ctx context.Context,
	author *actormodel.ActorDeviceRef,
	request *privatecontentpb.SubmitPrivateMomentRequest,
) (*privatecontentpb.SubmitPrivateMomentResponse, error) {
	kind := privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT
	if request != nil && request.GetPlan() != nil &&
		len(request.GetPlan().GetObjectIds()) > 0 {
		kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE
	}
	material, err := socialdomain.CanonicalizePrivateMomentSubmit(
		request,
		author,
		kind,
		s.now(),
		s.policy,
	)
	if err != nil {
		return nil, err
	}
	response := &privatecontentpb.SubmitPrivateMomentResponse{}
	err = s.submit(
		ctx,
		author,
		request.GetPlan(),
		material,
		func(
			ctx context.Context,
			tx infrastructure.PrivateContentTransaction,
			plan dbmodel.SocialPrivateContentPlan,
			prepared socialdomain.PrivatePrepareMaterial,
			snapshot socialdomain.FriendsSnapshot,
			commitProof *securecontentpb.ViewerContentCommitProof,
			commitProofRow dbmodel.SocialPrivateCommitProof,
			committedAt time.Time,
		) ([]byte, error) {
			if prepared.ResourceKind != socialdomain.PrivateContentResourcePost ||
				prepared.MomentKind != kind {
				return nil, socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentConflict,
					"social.private_content.submit_moment",
					"plan",
					"was not prepared for this Post subtype",
				)
			}
			return s.persistMoment(
				ctx,
				tx,
				plan,
				prepared,
				snapshot,
				request,
				material,
				commitProof,
				commitProofRow,
				committedAt,
			)
		},
		response,
	)
	if err != nil {
		return nil, err
	}
	return response, nil
}

func (s *PrivateContentService) SubmitPrivateComment(
	ctx context.Context,
	author *actormodel.ActorDeviceRef,
	request *privatecontentpb.SubmitPrivateCommentRequest,
) (*privatecontentpb.SubmitPrivateCommentResponse, error) {
	material, err := socialdomain.CanonicalizePrivateCommentSubmit(
		request,
		author,
		s.now(),
		s.policy,
	)
	if err != nil {
		return nil, err
	}
	response := &privatecontentpb.SubmitPrivateCommentResponse{}
	err = s.submit(
		ctx,
		author,
		request.GetPlan(),
		material,
		func(
			ctx context.Context,
			tx infrastructure.PrivateContentTransaction,
			plan dbmodel.SocialPrivateContentPlan,
			prepared socialdomain.PrivatePrepareMaterial,
			snapshot socialdomain.FriendsSnapshot,
			commitProof *securecontentpb.ViewerContentCommitProof,
			commitProofRow dbmodel.SocialPrivateCommitProof,
			committedAt time.Time,
		) ([]byte, error) {
			if prepared.ResourceKind != socialdomain.PrivateContentResourceComment {
				return nil, socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentConflict,
					"social.private_content.submit_comment",
					"plan",
					"was not prepared for a Comment",
				)
			}
			return s.persistComment(
				ctx,
				tx,
				plan,
				prepared,
				snapshot,
				request,
				material,
				commitProof,
				commitProofRow,
				committedAt,
			)
		},
		response,
	)
	if err != nil {
		return nil, err
	}
	return response, nil
}

func (s *PrivateContentService) GetPrivateMoment(
	ctx context.Context,
	viewer *actormodel.ActorDeviceRef,
	postID string,
) (*privatecontentpb.GetMomentResourceResponse, error) {
	const operation = "social.private_content.get_moment"
	if err := s.validatePrivateContentViewer(ctx, viewer, operation); err != nil {
		return nil, err
	}
	read, err := s.store.GetPrivatePost(
		ctx,
		postID,
		viewer.GetActor().GetPtid(),
		viewer.GetDeviceId(),
	)
	if err != nil {
		return nil, mapPrivateStoreError(operation, err)
	}
	payload := &securecontentpb.EncryptedPayload{}
	if err := proto.Unmarshal(read.Post.EncryptedPayloadBytes, payload); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	payloadBytes, err := socialdomain.CanonicalProtoBytes(payload)
	if err != nil ||
		!bytes.Equal(
			privateSHA256(payloadBytes),
			read.Post.EncryptedPayloadSHA256,
		) ||
		securecontentkernel.ValidateEncryptedPayload(payload, s.policy) != nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"payload",
			"does not match its persisted canonical commitment",
		)
	}
	var (
		envelope       *securecontentpb.PreparedContentKeyEnvelope
		viewerEnvelope *securecontentpb.ViewerContentKeyEnvelope
	)
	if read.Envelope != nil {
		envelope = &securecontentpb.PreparedContentKeyEnvelope{}
		if err := proto.Unmarshal(
			read.Envelope.PreparedEnvelopeBytes,
			envelope,
		); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		envelopeBytes, err := socialdomain.CanonicalProtoBytes(envelope)
		if err != nil ||
			!bytes.Equal(
				privateSHA256(envelopeBytes),
				read.Envelope.EnvelopeSHA256,
			) {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"envelope",
				"does not match its persisted canonical commitment",
			)
		}
		viewerEnvelope = &securecontentpb.ViewerContentKeyEnvelope{
			Binding: proto.Clone(
				envelope.GetBinding(),
			).(*securecontentpb.ContentKeyEnvelopeBinding),
			Recipient: &securecontentpb.ViewerContentKeyEnvelope_Endpoint{
				Endpoint: proto.Clone(viewer).(*actormodel.ActorDeviceRef),
			},
			BindingSha256: cloneApplicationBytes(
				envelope.GetBindingSha256(),
			),
			HpkeEncapsulatedKey: cloneApplicationBytes(
				envelope.GetHpkeEncapsulatedKey(),
			),
			HpkeCiphertext: cloneApplicationBytes(
				envelope.GetHpkeCiphertext(),
			),
			SenderSignature: cloneApplicationBytes(
				envelope.GetSenderSignature(),
			),
			PrincipalEpoch: read.Envelope.PrincipalEpoch,
		}
		if err := securecontentkernel.ValidateViewerContentKeyEnvelope(
			viewerEnvelope,
			s.policy,
		); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
	}
	proof := &securecontentpb.ViewerContentCommitProof{}
	if err := proto.Unmarshal(
		read.CommitProof.CanonicalProofBytes,
		proof,
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	proofBytes, err := socialdomain.CanonicalProtoBytes(proof)
	if err != nil ||
		!bytes.Equal(
			privateSHA256(proofBytes),
			read.CommitProof.CanonicalProofSHA256,
		) ||
		securecontentkernel.ValidateViewerContentCommitProof(proof) != nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"commit_proof",
			"does not match its persisted canonical commitment",
		)
	}
	if read.Post.PostID != postID ||
		read.Post.ContentID != postID ||
		read.CommitProof.ContentID != read.Post.ContentID ||
		read.CommitProof.Generation != read.Post.Generation ||
		read.CommitProof.DomainCommitID != postID ||
		read.CommitProof.ResourceKind !=
			string(socialdomain.PrivateContentResourcePost) ||
		proof.GetDomainCommitId() != postID ||
		proof.GetDomainCommitId() != read.CommitProof.DomainCommitID ||
		proof.GetStationSigningKeyId() !=
			read.CommitProof.StationSigningKeyID {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"commit_proof.identity",
			"does not match the requested persisted Post",
		)
	}
	proofSigningBytes, err :=
		socialdomain.CanonicalCommitProofSigningBytes(proof)
	if err != nil {
		return nil, err
	}
	if err := s.stationSigner.Verify(
		ctx,
		proof.GetStationSigningKeyId(),
		proofSigningBytes,
		proof.GetStationSignature(),
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	attestation, err := s.stationSigner.AttestContentProofVerificationKey(
		ctx,
		proof.GetStationSigningKeyId(),
		s.now(),
	)
	if err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	objects := make(
		[]*securecontentpb.EncryptedObjectDescriptor,
		0,
		len(read.Objects),
	)
	for _, persisted := range read.Objects {
		descriptor := &securecontentpb.EncryptedObjectDescriptor{}
		if err := proto.Unmarshal(
			persisted.CanonicalDescriptorBytes,
			descriptor,
		); err != nil {
			return nil, socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		descriptorBytes, err := securecontentkernel.CanonicalDescriptorBytes(
			descriptor,
			s.policy,
		)
		if err != nil ||
			!bytes.Equal(
				privateSHA256(descriptorBytes),
				persisted.DescriptorSHA256,
			) {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"object",
				"does not match its persisted canonical commitment",
			)
		}
		objects = append(objects, descriptor)
	}
	objectIDs := make([]string, 0, len(objects))
	for _, descriptor := range objects {
		objectIDs = append(objectIDs, descriptor.GetObjectId())
	}
	_, objectSetHash, err := socialdomain.CanonicalizePrivateObjects(
		operation,
		&securecontentpb.ContentEncryptionPlan{
			Resource:  proof.GetResource(),
			ObjectIds: objectIDs,
		},
		objects,
		s.policy,
	)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(
		proof.GetEncryptedPayloadSha256(),
		privateSHA256(payloadBytes),
	) ||
		proof.GetResource().GetOwnerDomain() !=
			securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		proof.GetResource().GetContentId() != read.Post.ContentID ||
		proof.GetResource().GetGeneration() != read.Post.Generation ||
		proof.GetAuthor().GetActor().GetPtid() != read.Post.AuthorPTID ||
		proof.GetAuthor().GetDeviceId() != read.AuthorDeviceID ||
		!proto.Equal(payload.GetResource(), proof.GetResource()) ||
		!bytes.Equal(
			proof.GetAuthorizationSnapshotSha256(),
			read.Snapshot.CanonicalSnapshotSHA256,
		) ||
		!bytes.Equal(
			proof.GetCanonicalPlanSha256(),
			read.CanonicalPlanSHA256,
		) ||
		!bytes.Equal(
			proof.GetObjectDescriptorSetSha256(),
			objectSetHash[:],
		) ||
		!bytes.Equal(
			read.Post.ObjectDescriptorSetSHA256,
			objectSetHash[:],
		) ||
		!endpointEnvelopeMatchesCommit(
			envelope,
			payload,
			proof,
			objectSetHash[:],
		) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"binding",
			"persisted private-content commitments diverge",
		)
	}
	postType := actormodel.PostType_TEXT
	if read.Post.Kind == privateContentPostKindImage {
		postType = actormodel.PostType_IMAGE
	}
	return &privatecontentpb.GetMomentResourceResponse{
		Resource: &privatecontentpb.PostResource{
			Metadata: &privatecontentpb.PostMetadata{
				PostId:    read.Post.PostID,
				ContentId: read.Post.ContentID,
				Author: proto.Clone(
					proof.GetAuthor().GetActor(),
				).(*actormodel.ActorRef),
				Type:         postType,
				AudienceKind: parseStoredAudienceKind(read.Snapshot.AudienceKind),
				CreatedAt:    timestamppb.New(read.Post.CreatedAt),
				UpdatedAt:    timestamppb.New(read.Post.UpdatedAt),
				Stats: &actormodel.PostStats{
					CommentsCount: read.Post.CommentsCount,
				},
			},
			Body: &privatecontentpb.PostResource_PrivateContent{
				PrivateContent: privateContentAccess(
					payload,
					objects,
					viewerEnvelope,
					proof,
					attestation,
				),
			},
		},
	}, nil
}

func endpointEnvelopeMatchesCommit(
	envelope *securecontentpb.PreparedContentKeyEnvelope,
	payload *securecontentpb.EncryptedPayload,
	proof *securecontentpb.ViewerContentCommitProof,
	objectSetHash []byte,
) bool {
	if envelope == nil {
		return true
	}
	return bytes.Equal(
		envelope.GetBinding().GetPayloadCiphertextSha256(),
		payload.GetCiphertextSha256(),
	) &&
		bytes.Equal(
			envelope.GetBinding().GetCanonicalPlanSha256(),
			proof.GetCanonicalPlanSha256(),
		) &&
		bytes.Equal(
			envelope.GetBinding().GetAuthorizationSnapshotSha256(),
			proof.GetAuthorizationSnapshotSha256(),
		) &&
		bytes.Equal(
			envelope.GetBinding().GetObjectDescriptorSetSha256(),
			objectSetHash,
		) &&
		proto.Equal(
			envelope.GetBinding().GetResource(),
			proof.GetResource(),
		) &&
		proto.Equal(
			envelope.GetBinding().GetSender(),
			proof.GetAuthor(),
		)
}

func privateSHA256(value []byte) []byte {
	digest := sha256.Sum256(value)
	return digest[:]
}

type privateSubmitMutation func(
	context.Context,
	infrastructure.PrivateContentTransaction,
	dbmodel.SocialPrivateContentPlan,
	socialdomain.PrivatePrepareMaterial,
	socialdomain.FriendsSnapshot,
	*securecontentpb.ViewerContentCommitProof,
	dbmodel.SocialPrivateCommitProof,
	time.Time,
) ([]byte, error)

func (s *PrivateContentService) submit(
	ctx context.Context,
	author *actormodel.ActorDeviceRef,
	requestPlan *securecontentpb.ContentEncryptionPlan,
	material socialdomain.PrivateSubmitMaterial,
	mutate privateSubmitMutation,
	response proto.Message,
) error {
	const operation = "social.private_content.submit"
	if mutate == nil || response == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInternal,
			operation,
			"mutation",
			"is required",
		)
	}
	if err := verifyPrivateContentPlanSignature(
		ctx,
		s.stationSigner,
		requestPlan,
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	domainCommitID := requestPlan.GetResource().GetContentId()
	result, err := s.store.ExecuteSubmit(
		ctx,
		infrastructure.SubmitCommand{
			PlanID:                requestPlan.GetPlanId(),
			AuthorPTID:            author.GetActor().GetPtid(),
			CommandID:             material.CommandID,
			CanonicalSubmitSHA256: material.CanonicalSHA256[:],
			DomainCommitID:        domainCommitID,
		},
		func(
			ctx context.Context,
			tx infrastructure.PrivateContentTransaction,
			plan dbmodel.SocialPrivateContentPlan,
		) (infrastructure.SubmitMutationResult, error) {
			committedAt := s.now()
			if !plan.ExpiresAt.After(committedAt) {
				if err := tx.Expire(ctx); err != nil {
					return infrastructure.SubmitMutationResult{},
						mapPrivateStoreError(operation, err)
				}
				return infrastructure.SubmitMutationResult{}, nil
			}
			transaction := tx.ContentPreKeyValidationTransaction()
			if transaction == nil {
				return infrastructure.SubmitMutationResult{},
					socialdomain.NewPrivateContentError(
						socialdomain.PrivateContentIntegrationGap,
						operation,
						"transaction",
						"Social PrivateContentTransaction must expose ContentPreKeyValidationTransaction",
					)
			}
			if err := validatePersistedPlan(
				plan,
				requestPlan,
				author,
			); err != nil {
				return infrastructure.SubmitMutationResult{}, err
			}
			if err := verifyPrivateContentPlanSignatureInTransaction(
				ctx,
				transaction,
				s.stationSigner,
				requestPlan,
			); err != nil {
				return infrastructure.SubmitMutationResult{},
					socialdomain.WrapPrivateContentError(
						socialdomain.PrivateContentIntegrityFailed,
						operation,
						err,
					)
			}
			binding, err := tx.LoadPrepareBinding(ctx, plan.PlanID)
			if err != nil {
				return infrastructure.SubmitMutationResult{},
					mapPrivateStoreError(operation, err)
			}
			prepared, err := decodePersistedPrepare(plan, binding)
			if err != nil {
				return infrastructure.SubmitMutationResult{}, err
			}
			if !bytes.Equal(
				prepared.DomainBindingHash[:],
				requestPlan.GetDomainBindingSha256(),
			) ||
				prepared.ObjectCount != uint32(len(requestPlan.GetObjectIds())) {
				return infrastructure.SubmitMutationResult{},
					socialdomain.NewPrivateContentError(
						socialdomain.PrivateContentConflict,
						operation,
						"plan.domain_binding",
						"does not match the durable prepare command",
					)
			}

			currentSnapshot, err := s.resolveCurrentSnapshot(
				ctx,
				transaction,
				plan.AuthorPTID,
				prepared,
			)
			if err != nil {
				if socialdomain.IsPrivateContentCode(
					err,
					socialdomain.PrivateContentStalePlan,
				) {
					if rejectErr := tx.RejectStale(ctx); rejectErr != nil {
						return infrastructure.SubmitMutationResult{},
							mapPrivateStoreError(operation, rejectErr)
					}
					return infrastructure.SubmitMutationResult{}, nil
				}
				return infrastructure.SubmitMutationResult{}, err
			}
			normalizedSnapshot, snapshotHash, err :=
				socialdomain.NormalizeFriendsSnapshot(
					operation,
					plan.AuthorPTID,
					currentSnapshot,
				)
			if err != nil {
				return infrastructure.SubmitMutationResult{}, err
			}
			if !bytes.Equal(
				snapshotHash[:],
				requestPlan.GetAuthorizationSnapshotSha256(),
			) ||
				plan.AudienceSnapshotID !=
					deterministicPrivateID("snapshot", plan.PlanID) {
				if err := tx.RejectStale(ctx); err != nil {
					return infrastructure.SubmitMutationResult{},
						mapPrivateStoreError(operation, err)
				}
				return infrastructure.SubmitMutationResult{}, nil
			}

			claimRequest, claimResponse, err := decodePersistedClaim(
				plan,
			)
			if err != nil {
				return infrastructure.SubmitMutationResult{}, err
			}
			if err := s.keyExchange.ValidateContentPreKeyClaims(
				ctx,
				transaction,
				claimRequest,
				claimResponse,
			); err != nil {
				if keyexchangedomain.IsCode(
					err,
					keyexchangedomain.ErrorCodeStaleMaterial,
				) || keyexchangedomain.IsCode(
					err,
					keyexchangedomain.ErrorCodeUnauthorized,
				) || keyexchangedomain.IsCode(
					err,
					keyexchangedomain.ErrorCodeNotFound,
				) {
					if rejectErr := tx.RejectStale(ctx); rejectErr != nil {
						return infrastructure.SubmitMutationResult{},
							mapPrivateStoreError(operation, rejectErr)
					}
					return infrastructure.SubmitMutationResult{}, nil
				}
				return infrastructure.SubmitMutationResult{},
					mapPrivateDependencyError(operation, err)
			}
			for _, envelope := range material.Envelopes {
				if err := s.signatureVerifier.Verify(
					ctx,
					transaction,
					envelope.Envelope.GetBinding().GetSender(),
					envelope.SenderSigningKey,
					envelope.SigningBytes,
					envelope.Envelope.GetSenderSignature(),
				); err != nil {
					return infrastructure.SubmitMutationResult{},
						socialdomain.WrapPrivateContentError(
							socialdomain.PrivateContentIntegrityFailed,
							operation,
							err,
						)
				}
			}

			proof, proofRow, err := s.buildCommitProof(
				ctx,
				transaction,
				plan,
				requestPlan,
				author,
				material,
				domainCommitID,
				committedAt,
			)
			if err != nil {
				return infrastructure.SubmitMutationResult{}, err
			}
			plan.DomainCommitID = domainCommitID
			responseBytes, err := mutate(
				ctx,
				tx,
				plan,
				prepared,
				normalizedSnapshot,
				proof,
				proofRow,
				committedAt,
			)
			if err != nil {
				return infrastructure.SubmitMutationResult{}, err
			}
			return infrastructure.SubmitMutationResult{
				ResponseBytes: responseBytes,
				CompletedAt:   committedAt,
			}, nil
		},
	)
	if err != nil {
		return mapPrivateStoreError(operation, err)
	}
	if err := proto.Unmarshal(result.Receipt.ResponseBytes, response); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	if err := s.verifySubmitResponseProof(
		ctx,
		requestPlan,
		response,
	); err != nil {
		return err
	}
	switch typed := response.(type) {
	case *privatecontentpb.SubmitPrivateMomentResponse:
		typed.ExactReplay = result.ExactReplay
	case *privatecontentpb.SubmitPrivateCommentResponse:
		typed.ExactReplay = result.ExactReplay
	default:
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInternal,
			operation,
			"response",
			"has an unsupported response type",
		)
	}
	return nil
}

func (s *PrivateContentService) resolvePostSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
	audience *actormodel.Audience,
) (socialdomain.FriendsSnapshot, error) {
	switch audience.GetKind() {
	case actormodel.Audience_FRIENDS:
		return s.audiences.ResolveFriendsPostSnapshot(ctx, transaction, authorPTID)
	case actormodel.Audience_FOLLOWERS:
		return s.audiences.ResolveFollowersPostSnapshot(ctx, transaction, authorPTID)
	case actormodel.Audience_CIRCLE:
		return s.audiences.ResolveCirclePostSnapshot(
			ctx, transaction, authorPTID, audience.GetTargetId(),
		)
	case actormodel.Audience_GROUP:
		return s.audiences.ResolveGroupPostSnapshot(
			ctx, transaction, authorPTID, audience.GetTargetId(),
		)
	case actormodel.Audience_SELF:
		return socialdomain.FriendsSnapshot{
			Audience:         &actormodel.Audience{Kind: actormodel.Audience_SELF},
			SourceRevision:   1,
			SourceHeadSHA256: privateSHA256([]byte("social:self:" + authorPTID)),
		}, nil
	case actormodel.Audience_CUSTOM_ALLOW:
		return s.audiences.ResolveCustomAllowPostSnapshot(
			ctx, transaction, authorPTID, audience.GetActorPtids(),
		)
	case actormodel.Audience_CUSTOM_DENY:
		return s.audiences.ResolveCustomDenyPostSnapshot(
			ctx, transaction, authorPTID,
			audience.GetActorPtids(), audience.GetBaseKind(),
		)
	default:
		return socialdomain.FriendsSnapshot{}, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			"social.private_content.resolve_post_snapshot",
			"audience_kind",
			"unsupported audience kind",
		)
	}
}

func (s *PrivateContentService) resolveCurrentSnapshot(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	authorPTID string,
	prepared socialdomain.PrivatePrepareMaterial,
) (socialdomain.FriendsSnapshot, error) {
	var (
		snapshot socialdomain.FriendsSnapshot
		err      error
	)
	switch prepared.ResourceKind {
	case socialdomain.PrivateContentResourcePost:
		if prepared.Audience == nil {
			return snapshot, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				"social.private_content.revalidate_snapshot",
				"audience",
				"is unavailable from the durable prepare binding",
			)
		}
		snapshot, err = s.resolvePostSnapshot(
			ctx, transaction, authorPTID, prepared.Audience,
		)
	case socialdomain.PrivateContentResourceComment:
		snapshot, err = s.audiences.ResolvePrivateCommentSnapshot(
			ctx,
			transaction,
			prepared.ParentPostID,
			prepared.ReplyToCommentID,
			authorPTID,
		)
	default:
		return snapshot, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			"social.private_content.revalidate_snapshot",
			"resource_kind",
			"is unsupported",
		)
	}
	if err != nil {
		return snapshot, mapPrivateDependencyError(
			"social.private_content.revalidate_snapshot",
			err,
		)
	}
	return snapshot, nil
}

func (s *PrivateContentService) buildCommitProof(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	plan dbmodel.SocialPrivateContentPlan,
	requestPlan *securecontentpb.ContentEncryptionPlan,
	author *actormodel.ActorDeviceRef,
	material socialdomain.PrivateSubmitMaterial,
	domainCommitID string,
	committedAt time.Time,
) (
	*securecontentpb.ViewerContentCommitProof,
	dbmodel.SocialPrivateCommitProof,
	error,
) {
	const operation = "social.private_content.commit_proof"
	keyID, err := s.stationSigner.SigningKeyIDInTransaction(
		ctx,
		transaction,
	)
	if err != nil {
		return nil, dbmodel.SocialPrivateCommitProof{},
			mapPrivateDependencyError(operation, err)
	}
	proof := &securecontentpb.ViewerContentCommitProof{
		FormatVersion:               socialdomain.PrivateContentFormatVersion,
		DomainCommitId:              domainCommitID,
		CanonicalPlanSha256:         cloneApplicationBytes(requestPlan.GetCanonicalPlanSha256()),
		Resource:                    proto.Clone(requestPlan.GetResource()).(*securecontentpb.SecureResourceRef),
		Author:                      proto.Clone(author).(*actormodel.ActorDeviceRef),
		AuthorizationSnapshotSha256: cloneApplicationBytes(requestPlan.GetAuthorizationSnapshotSha256()),
		DomainBindingSha256:         cloneApplicationBytes(requestPlan.GetDomainBindingSha256()),
		EncryptedPayloadSha256:      material.EncryptedPayloadSHA256[:],
		ObjectDescriptorSetSha256:   material.ObjectDescriptorSetSHA256[:],
		MentionRoutingSha256:        material.MentionRoutingSHA256[:],
		SubtypeAuthoritySha256:      material.SubtypeAuthoritySHA256[:],
		CommittedAt:                 timestamppb.New(committedAt),
		StationSigningKeyId:         keyID,
	}
	signingBytes, err := socialdomain.CanonicalCommitProofSigningBytes(proof)
	if err != nil {
		return nil, dbmodel.SocialPrivateCommitProof{}, err
	}
	signature, err := s.stationSigner.SignInTransaction(
		ctx,
		transaction,
		keyID,
		signingBytes,
	)
	if err != nil {
		return nil, dbmodel.SocialPrivateCommitProof{},
			mapPrivateDependencyError(operation, err)
	}
	proof.StationSignature = cloneApplicationBytes(signature)
	if err := securecontentkernel.ValidateViewerContentCommitProof(proof); err != nil {
		return nil, dbmodel.SocialPrivateCommitProof{},
			socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentDependency,
				operation,
				err,
			)
	}
	proofBytes, err := socialdomain.CanonicalProtoBytes(proof)
	if err != nil {
		return nil, dbmodel.SocialPrivateCommitProof{}, err
	}
	proofHash := sha256.Sum256(proofBytes)
	return proof, dbmodel.SocialPrivateCommitProof{
		ContentID:            plan.ContentID,
		Generation:           plan.Generation,
		DomainCommitID:       domainCommitID,
		ResourceKind:         plan.ResourceKind,
		CanonicalProofBytes:  proofBytes,
		CanonicalProofSHA256: proofHash[:],
		StationSigningKeyID:  keyID,
		CommittedAt:          committedAt,
	}, nil
}

func (s *PrivateContentService) persistMoment(
	ctx context.Context,
	tx infrastructure.PrivateContentTransaction,
	plan dbmodel.SocialPrivateContentPlan,
	prepared socialdomain.PrivatePrepareMaterial,
	snapshot socialdomain.FriendsSnapshot,
	request *privatecontentpb.SubmitPrivateMomentRequest,
	material socialdomain.PrivateSubmitMaterial,
	proof *securecontentpb.ViewerContentCommitProof,
	proofRow dbmodel.SocialPrivateCommitProof,
	committedAt time.Time,
) ([]byte, error) {
	postKind, postType := privateMomentProjection(prepared.MomentKind)
	if err := tx.CreatePost(ctx, dbmodel.SocialPrivateContentPost{
		PostID:                    plan.ContentID,
		ContentID:                 plan.ContentID,
		AuthorPTID:                plan.AuthorPTID,
		Generation:                plan.Generation,
		AudienceSnapshotID:        plan.AudienceSnapshotID,
		Kind:                      postKind,
		EncryptedPayloadBytes:     cloneApplicationBytes(material.EncryptedPayloadBytes),
		EncryptedPayloadSHA256:    material.EncryptedPayloadSHA256[:],
		ObjectDescriptorSetSHA256: material.ObjectDescriptorSetSHA256[:],
		MentionRoutingSHA256:      material.MentionRoutingSHA256[:],
		SubtypeAuthoritySHA256:    material.SubtypeAuthoritySHA256[:],
		LifecycleState:            privateContentActiveState,
		CreatedAt:                 committedAt,
		UpdatedAt:                 committedAt,
	}); err != nil {
		return nil, mapPrivateStoreError(
			"social.private_content.persist_moment",
			err,
		)
	}
	if err := s.persistSharedSubmitRows(
		ctx,
		tx,
		plan,
		plan.ContentID,
		plan.ContentID,
		snapshot,
		material,
		committedAt,
	); err != nil {
		return nil, err
	}
	if err := tx.CreateCommitProof(ctx, proofRow); err != nil {
		return nil, mapPrivateStoreError(
			"social.private_content.persist_moment",
			err,
		)
	}
	viewerEnvelope, err := viewerEnvelopeForAuthor(
		plan,
		request.GetPlan().GetAuthor(),
		material.Envelopes,
	)
	if err != nil {
		return nil, err
	}
	response := &privatecontentpb.SubmitPrivateMomentResponse{
		Post: &privatecontentpb.PostResource{
			Metadata: &privatecontentpb.PostMetadata{
				PostId:    plan.ContentID,
				ContentId: plan.ContentID,
				Author: proto.Clone(
					request.GetPlan().GetAuthor().GetActor(),
				).(*actormodel.ActorRef),
				Type:         postType,
				AudienceKind: parseStoredAudienceKind(plan.AudienceKind),
				CreatedAt:    timestamppb.New(committedAt),
				UpdatedAt:    timestamppb.New(committedAt),
				Stats:        &actormodel.PostStats{},
			},
			Body: &privatecontentpb.PostResource_PrivateContent{
				PrivateContent: privateContentAccess(
					request.GetPayload(),
					request.GetObjects(),
					viewerEnvelope,
					proof,
					nil,
				),
			},
		},
	}
	responseBytes, err := socialdomain.CanonicalProtoBytes(response)
	return responseBytes, err
}

func (s *PrivateContentService) persistComment(
	ctx context.Context,
	tx infrastructure.PrivateContentTransaction,
	plan dbmodel.SocialPrivateContentPlan,
	prepared socialdomain.PrivatePrepareMaterial,
	snapshot socialdomain.FriendsSnapshot,
	request *privatecontentpb.SubmitPrivateCommentRequest,
	material socialdomain.PrivateSubmitMaterial,
	proof *securecontentpb.ViewerContentCommitProof,
	proofRow dbmodel.SocialPrivateCommitProof,
	committedAt time.Time,
) ([]byte, error) {
	retryAfter, err := tx.PrivateCommentRetryAfter(
		ctx,
		prepared.ParentPostID,
		plan.AuthorPTID,
		committedAt,
		privateCommentRateWindow,
		privateCommentActorLimit,
		privateCommentPostLimit,
	)
	if err != nil {
		if errors.Is(err, infrastructure.ErrPrivateContentNotFound) {
			if rejectErr := tx.RejectStale(ctx); rejectErr != nil {
				return nil, mapPrivateStoreError(
					"social.private_content.persist_comment",
					rejectErr,
				)
			}
			return nil, nil
		}
		return nil, mapPrivateStoreError(
			"social.private_content.persist_comment",
			err,
		)
	}
	if retryAfter > 0 {
		return nil, socialdomain.NewPrivateContentRateLimitError(
			"social.private_content.persist_comment",
			retryAfter,
		)
	}
	if err := tx.CreateComment(ctx, dbmodel.SocialPrivateContentComment{
		CommentID:                 plan.ContentID,
		ContentID:                 plan.ContentID,
		PostID:                    prepared.ParentPostID,
		ReplyToCommentID:          prepared.ReplyToCommentID,
		AuthorPTID:                plan.AuthorPTID,
		Generation:                plan.Generation,
		InteractionSnapshotID:     plan.AudienceSnapshotID,
		EncryptedPayloadBytes:     cloneApplicationBytes(material.EncryptedPayloadBytes),
		EncryptedPayloadSHA256:    material.EncryptedPayloadSHA256[:],
		ObjectDescriptorSetSHA256: material.ObjectDescriptorSetSHA256[:],
		MentionRoutingSHA256:      material.MentionRoutingSHA256[:],
		LifecycleState:            privateContentActiveState,
		CreatedAt:                 committedAt,
		UpdatedAt:                 committedAt,
	}); err != nil {
		return nil, mapPrivateStoreError(
			"social.private_content.persist_comment",
			err,
		)
	}
	if err := s.persistSharedSubmitRows(
		ctx,
		tx,
		plan,
		plan.ContentID,
		prepared.ParentPostID,
		snapshot,
		material,
		committedAt,
	); err != nil {
		return nil, err
	}
	if err := tx.CreateCommitProof(ctx, proofRow); err != nil {
		return nil, mapPrivateStoreError(
			"social.private_content.persist_comment",
			err,
		)
	}
	viewerEnvelope, err := viewerEnvelopeForAuthor(
		plan,
		request.GetPlan().GetAuthor(),
		material.Envelopes,
	)
	if err != nil {
		return nil, err
	}
	response := &privatecontentpb.SubmitPrivateCommentResponse{
		Comment: &privatecontentpb.CommentResource{
			Metadata: &privatecontentpb.CommentMetadata{
				CommentId:        plan.ContentID,
				ContentId:        plan.ContentID,
				PostId:           prepared.ParentPostID,
				ReplyToCommentId: prepared.ReplyToCommentID,
				Author: proto.Clone(
					request.GetPlan().GetAuthor().GetActor(),
				).(*actormodel.ActorRef),
				CreatedAt: timestamppb.New(committedAt),
				UpdatedAt: timestamppb.New(committedAt),
			},
			Body: &privatecontentpb.CommentResource_PrivateContent{
				PrivateContent: privateContentAccess(
					request.GetPayload(),
					request.GetObjects(),
					viewerEnvelope,
					proof,
					nil,
				),
			},
		},
	}
	return socialdomain.CanonicalProtoBytes(response)
}

func (s *PrivateContentService) persistSharedSubmitRows(
	ctx context.Context,
	tx infrastructure.PrivateContentTransaction,
	plan dbmodel.SocialPrivateContentPlan,
	resourceID string,
	postID string,
	snapshot socialdomain.FriendsSnapshot,
	material socialdomain.PrivateSubmitMaterial,
	committedAt time.Time,
) error {
	const operation = "social.private_content.persist_submit"
	_, snapshotHash, err := socialdomain.NormalizeFriendsSnapshot(
		operation,
		plan.AuthorPTID,
		snapshot,
	)
	if err != nil {
		return err
	}
	audienceTargetID := ""
	if snapshot.Audience.GetTargetId() != 0 {
		audienceTargetID = strconv.FormatUint(
			snapshot.Audience.GetTargetId(),
			10,
		)
	}
	if err := tx.CreateAudienceSnapshot(
		ctx,
		dbmodel.SocialPrivateAudienceSnapshot{
			SnapshotID:              plan.AudienceSnapshotID,
			ResourceKind:            plan.ResourceKind,
			ResourceID:              resourceID,
			PostID:                  postID,
			AudienceKind:            snapshot.Audience.GetKind().String(),
			AudienceTargetID:        audienceTargetID,
			SourceRevision:          snapshot.SourceRevision,
			CanonicalSnapshotSHA256: snapshotHash[:],
			CreatedAt:               committedAt,
		},
	); err != nil {
		return mapPrivateStoreError(operation, err)
	}
	grants := make(
		[]dbmodel.SocialPrivateRecipientGrant,
		0,
		len(snapshot.RecipientPTIDs),
	)
	for _, recipientPTID := range snapshot.RecipientPTIDs {
		grants = append(grants, dbmodel.SocialPrivateRecipientGrant{
			SnapshotID:    plan.AudienceSnapshotID,
			RecipientPTID: recipientPTID,
			GrantedAt:     committedAt,
		})
	}
	if err := tx.CreateRecipientGrants(ctx, grants); err != nil {
		return mapPrivateStoreError(operation, err)
	}

	envelopes, deliveries, principals, err := persistenceEnvelopes(
		plan,
		material.Envelopes,
		committedAt,
	)
	if err != nil {
		return err
	}
	if err := tx.CreateEnvelopes(ctx, envelopes); err != nil {
		return mapPrivateStoreError(operation, err)
	}
	if err := tx.CreateDeliveryIntents(ctx, deliveries); err != nil {
		return mapPrivateStoreError(operation, err)
	}

	if len(material.Objects) == 0 {
		return nil
	}
	attachments := make(
		[]infrastructure.PrivateObjectAttachment,
		0,
		len(material.Objects),
	)
	objectGrants := make(
		[]dbmodel.SocialPrivateObjectGrant,
		0,
		len(material.Objects)*len(principals),
	)
	for _, object := range material.Objects {
		attachments = append(
			attachments,
			infrastructure.PrivateObjectAttachment{
				ObjectID:         object.Descriptor.GetObjectId(),
				ContentID:        plan.ContentID,
				DescriptorSHA256: object.DescriptorSHA256[:],
				DomainCommitID:   plan.DomainCommitID,
				AttachedAt:       committedAt,
			},
		)
		for _, principal := range principals {
			objectGrants = append(
				objectGrants,
				dbmodel.SocialPrivateObjectGrant{
					ObjectID:          object.Descriptor.GetObjectId(),
					PrincipalKind:     principal.KeyKind,
					PrincipalPTID:     principal.ActorPTID,
					PrincipalDeviceID: principal.DeviceID,
					DomainCommitID:    plan.DomainCommitID,
					GrantedAt:         committedAt,
				},
			)
		}
	}
	if err := tx.AttachObjects(ctx, attachments); err != nil {
		return mapPrivateStoreError(operation, err)
	}
	if err := tx.CreateObjectGrants(ctx, objectGrants); err != nil {
		return mapPrivateStoreError(operation, err)
	}
	return nil
}

type privateEnvelopePrincipal struct {
	KeyKind   string
	ActorPTID string
	DeviceID  string
}

func persistenceEnvelopes(
	plan dbmodel.SocialPrivateContentPlan,
	materials []socialdomain.PrivateEnvelopeMaterial,
	createdAt time.Time,
) (
	[]dbmodel.SocialPrivateContentEnvelope,
	[]dbmodel.SocialPrivateDeliveryIntent,
	[]privateEnvelopePrincipal,
	error,
) {
	claimRequest, claimResponse, err := decodePersistedClaim(plan)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(claimRequest.GetTargets()) != len(materials) ||
		len(claimResponse.GetClaims()) != len(materials) {
		return nil, nil, nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			"social.private_content.persist_envelopes",
			"claims",
			"do not cover the submitted envelopes",
		)
	}
	claimsByKey := make(
		map[string]*securecontentpb.ClaimedContentPreKey,
		len(claimResponse.GetClaims()),
	)
	for _, claim := range claimResponse.GetClaims() {
		claimsByKey[claimTargetKey(claim.GetTarget())] = claim
	}

	envelopes := make(
		[]dbmodel.SocialPrivateContentEnvelope,
		0,
		len(materials),
	)
	deliveries := make(
		[]dbmodel.SocialPrivateDeliveryIntent,
		0,
		len(materials),
	)
	principals := make([]privateEnvelopePrincipal, 0, len(materials))
	for _, material := range materials {
		binding := material.Envelope.GetBinding()
		var claim *securecontentpb.ClaimedContentPreKey
		for _, candidate := range claimsByKey {
			slotID := deterministicPrivateID(
				"slot",
				plan.PlanID,
				candidate.GetClaimId(),
			)
			if slotID == binding.GetRecipientSlotId() {
				claim = candidate
				break
			}
		}
		if claim == nil {
			return nil, nil, nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentConflict,
				"social.private_content.persist_envelopes",
				"recipient_slot_id",
				"does not map to the durable claim response",
			)
		}
		principal, keyKind, err := persistencePrincipal(claim.GetTarget())
		if err != nil {
			return nil, nil, nil, err
		}
		senderSignatureHash := sha256.Sum256(
			material.Envelope.GetSenderSignature(),
		)
		envelopes = append(envelopes, dbmodel.SocialPrivateContentEnvelope{
			ContentID:         plan.ContentID,
			KeyKind:           keyKind,
			RecipientPTID:     principal.ActorPTID,
			RecipientDeviceID: principal.DeviceID,
			OneTimeKeyID:      claim.GetPrekey().GetKeyId(),
			PlanID:            plan.PlanID,
			RecipientSlotID:   binding.GetRecipientSlotId(),
			PrincipalEpoch: claim.GetPrekey().
				GetProfileOrRecoveryEpoch(),
			PreparedEnvelopeBytes: cloneApplicationBytes(
				material.CanonicalBytes,
			),
			CanonicalPlanSHA256: cloneApplicationBytes(
				binding.GetCanonicalPlanSha256(),
			),
			PrincipalBindingSHA256: cloneApplicationBytes(
				binding.GetPrincipalBindingSha256(),
			),
			BindingSHA256: cloneApplicationBytes(
				material.Envelope.GetBindingSha256(),
			),
			EnvelopeSHA256:        material.EnvelopeSHA256[:],
			SenderSignatureSHA256: senderSignatureHash[:],
			CreatedAt:             createdAt,
		})
		principal.KeyKind = keyKind
		principals = append(principals, principal)
		if keyKind == infrastructure.PrivateContentKeyKindEndpoint &&
			principal.ActorPTID != plan.AuthorPTID {
			deliveries = append(deliveries, dbmodel.SocialPrivateDeliveryIntent{
				IntentID: deterministicPrivateID(
					"delivery",
					plan.DomainCommitID,
					binding.GetRecipientSlotId(),
				),
				ContentID:         plan.ContentID,
				DomainCommitID:    plan.DomainCommitID,
				RecipientPTID:     principal.ActorPTID,
				RecipientDeviceID: principal.DeviceID,
				IdempotencyKey: deterministicPrivateID(
					"delivery-key",
					plan.DomainCommitID,
					binding.GetRecipientSlotId(),
				),
				OpaquePayload: cloneApplicationBytes(
					material.CanonicalBytes,
				),
				PayloadSHA256: material.EnvelopeSHA256[:],
				State:         dbmodel.SocialPrivateDeliveryIntentStatePending,
				CreatedAt:     createdAt,
			})
		}
	}
	if len(deliveries) == 0 {
		return nil, nil, nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			"social.private_content.persist_envelopes",
			"delivery_intents",
			"FRIENDS plan contains no recipient endpoint delivery",
		)
	}
	return envelopes, deliveries, principals, nil
}

func privateContentAccess(
	payload *securecontentpb.EncryptedPayload,
	objects []*securecontentpb.EncryptedObjectDescriptor,
	viewerEnvelope *securecontentpb.ViewerContentKeyEnvelope,
	proof *securecontentpb.ViewerContentCommitProof,
	attestation *securecontentpb.StationContentSigningKeyAttestation,
) *privatecontentpb.PrivateContentAccess {
	clonedObjects := make([]*securecontentpb.EncryptedObjectDescriptor, 0, len(objects))
	for _, object := range objects {
		clonedObjects = append(
			clonedObjects,
			proto.Clone(object).(*securecontentpb.EncryptedObjectDescriptor),
		)
	}
	verification := &privatecontentpb.PrivateContentVerification{
		CommitProof: proto.Clone(
			proof,
		).(*securecontentpb.ViewerContentCommitProof),
	}
	if attestation != nil {
		verification.StationSigningKeyAttestation = proto.Clone(
			attestation,
		).(*securecontentpb.StationContentSigningKeyAttestation)
	}
	return &privatecontentpb.PrivateContentAccess{
		Payload:        proto.Clone(payload).(*securecontentpb.EncryptedPayload),
		ViewerEnvelope: viewerEnvelope,
		Objects:        clonedObjects,
		Verification:   verification,
	}
}

func viewerEnvelopeForAuthor(
	plan dbmodel.SocialPrivateContentPlan,
	author *actormodel.ActorDeviceRef,
	materials []socialdomain.PrivateEnvelopeMaterial,
) (*securecontentpb.ViewerContentKeyEnvelope, error) {
	_, response, err := decodePersistedClaim(plan)
	if err != nil {
		return nil, err
	}
	for _, claim := range response.GetClaims() {
		target := claim.GetTarget()
		if target.GetKind() !=
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT ||
			target.GetEndpoint().GetActor().GetPtid() !=
				author.GetActor().GetPtid() ||
			target.GetEndpoint().GetDeviceId() != author.GetDeviceId() {
			continue
		}
		slotID := deterministicPrivateID(
			"slot",
			plan.PlanID,
			claim.GetClaimId(),
		)
		for _, material := range materials {
			if material.Envelope.GetBinding().GetRecipientSlotId() != slotID {
				continue
			}
			envelope := &securecontentpb.ViewerContentKeyEnvelope{
				Binding: proto.Clone(
					material.Envelope.GetBinding(),
				).(*securecontentpb.ContentKeyEnvelopeBinding),
				Recipient: &securecontentpb.ViewerContentKeyEnvelope_Endpoint{
					Endpoint: proto.Clone(author).(*actormodel.ActorDeviceRef),
				},
				BindingSha256: cloneApplicationBytes(
					material.Envelope.GetBindingSha256(),
				),
				HpkeEncapsulatedKey: cloneApplicationBytes(
					material.Envelope.GetHpkeEncapsulatedKey(),
				),
				HpkeCiphertext: cloneApplicationBytes(
					material.Envelope.GetHpkeCiphertext(),
				),
				SenderSignature: cloneApplicationBytes(
					material.Envelope.GetSenderSignature(),
				),
				PrincipalEpoch: claim.GetPrekey().
					GetProfileOrRecoveryEpoch(),
			}
			if err := securecontentkernel.ValidateViewerContentKeyEnvelope(
				envelope,
				securecontentkernel.DefaultPolicy(),
			); err != nil {
				return nil, socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentIntegrityFailed,
					"social.private_content.viewer_envelope",
					err,
				)
			}
			return envelope, nil
		}
	}
	return nil, socialdomain.NewPrivateContentError(
		socialdomain.PrivateContentConflict,
		"social.private_content.viewer_envelope",
		"author_endpoint",
		"has no prepared endpoint envelope",
	)
}

func buildClaimedSlots(
	operation string,
	planID string,
	request *securecontentpb.ClaimContentPreKeysRequest,
	response *securecontentpb.ClaimContentPreKeysResponse,
	createdAt time.Time,
) (
	*securecontentpb.ClaimContentPreKeysResponse,
	[]dbmodel.SocialPrivateContentPlanSlot,
	[]*securecontentpb.RequiredContentRecipientSlot,
	error,
) {
	if response == nil ||
		len(response.ProtoReflect().GetUnknown()) != 0 ||
		len(response.GetClaims()) != len(request.GetTargets()) {
		return nil, nil, nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			"claim_response",
			"must contain one canonical claim per target",
		)
	}
	normalizedResponse := proto.Clone(
		response,
	).(*securecontentpb.ClaimContentPreKeysResponse)
	normalizedResponse.ExactReplay = false
	slots := make([]dbmodel.SocialPrivateContentPlanSlot, 0, len(response.GetClaims()))
	requiredSlots := make(
		[]*securecontentpb.RequiredContentRecipientSlot,
		0,
		len(response.GetClaims()),
	)
	claimIDs := make(map[string]struct{}, len(response.GetClaims()))
	keyIDs := make(map[string]struct{}, len(response.GetClaims()))
	for index, claim := range normalizedResponse.GetClaims() {
		if claim == nil ||
			len(claim.ProtoReflect().GetUnknown()) != 0 ||
			!claim.GetIrreversiblyConsumed() ||
			!proto.Equal(claim.GetTarget(), request.GetTargets()[index]) ||
			claim.GetPrekey() == nil ||
			!proto.Equal(
				claim.GetPrekey().GetEndpoint(),
				claim.GetTarget().GetEndpoint(),
			) ||
			!proto.Equal(
				claim.GetPrekey().GetRecoveryActor(),
				claim.GetTarget().GetRecoveryActor(),
			) ||
			claim.GetPrekey().GetKind() != claim.GetTarget().GetKind() ||
			len(claim.GetPrekey().GetX25519PublicKey()) !=
				securecontentkernel.X25519PublicKeySize ||
			len(claim.GetPrekey().GetIssuerSignature()) !=
				securecontentkernel.Ed25519SignatureSize ||
			claim.GetPrekey().GetProfileOrRecoveryEpoch() == 0 {
			return nil, nil, nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentDependency,
				operation,
				"claim_response",
				"contains an invalid or reordered claim",
			)
		}
		if _, exists := claimIDs[claim.GetClaimId()]; exists ||
			strings.TrimSpace(claim.GetClaimId()) == "" {
			return nil, nil, nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentDependency,
				operation,
				"claim_id",
				"must be canonical and unique",
			)
		}
		if _, exists := keyIDs[claim.GetPrekey().GetKeyId()]; exists ||
			strings.TrimSpace(claim.GetPrekey().GetKeyId()) == "" {
			return nil, nil, nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentDependency,
				operation,
				"one_time_key_id",
				"must be canonical and unique",
			)
		}
		claimIDs[claim.GetClaimId()] = struct{}{}
		keyIDs[claim.GetPrekey().GetKeyId()] = struct{}{}
		preKeyBytes, err := socialdomain.CanonicalProtoBytes(claim.GetPrekey())
		if err != nil {
			return nil, nil, nil, err
		}
		preKeyHash := sha256.Sum256(preKeyBytes)
		slotID := deterministicPrivateID("slot", planID, claim.GetClaimId())
		principalBytes, err := canonicalClaimPrincipal(claim.GetTarget())
		if err != nil {
			return nil, nil, nil, err
		}
		principalBinding := sha256.New()
		_, _ = principalBinding.Write([]byte(planID))
		_, _ = principalBinding.Write([]byte(slotID))
		_, _ = principalBinding.Write(principalBytes)
		_, _ = principalBinding.Write([]byte(claim.GetClaimId()))
		_, _ = principalBinding.Write([]byte(claim.GetPrekey().GetKeyId()))
		_, _ = principalBinding.Write(claim.GetPrekey().GetX25519PublicKey())
		principalBindingHash := principalBinding.Sum(nil)
		principal, keyKind, err := persistencePrincipal(claim.GetTarget())
		if err != nil {
			return nil, nil, nil, err
		}
		slots = append(slots, dbmodel.SocialPrivateContentPlanSlot{
			PlanID:                 planID,
			RecipientSlotID:        slotID,
			ClaimID:                claim.GetClaimId(),
			OneTimeKeyID:           claim.GetPrekey().GetKeyId(),
			KeyKind:                keyKind,
			RecipientPTID:          principal.ActorPTID,
			RecipientDeviceID:      principal.DeviceID,
			PrincipalEpoch:         claim.GetPrekey().GetProfileOrRecoveryEpoch(),
			ClaimedPreKeyBytes:     preKeyBytes,
			ClaimedPreKeySHA256:    preKeyHash[:],
			PrincipalBindingSHA256: principalBindingHash,
			CreatedAt:              createdAt,
		})
		requiredSlots = append(
			requiredSlots,
			&securecontentpb.RequiredContentRecipientSlot{
				RecipientSlotId:  slotID,
				KeyKind:          claim.GetTarget().GetKind(),
				OneTimeKeyId:     claim.GetPrekey().GetKeyId(),
				OneTimePublicKey: cloneApplicationBytes(claim.GetPrekey().GetX25519PublicKey()),
				PrincipalBindingSha256: cloneApplicationBytes(
					principalBindingHash,
				),
			},
		)
	}
	sort.Slice(slots, func(left int, right int) bool {
		return slots[left].RecipientSlotID < slots[right].RecipientSlotID
	})
	sort.Slice(requiredSlots, func(left int, right int) bool {
		return requiredSlots[left].GetRecipientSlotId() <
			requiredSlots[right].GetRecipientSlotId()
	})
	return normalizedResponse, slots, requiredSlots, nil
}

func normalizeClaimTargets(
	operation string,
	author *actormodel.ActorDeviceRef,
	recipients []string,
	targets []*securecontentpb.ContentPreKeyClaimTarget,
) ([]*securecontentpb.ContentPreKeyClaimTarget, error) {
	if len(targets) == 0 ||
		len(targets) > socialdomain.MaximumPrivateRecipientSlots {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"claim_targets",
			"must contain between 1 and 1000 principals",
		)
	}
	expectedActors := make(map[string]struct{}, len(recipients)+1)
	expectedActors[author.GetActor().GetPtid()] = struct{}{}
	for _, recipient := range recipients {
		expectedActors[recipient] = struct{}{}
	}
	type coverage struct {
		endpoints int
		recovery  int
	}
	covered := make(map[string]coverage, len(expectedActors))
	seen := make(map[string]struct{}, len(targets))
	normalized := make(
		[]*securecontentpb.ContentPreKeyClaimTarget,
		0,
		len(targets),
	)
	for _, target := range targets {
		key := claimTargetKey(target)
		if key == "" {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"claim_targets",
				"contains an invalid endpoint or recovery principal",
			)
		}
		if _, duplicate := seen[key]; duplicate {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentConflict,
				operation,
				"claim_targets",
				"contains a duplicate principal",
			)
		}
		seen[key] = struct{}{}
		actorPTID := claimTargetActorPTID(target)
		if _, expected := expectedActors[actorPTID]; !expected {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				"claim_targets",
				"contains a principal outside the frozen audience snapshot",
			)
		}
		current := covered[actorPTID]
		switch target.GetKind() {
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
			current.endpoints++
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
			current.recovery++
		default:
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnsupported,
				operation,
				"claim_targets.kind",
				"is unsupported",
			)
		}
		covered[actorPTID] = current
		normalized = append(
			normalized,
			proto.Clone(target).(*securecontentpb.ContentPreKeyClaimTarget),
		)
	}
	authorEndpointKey := strings.Join(
		[]string{
			"1",
			author.GetActor().GetPtid(),
			author.GetDeviceId(),
		},
		"\x00",
	)
	if _, found := seen[authorEndpointKey]; !found {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			operation,
			"claim_targets",
			"does not contain the authenticated author endpoint",
		)
	}
	for actorPTID := range expectedActors {
		current := covered[actorPTID]
		if current.endpoints == 0 || current.recovery != 1 {
			return nil, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentDependency,
				operation,
				"claim_targets",
				"must contain active endpoints and exactly one recovery principal for every actor",
			)
		}
	}
	sort.Slice(normalized, func(left int, right int) bool {
		return claimTargetKey(normalized[left]) <
			claimTargetKey(normalized[right])
	})
	return normalized, nil
}

func claimTargetKey(target *securecontentpb.ContentPreKeyClaimTarget) string {
	if target == nil || len(target.ProtoReflect().GetUnknown()) != 0 {
		return ""
	}
	switch target.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		endpoint := target.GetEndpoint()
		if endpoint == nil ||
			endpoint.GetActor() == nil ||
			endpoint.GetActor().GetPtid() == "" ||
			endpoint.GetActor().GetAcct() != "" ||
			endpoint.GetActor().GetKind() !=
				actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED ||
			endpoint.GetDeviceId() == "" {
			return ""
		}
		return strings.Join(
			[]string{
				"1",
				endpoint.GetActor().GetPtid(),
				endpoint.GetDeviceId(),
			},
			"\x00",
		)
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		actor := target.GetRecoveryActor()
		if actor == nil ||
			actor.GetPtid() == "" ||
			actor.GetAcct() != "" ||
			actor.GetKind() != actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
			return ""
		}
		return strings.Join([]string{"2", actor.GetPtid(), ""}, "\x00")
	default:
		return ""
	}
}

func claimTargetActorPTID(
	target *securecontentpb.ContentPreKeyClaimTarget,
) string {
	if target.GetKind() ==
		securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT {
		return target.GetEndpoint().GetActor().GetPtid()
	}
	return target.GetRecoveryActor().GetPtid()
}

func canonicalClaimPrincipal(
	target *securecontentpb.ContentPreKeyClaimTarget,
) ([]byte, error) {
	switch target.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		return socialdomain.CanonicalProtoBytes(target.GetEndpoint())
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		return socialdomain.CanonicalProtoBytes(target.GetRecoveryActor())
	default:
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			"social.private_content.canonical_claim_principal",
			"kind",
			"is unsupported",
		)
	}
}

func persistencePrincipal(
	target *securecontentpb.ContentPreKeyClaimTarget,
) (privateEnvelopePrincipal, string, error) {
	switch target.GetKind() {
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
		return privateEnvelopePrincipal{
				ActorPTID: target.GetEndpoint().GetActor().GetPtid(),
				DeviceID:  target.GetEndpoint().GetDeviceId(),
			},
			infrastructure.PrivateContentKeyKindEndpoint,
			nil
	case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
		return privateEnvelopePrincipal{
				ActorPTID: target.GetRecoveryActor().GetPtid(),
			},
			infrastructure.PrivateContentKeyKindActorRecovery,
			nil
	default:
		return privateEnvelopePrincipal{}, "", socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			"social.private_content.persistence_principal",
			"kind",
			"is unsupported",
		)
	}
}

func validatePersistedPlan(
	persisted dbmodel.SocialPrivateContentPlan,
	request *securecontentpb.ContentEncryptionPlan,
	author *actormodel.ActorDeviceRef,
) error {
	const operation = "social.private_content.validate_persisted_plan"
	requestBytes, err := socialdomain.CanonicalProtoBytes(request)
	if err != nil {
		return err
	}
	requestHash := sha256.Sum256(requestBytes)
	if persisted.PlanID != request.GetPlanId() ||
		persisted.ContentID != request.GetResource().GetContentId() ||
		persisted.Generation != request.GetResource().GetGeneration() ||
		persisted.AuthorPTID != author.GetActor().GetPtid() ||
		persisted.AuthorDeviceID != author.GetDeviceId() ||
		!bytes.Equal(persisted.SignedPlanBytes, requestBytes) ||
		!bytes.Equal(persisted.SignedPlanSHA256, requestHash[:]) ||
		!bytes.Equal(
			persisted.CanonicalPlanSHA256,
			request.GetCanonicalPlanSha256(),
		) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			"plan",
			"does not match the durable PREPARED plan",
		)
	}
	return nil
}

func (s *PrivateContentService) decodePreparedPlan(
	ctx context.Context,
	persisted dbmodel.SocialPrivateContentPlan,
) (*securecontentpb.ContentEncryptionPlan, error) {
	return decodeAndVerifyPrivateContentPlan(
		ctx,
		s.stationSigner,
		persisted,
	)
}

func decodeAndVerifyPrivateContentPlan(
	ctx context.Context,
	stationSigner PrivateContentStationSigner,
	persisted dbmodel.SocialPrivateContentPlan,
) (*securecontentpb.ContentEncryptionPlan, error) {
	const operation = "social.private_content.decode_prepared_plan"
	plan := &securecontentpb.ContentEncryptionPlan{}
	if err := proto.Unmarshal(persisted.SignedPlanBytes, plan); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	canonical, err := socialdomain.CanonicalProtoBytes(plan)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(canonical)
	if !bytes.Equal(canonical, persisted.SignedPlanBytes) ||
		!bytes.Equal(digest[:], persisted.SignedPlanSHA256) ||
		!bytes.Equal(
			plan.GetCanonicalPlanSha256(),
			persisted.CanonicalPlanSHA256,
		) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"plan",
			"durable signed plan bytes or commitments differ",
		)
	}
	if err := socialdomain.ValidateCanonicalEncryptionPlan(plan); err != nil {
		return nil, err
	}
	if err := verifyPrivateContentPlanSignature(
		ctx,
		stationSigner,
		plan,
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	return plan, nil
}

func decodeAndVerifyPrivateContentPlanInTransaction(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	stationSigner PrivateContentStationSigner,
	persisted dbmodel.SocialPrivateContentPlan,
) (*securecontentpb.ContentEncryptionPlan, error) {
	plan, err := decodePrivateContentPlanBytes(persisted)
	if err != nil {
		return nil, err
	}
	if err := verifyPrivateContentPlanSignatureInTransaction(
		ctx,
		transaction,
		stationSigner,
		plan,
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			"social.private_content.decode_prepared_plan",
			err,
		)
	}
	return plan, nil
}

func decodePrivateContentPlanBytes(
	persisted dbmodel.SocialPrivateContentPlan,
) (*securecontentpb.ContentEncryptionPlan, error) {
	const operation = "social.private_content.decode_prepared_plan"
	plan := &securecontentpb.ContentEncryptionPlan{}
	if err := proto.Unmarshal(persisted.SignedPlanBytes, plan); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	canonical, err := socialdomain.CanonicalProtoBytes(plan)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(canonical)
	if !bytes.Equal(canonical, persisted.SignedPlanBytes) ||
		!bytes.Equal(digest[:], persisted.SignedPlanSHA256) ||
		!bytes.Equal(
			plan.GetCanonicalPlanSha256(),
			persisted.CanonicalPlanSHA256,
		) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"plan",
			"durable signed plan bytes or commitments differ",
		)
	}
	if err := socialdomain.ValidateCanonicalEncryptionPlan(plan); err != nil {
		return nil, err
	}
	return plan, nil
}

func verifyPrivateContentPlanSignature(
	ctx context.Context,
	stationSigner PrivateContentStationSigner,
	plan *securecontentpb.ContentEncryptionPlan,
) error {
	if stationSigner == nil || plan == nil {
		return errors.New("private content plan signature input is unavailable")
	}
	signingBytes, err :=
		socialdomain.CanonicalEncryptionPlanSigningBytes(plan)
	if err != nil {
		return err
	}
	return stationSigner.Verify(
		ctx,
		plan.GetStationSigningKeyId(),
		signingBytes,
		plan.GetStationSignature(),
	)
}

func verifyPrivateContentPlanSignatureInTransaction(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	stationSigner PrivateContentStationSigner,
	plan *securecontentpb.ContentEncryptionPlan,
) error {
	if stationSigner == nil || transaction == nil || plan == nil {
		return errors.New(
			"private content transactional plan signature input is unavailable",
		)
	}
	signingBytes, err :=
		socialdomain.CanonicalEncryptionPlanSigningBytes(plan)
	if err != nil {
		return err
	}
	return stationSigner.VerifyInTransaction(
		ctx,
		transaction,
		plan.GetStationSigningKeyId(),
		signingBytes,
		plan.GetStationSignature(),
	)
}

func (s *PrivateContentService) verifySubmitResponseProof(
	ctx context.Context,
	requestPlan *securecontentpb.ContentEncryptionPlan,
	response proto.Message,
) error {
	const operation = "social.private_content.verify_submit_response"
	var access *privatecontentpb.PrivateContentAccess
	switch typed := response.(type) {
	case *privatecontentpb.SubmitPrivateMomentResponse:
		access = typed.GetPost().GetPrivateContent()
	case *privatecontentpb.SubmitPrivateCommentResponse:
		access = typed.GetComment().GetPrivateContent()
	default:
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInternal,
			operation,
			"response",
			"has an unsupported response type",
		)
	}
	proof := access.GetVerification().GetCommitProof()
	if proof == nil ||
		requestPlan == nil ||
		!bytes.Equal(
			proof.GetCanonicalPlanSha256(),
			requestPlan.GetCanonicalPlanSha256(),
		) ||
		!proto.Equal(proof.GetResource(), requestPlan.GetResource()) ||
		!proto.Equal(proof.GetAuthor(), requestPlan.GetAuthor()) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"commit_proof",
			"does not match the submitted plan",
		)
	}
	if err := securecontentkernel.ValidateViewerContentCommitProof(proof); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	signingBytes, err := socialdomain.CanonicalCommitProofSigningBytes(proof)
	if err != nil {
		return err
	}
	if err := s.stationSigner.Verify(
		ctx,
		proof.GetStationSigningKeyId(),
		signingBytes,
		proof.GetStationSignature(),
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	return nil
}

func decodePersistedPrepare(
	plan dbmodel.SocialPrivateContentPlan,
	binding infrastructure.PrivatePrepareBinding,
) (socialdomain.PrivatePrepareMaterial, error) {
	const operation = "social.private_content.decode_prepare"
	audience := &actormodel.Audience{}
	if err := proto.Unmarshal(binding.AudienceBytes, audience); err != nil {
		return socialdomain.PrivatePrepareMaterial{},
			socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
	}
	audienceBytes, err := socialdomain.CanonicalProtoBytes(audience)
	if err != nil {
		return socialdomain.PrivatePrepareMaterial{}, err
	}
	audienceHash := sha256.Sum256(audienceBytes)
	if !bytes.Equal(audienceBytes, binding.AudienceBytes) ||
		!bytes.Equal(audienceHash[:], binding.AudienceSHA256) {
		return socialdomain.PrivatePrepareMaterial{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"audience",
				"durable audience bytes or hash differ",
			)
	}
	switch plan.ResourceKind {
	case infrastructure.PrivateContentResourcePost:
		input := &privatecontentpb.PreparePrivateMomentHashInput{}
		if err := proto.Unmarshal(plan.CanonicalPrepareBytes, input); err != nil {
			return socialdomain.PrivatePrepareMaterial{},
				socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentIntegrityFailed,
					operation,
					err,
				)
		}
		if input.GetAudienceSha256() == nil ||
			!bytes.Equal(input.GetAudienceSha256(), audienceHash[:]) ||
			plan.AudienceKind != audience.GetKind().String() {
			return socialdomain.PrivatePrepareMaterial{},
				socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentIntegrityFailed,
					operation,
					"audience",
					"does not match the canonical prepare commitment",
				)
		}
		request := &privatecontentpb.PreparePrivateMomentRequest{
			ContentId:   input.GetContentId(),
			Audience:    audience,
			ObjectCount: input.GetObjectCount(),
			CommandId:   input.GetCommandId(),
			Kind:        input.GetKind(),
		}
		material, err := socialdomain.CanonicalizePrivateMomentPrepare(request)
		if err != nil {
			return material, err
		}
		if !bytes.Equal(material.CanonicalBytes, plan.CanonicalPrepareBytes) ||
			!bytes.Equal(
				material.CanonicalSHA256[:],
				plan.CanonicalPrepareSHA256,
			) {
			return material, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"prepare",
				"durable Post prepare bytes or hash differ",
			)
		}
		return material, nil
	case infrastructure.PrivateContentResourceComment:
		input := &privatecontentpb.PreparePrivateCommentHashInput{}
		if err := proto.Unmarshal(plan.CanonicalPrepareBytes, input); err != nil {
			return socialdomain.PrivatePrepareMaterial{},
				socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentIntegrityFailed,
					operation,
					err,
				)
		}
		request := &privatecontentpb.PreparePrivateCommentRequest{
			PostId:           input.GetPostId(),
			CommentContentId: input.GetCommentContentId(),
			ReplyToCommentId: input.GetReplyToCommentId(),
			ObjectCount:      input.GetObjectCount(),
			CommandId:        input.GetCommandId(),
		}
		material, err := socialdomain.CanonicalizePrivateCommentPrepare(request)
		if err != nil {
			return material, err
		}
		if !bytes.Equal(material.CanonicalBytes, plan.CanonicalPrepareBytes) ||
			!bytes.Equal(
				material.CanonicalSHA256[:],
				plan.CanonicalPrepareSHA256,
			) {
			return material, socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"prepare",
				"durable Comment prepare bytes or hash differ",
			)
		}
		material.Audience = audience
		material.AudienceKind = audience.GetKind()
		return material, nil
	default:
		return socialdomain.PrivatePrepareMaterial{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentConflict,
				operation,
				"resource_kind",
				"is unsupported",
			)
	}
}

func decodePersistedClaim(
	plan dbmodel.SocialPrivateContentPlan,
) (
	*securecontentpb.ClaimContentPreKeysRequest,
	*securecontentpb.ClaimContentPreKeysResponse,
	error,
) {
	const operation = "social.private_content.decode_claim"
	request := &securecontentpb.ClaimContentPreKeysRequest{}
	response := &securecontentpb.ClaimContentPreKeysResponse{}
	if err := proto.Unmarshal(plan.ClaimRequestBytes, request); err != nil {
		return nil, nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	if err := proto.Unmarshal(plan.ClaimResponseBytes, response); err != nil {
		return nil, nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	requestBytes, err := socialdomain.CanonicalProtoBytes(request)
	if err != nil {
		return nil, nil, err
	}
	response.ExactReplay = false
	responseBytes, err := socialdomain.CanonicalProtoBytes(response)
	if err != nil {
		return nil, nil, err
	}
	requestHash := sha256.Sum256(requestBytes)
	responseHash := sha256.Sum256(responseBytes)
	if !bytes.Equal(requestBytes, plan.ClaimRequestBytes) ||
		!bytes.Equal(requestHash[:], plan.ClaimRequestSHA256) ||
		!bytes.Equal(responseBytes, plan.ClaimResponseBytes) ||
		!bytes.Equal(responseHash[:], plan.ClaimResponseSHA256) {
		return nil, nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"claim",
			"durable claim bytes or hashes differ",
		)
	}
	return request, response, nil
}

func privateMomentProjection(
	kind privatecontentpb.PrivateMomentKind,
) (string, actormodel.PostType) {
	if kind == privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_IMAGE {
		return privateContentPostKindImage, actormodel.PostType_IMAGE
	}
	return privateContentPostKindText, actormodel.PostType_TEXT
}

func deterministicPrivateID(kind string, values ...string) string {
	digest := sha256.New()
	_, _ = digest.Write([]byte("peers-touch:social-private:" + kind + ":v1\x00"))
	for _, value := range values {
		_, _ = digest.Write([]byte(strconv.Itoa(len(value))))
		_, _ = digest.Write([]byte{0})
		_, _ = digest.Write([]byte(value))
	}
	return kind + "-" + hex.EncodeToString(digest.Sum(nil)[:16])
}

func cloneRequiredSlots(
	slots []*securecontentpb.RequiredContentRecipientSlot,
) []*securecontentpb.RequiredContentRecipientSlot {
	cloned := make(
		[]*securecontentpb.RequiredContentRecipientSlot,
		0,
		len(slots),
	)
	for _, slot := range slots {
		cloned = append(
			cloned,
			proto.Clone(slot).(*securecontentpb.RequiredContentRecipientSlot),
		)
	}
	return cloned
}

func cloneApplicationBytes(value []byte) []byte {
	return append([]byte(nil), value...)
}

func parseStoredAudienceKind(s string) actormodel.Audience_Kind {
	if v, ok := actormodel.Audience_Kind_value[s]; ok {
		return actormodel.Audience_Kind(v)
	}
	return actormodel.Audience_KIND_UNSPECIFIED
}

func mapPrivateStoreError(operation string, err error) error {
	if err == nil {
		return nil
	}
	if socialdomain.PrivateContentCodeOf(err) != "" {
		return err
	}
	switch {
	case errors.Is(err, infrastructure.ErrPrivateContentConflict):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			err,
		)
	case errors.Is(err, infrastructure.ErrPrivateContentInvalidState):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			err,
		)
	case errors.Is(err, infrastructure.ErrPrivateContentInvalid):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			err,
		)
	case errors.Is(err, infrastructure.ErrPrivateContentNotFound):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentNotFound,
			operation,
			err,
		)
	case errors.Is(err, infrastructure.ErrPrivateContentStalePlan):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentStalePlan,
			operation,
			err,
		)
	case errors.Is(err, infrastructure.ErrPrivateContentExpiredPlan):
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentExpiredPlan,
			operation,
			err,
		)
	default:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
}

func mapPrivateDependencyError(operation string, err error) error {
	if err == nil || socialdomain.PrivateContentCodeOf(err) != "" {
		return err
	}
	switch keyexchangedomain.CodeOf(err) {
	case keyexchangedomain.ErrorCodeConflict:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentConflict,
			operation,
			err,
		)
	case keyexchangedomain.ErrorCodeStaleMaterial,
		keyexchangedomain.ErrorCodePlanExpired:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentStalePlan,
			operation,
			err,
		)
	case keyexchangedomain.ErrorCodeNotFound:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentNotFound,
			operation,
			err,
		)
	case keyexchangedomain.ErrorCodeInvalidArgument,
		keyexchangedomain.ErrorCodeInvalidMaterial:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			err,
		)
	default:
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
}

var _ PrivateContentStore = (infrastructure.PrivateContentStore)(nil)
