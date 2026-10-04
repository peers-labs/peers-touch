package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"sort"
	"strings"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const federatedPrivateResourceFrameLifetime = 24 * time.Hour

type PrivateContentFederationMembership interface {
	ValidateActiveStationPair(
		context.Context,
		string,
		string,
		string,
	) error
}

func (s *PrivateContentService) ConfigureFederatedPrivateDelivery(
	localStationPeerID string,
	membership PrivateContentFederationMembership,
	events *MomentEventPublisher,
) error {
	if s == nil ||
		strings.TrimSpace(localStationPeerID) == "" ||
		localStationPeerID != strings.TrimSpace(localStationPeerID) ||
		membership == nil ||
		events == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			"social.private_content.configure_federated_delivery",
			"dependencies",
			"local Station, Federation membership, and event publisher are required",
		)
	}
	interactionStore, ok := s.store.(infrastructure.FederatedPrivateInteractionStore)
	if !ok {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.configure_federated_delivery",
			"interaction_store",
			"private-content store does not support federated interactions",
		)
	}
	s.localStationPeerID = localStationPeerID
	s.federationMembership = membership
	s.interactionStore = interactionStore
	s.events = events
	return nil
}

func (s *PrivateContentService) bindGroupRecipientFederation(
	ctx context.Context,
	authorHomeStationPeerID string,
	group socialdomain.GroupRecipientSnapshot,
) (socialdomain.GroupRecipientSnapshot, error) {
	const operation = "social.private_content.group_recipient_federation"
	if strings.TrimSpace(authorHomeStationPeerID) == "" ||
		authorHomeStationPeerID != strings.TrimSpace(authorHomeStationPeerID) {
		return socialdomain.GroupRecipientSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"author_home_station_peer_id",
				"must be canonical",
			)
	}

	bound := group
	bound.Members = append(
		[]socialdomain.RecipientLocality(nil),
		group.Members...,
	)
	remoteStations := make(map[string]struct{})
	authorHomeBound := false
	for index := range bound.Members {
		member := &bound.Members[index]
		if member.ActorPTID == group.AuthorPTID {
			if member.HomeStationPeerID != authorHomeStationPeerID {
				return socialdomain.GroupRecipientSnapshot{},
					socialdomain.NewPrivateContentError(
						socialdomain.PrivateContentConflict,
						operation,
						"author_home_station_peer_id",
						"does not match the Conversation snapshot",
					)
			}
			authorHomeBound = true
		}
		if member.HomeStationPeerID == authorHomeStationPeerID {
			member.FederationID = ""
			continue
		}
		member.FederationID = group.FederationID
		remoteStations[member.HomeStationPeerID] = struct{}{}
	}
	if !authorHomeBound {
		return socialdomain.GroupRecipientSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				"author_ptid",
				"is not bound to the authenticated Home Station",
			)
	}
	if len(remoteStations) == 0 {
		return bound, nil
	}
	if s.localStationPeerID == "" ||
		s.localStationPeerID != authorHomeStationPeerID ||
		s.federationMembership == nil {
		return socialdomain.GroupRecipientSnapshot{},
			socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrationGap,
				operation,
				"federation",
				"source Federation membership validation is unavailable",
			)
	}
	stations := make([]string, 0, len(remoteStations))
	for stationPeerID := range remoteStations {
		stations = append(stations, stationPeerID)
	}
	sort.Strings(stations)
	for _, stationPeerID := range stations {
		if err := s.federationMembership.ValidateActiveStationPair(
			ctx,
			group.FederationID,
			authorHomeStationPeerID,
			stationPeerID,
		); err != nil {
			if !errors.Is(err, federationdomain.ErrInactiveStationPair) {
				return socialdomain.GroupRecipientSnapshot{},
					socialdomain.WrapPrivateContentError(
						socialdomain.PrivateContentDependency,
						operation,
						err,
					)
			}
			return socialdomain.GroupRecipientSnapshot{},
				socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentUnsupported,
					operation,
					err,
				)
		}
	}

	return bound, nil
}

func (s *PrivateContentService) enqueueFederatedPrivatePost(
	ctx context.Context,
	tx infrastructure.PrivateContentTransaction,
	plan dbmodel.SocialPrivateContentPlan,
	snapshot socialdomain.FriendsSnapshot,
	request *privatecontentpb.SubmitPrivateMomentRequest,
	material socialdomain.PrivateSubmitMaterial,
	proof *securecontentpb.ViewerContentCommitProof,
	committedAt time.Time,
	postType actormodel.PostType,
) error {
	remote := make([]socialdomain.RecipientLocality, 0, 1)
	for _, locality := range snapshot.RecipientLocalities {
		if locality.HomeStationPeerID != plan.AuthorHomeStationPeerID {
			remote = append(remote, locality)
		}
	}
	if len(remote) == 0 {
		return nil
	}
	if s.localStationPeerID == "" ||
		s.localStationPeerID != plan.AuthorHomeStationPeerID ||
		!isFederatedPrivateAudienceKind(snapshot.Audience.GetKind()) ||
		!isFederatedPrivatePostType(postType) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			"social.private_content.enqueue_federated_post",
			"recipient_localities",
			"federated delivery requires a supported private Post audience",
		)
	}
	federationID := remote[0].FederationID
	if federationID == "" {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			"social.private_content.enqueue_federated_post",
			"recipient_federation_id",
			"is missing from a remote recipient",
		)
	}
	for _, target := range remote[1:] {
		if target.FederationID != federationID {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnsupported,
				"social.private_content.enqueue_federated_post",
				"recipient_federation_id",
				"remote recipients span multiple Federations",
			)
		}
	}
	attestation, err :=
		s.stationSigner.AttestContentProofVerificationKeyInTransaction(
			ctx,
			tx.ContentPreKeyValidationTransaction(),
			proof.GetStationSigningKeyId(),
			committedAt,
		)
	if err != nil {
		return mapPrivateDependencyError(
			"social.private_content.enqueue_federated_post",
			err,
		)
	}
	frames := make([]*federationdelivery.Frame, 0, len(remote))
	for _, target := range remote {
		envelopes, targetActor, envelopeErr := federatedViewerEnvelopes(
			plan,
			material.Envelopes,
			target.ActorPTID,
		)
		if envelopeErr != nil {
			return envelopeErr
		}
		verification := &privatecontentpb.PrivateContentVerification{
			CommitProof: proto.Clone(
				proof,
			).(*securecontentpb.ViewerContentCommitProof),
			StationSigningKeyAttestation: proto.Clone(
				attestation,
			).(*securecontentpb.StationContentSigningKeyAttestation),
		}
		if request.GetMentionRouting() != nil {
			verification.MentionRouting = proto.Clone(
				request.GetMentionRouting(),
			).(*privatecontentpb.SignedMentionRouting)
		}
		deliveryID := deterministicPrivateID(
			"federated-resource",
			request.GetPlan().GetResource().GetContentId(),
			target.ActorPTID,
		)
		payload := &privatecontentpb.FederatedPrivateResourceDelivery{
			FormatVersion:       socialdomain.PrivateContentFormatVersion,
			FederationId:        target.FederationID,
			DeliveryId:          deliveryID,
			SourceStationPeerId: plan.AuthorHomeStationPeerID,
			TargetStationPeerId: target.HomeStationPeerID,
			TargetActor:         targetActor,
			ResourceKind: privatecontentpb.
				FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST,
			Resource: proto.Clone(
				request.GetPlan().GetResource(),
			).(*securecontentpb.SecureResourceRef),
			LifecycleRevision: plan.Generation,
			Metadata: &privatecontentpb.FederatedPrivateResourceDelivery_Post{
				Post: &privatecontentpb.PostMetadata{
					PostId:    plan.ContentID,
					ContentId: plan.ContentID,
					Author: proto.Clone(
						request.GetPlan().GetAuthor().GetActor(),
					).(*actormodel.ActorRef),
					Type:         postType,
					AudienceKind: snapshot.Audience.GetKind(),
					CreatedAt:    timestamppb.New(committedAt),
					UpdatedAt:    timestamppb.New(committedAt),
					Stats:        &actormodel.PostStats{},
				},
			},
			Payload: proto.Clone(
				request.GetPayload(),
			).(*securecontentpb.EncryptedPayload),
			TargetActorEnvelopes: envelopes,
			Objects:              federatedPrivateObjectDescriptors(material.Objects),
			Verification:         verification,
			AudienceExplanation: &actormodel.AudienceExplanation{
				Kind:           snapshot.Audience.GetKind(),
				ViewerIsMember: true,
			},
			CommittedAt: timestamppb.New(committedAt),
		}
		payloadBytes, encodeErr := socialdomain.CanonicalProtoBytes(payload)
		if encodeErr != nil {
			return encodeErr
		}
		frame, signErr := s.signFederatedPrivateResourceFrame(
			ctx,
			tx.ContentPreKeyValidationTransaction(),
			payload,
			payloadBytes,
			committedAt,
		)
		if signErr != nil {
			return signErr
		}
		frames = append(frames, frame)
	}

	observations := make([]struct {
		elapsed   time.Duration
		duplicate bool
	}, 0, len(frames))
	for _, frame := range frames {
		startedAt := time.Now()
		result, enqueueErr := tx.EnqueueFederationFrame(
			ctx,
			frame,
			committedAt,
		)
		if enqueueErr != nil {
			s.observeFederatedPrivateDelivery(
				startedAt,
				"source_enqueue",
				"rejected",
				"outbox",
			)
			return mapPrivateStoreError(
				"social.private_content.enqueue_federated_post",
				enqueueErr,
			)
		}
		observations = append(observations, struct {
			elapsed   time.Duration
			duplicate bool
		}{
			elapsed:   time.Since(startedAt),
			duplicate: result.Duplicate,
		})
	}
	for _, observation := range observations {
		outcome := "accepted"
		reason := "none"
		if observation.duplicate {
			outcome = "replay"
			reason = "exact"
			s.metrics.replayTotal.Inc("private_resource", outcome, reason)
		}
		s.metrics.deliveryTotal.Inc("source_enqueue", outcome, reason)
		s.metrics.deliveryLatency.Observe(
			observation.elapsed.Seconds(),
			"source_enqueue",
			outcome,
		)
	}
	return nil
}

func (s *PrivateContentService) enqueueFederatedPrivateComment(
	ctx context.Context,
	tx infrastructure.PrivateContentTransaction,
	plan dbmodel.SocialPrivateContentPlan,
	prepared socialdomain.PrivatePrepareMaterial,
	snapshot socialdomain.FriendsSnapshot,
	request *privatecontentpb.SubmitPrivateCommentRequest,
	material socialdomain.PrivateSubmitMaterial,
	proof *securecontentpb.ViewerContentCommitProof,
	receiverVerifiedSenderKey *actormodel.VerifiedActorDeviceSigningKey,
	committedAt time.Time,
) error {
	remote := make([]socialdomain.RecipientLocality, 0)
	for _, locality := range snapshot.RecipientLocalities {
		if locality.HomeStationPeerID != s.localStationPeerID {
			remote = append(remote, locality)
		}
	}
	if len(remote) == 0 {
		return nil
	}
	if s.localStationPeerID == "" {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			"social.private_content.enqueue_federated_comment",
			"local_station_peer_id",
			"is unavailable",
		)
	}
	attestation, err :=
		s.stationSigner.AttestContentProofVerificationKeyInTransaction(
			ctx,
			tx.ContentPreKeyValidationTransaction(),
			proof.GetStationSigningKeyId(),
			committedAt,
		)
	if err != nil {
		return mapPrivateDependencyError(
			"social.private_content.enqueue_federated_comment",
			err,
		)
	}
	for _, target := range remote {
		if target.FederationID == "" {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentConflict,
				"social.private_content.enqueue_federated_comment",
				"recipient_federation_id",
				"is missing from a remote recipient",
			)
		}
		envelopes, targetActor, err := federatedViewerEnvelopes(
			plan,
			material.Envelopes,
			target.ActorPTID,
		)
		if err != nil {
			return err
		}
		verification := &privatecontentpb.PrivateContentVerification{
			CommitProof: proto.Clone(
				proof,
			).(*securecontentpb.ViewerContentCommitProof),
			StationSigningKeyAttestation: proto.Clone(
				attestation,
			).(*securecontentpb.StationContentSigningKeyAttestation),
		}
		if receiverVerifiedSenderKey != nil {
			verification.ReceiverVerifiedSenderSigningKey = proto.Clone(
				receiverVerifiedSenderKey,
			).(*actormodel.VerifiedActorDeviceSigningKey)
		}
		if request.GetMentionRouting() != nil {
			verification.MentionRouting = proto.Clone(
				request.GetMentionRouting(),
			).(*privatecontentpb.SignedMentionRouting)
		}
		deliveryID := deterministicPrivateID(
			"federated-resource",
			plan.ContentID,
			target.ActorPTID,
		)
		payload := &privatecontentpb.FederatedPrivateResourceDelivery{
			FormatVersion:       socialdomain.PrivateContentFormatVersion,
			FederationId:        target.FederationID,
			DeliveryId:          deliveryID,
			SourceStationPeerId: s.localStationPeerID,
			TargetStationPeerId: target.HomeStationPeerID,
			TargetActor:         targetActor,
			ResourceKind: privatecontentpb.
				FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT,
			Resource: proto.Clone(
				request.GetPlan().GetResource(),
			).(*securecontentpb.SecureResourceRef),
			LifecycleRevision: plan.Generation,
			Metadata: &privatecontentpb.FederatedPrivateResourceDelivery_Comment{
				Comment: &privatecontentpb.CommentMetadata{
					CommentId:        plan.ContentID,
					ContentId:        plan.ContentID,
					PostId:           request.GetPostId(),
					ReplyToCommentId: prepared.ReplyToCommentID,
					Author: proto.Clone(
						request.GetPlan().GetAuthor().GetActor(),
					).(*actormodel.ActorRef),
					CreatedAt: timestamppb.New(committedAt),
					UpdatedAt: timestamppb.New(committedAt),
				},
			},
			Payload: proto.Clone(
				request.GetPayload(),
			).(*securecontentpb.EncryptedPayload),
			TargetActorEnvelopes: envelopes,
			Objects:              federatedPrivateObjectDescriptors(material.Objects),
			Verification:         verification,
			AudienceExplanation: &actormodel.AudienceExplanation{
				Kind:           snapshot.Audience.GetKind(),
				ViewerIsMember: true,
			},
			CommittedAt: timestamppb.New(committedAt),
		}
		payloadBytes, err := socialdomain.CanonicalProtoBytes(payload)
		if err != nil {
			return err
		}
		frame, err := s.signFederatedPrivateResourceFrame(
			ctx,
			tx.ContentPreKeyValidationTransaction(),
			payload,
			payloadBytes,
			committedAt,
		)
		if err != nil {
			return err
		}
		if _, err := tx.EnqueueFederationFrame(ctx, frame, committedAt); err != nil {
			return mapPrivateStoreError(
				"social.private_content.enqueue_federated_comment",
				err,
			)
		}
	}
	return nil
}

func isFederatedPrivatePostType(kind actormodel.PostType) bool {
	switch kind {
	case actormodel.PostType_TEXT,
		actormodel.PostType_IMAGE,
		actormodel.PostType_VIDEO:
		return true
	default:
		return false
	}
}

func federatedPrivateObjectDescriptors(
	objects []socialdomain.PrivateObjectMaterial,
) []*securecontentpb.EncryptedObjectDescriptor {
	descriptors := make(
		[]*securecontentpb.EncryptedObjectDescriptor,
		0,
		len(objects),
	)
	for _, object := range objects {
		descriptors = append(
			descriptors,
			proto.Clone(object.Descriptor).(*securecontentpb.EncryptedObjectDescriptor),
		)
	}

	return descriptors
}

func isFederatedPrivateAudienceKind(kind actormodel.Audience_Kind) bool {
	switch kind {
	case actormodel.Audience_FRIENDS,
		actormodel.Audience_FOLLOWERS,
		actormodel.Audience_CIRCLE,
		actormodel.Audience_GROUP,
		actormodel.Audience_CUSTOM_ALLOW,
		actormodel.Audience_CUSTOM_DENY:
		return true
	default:
		return false
	}
}

func (s *PrivateContentService) signFederatedPrivateResourceFrame(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
	payload []byte,
	now time.Time,
) (*federationdelivery.Frame, error) {
	identity := deterministicPrivateID(
		"frame",
		message.GetSourceStationPeerId(),
		message.GetTargetStationPeerId(),
		message.GetDeliveryId(),
	)
	keyID, err := s.stationSigner.SigningKeyIDInTransaction(ctx, transaction)
	if err != nil {
		return nil, mapPrivateDependencyError(
			"social.private_content.sign_federated_frame",
			err,
		)
	}
	frame := &federationdelivery.Frame{
		FormatVersion:       federationdelivery.CurrentFormatVersion,
		FrameId:             "social-private-frame:" + identity,
		SourceStationPeerId: message.GetSourceStationPeerId(),
		TargetStationPeerId: message.GetTargetStationPeerId(),
		IdempotencyKey:      "social-private-idempotency:" + identity,
		PayloadKind:         federationdelivery.PayloadKindSocialPrivateResource,
		PayloadId:           message.GetDeliveryId(),
		OrderingKey: "social-private-resource:" +
			message.GetResource().GetContentId() + ":" +
			message.GetTargetActor().GetPtid(),
		OrderingSequence: int64(message.GetLifecycleRevision()),
		OpaquePayload:    append([]byte(nil), payload...),
		PayloadSha256:    federationdelivery.PayloadSHA256(payload),
		IssuedAt:         timestamppb.New(now.UTC()),
		ExpiresAt: timestamppb.New(
			now.Add(federatedPrivateResourceFrameLifetime).UTC(),
		),
		SigningKeyId: keyID,
	}
	signingBytes, err := federationdelivery.SigningBytes(frame)
	if err != nil {
		return nil, err
	}
	signature, err := s.stationSigner.SignInTransaction(
		ctx,
		transaction,
		keyID,
		signingBytes,
	)
	if err != nil {
		return nil, mapPrivateDependencyError(
			"social.private_content.sign_federated_frame",
			err,
		)
	}
	frame.StationSignature = signature
	if err := federationdelivery.ValidateFrame(
		frame,
		federationdelivery.DefaultFramePolicy(
			message.GetTargetStationPeerId(),
		),
		now,
	); err != nil {
		return nil, err
	}
	return frame, nil
}

func federatedViewerEnvelopes(
	plan dbmodel.SocialPrivateContentPlan,
	materials []socialdomain.PrivateEnvelopeMaterial,
	targetActorPTID string,
) (
	[]*securecontentpb.ViewerContentKeyEnvelope,
	*actormodel.ActorRef,
	error,
) {
	_, claims, err := decodePersistedClaim(plan)
	if err != nil {
		return nil, nil, err
	}
	claimsBySlot := make(map[string]*securecontentpb.ClaimedContentPreKey)
	for _, claim := range claims.GetClaims() {
		slotID := deterministicPrivateID("slot", plan.PlanID, claim.GetClaimId())
		claimsBySlot[slotID] = claim
	}
	envelopes := make([]*securecontentpb.ViewerContentKeyEnvelope, 0, 2)
	var targetActor *actormodel.ActorRef
	for _, material := range materials {
		prepared := material.Envelope
		claim := claimsBySlot[prepared.GetBinding().GetRecipientSlotId()]
		if claim == nil {
			continue
		}
		target := claim.GetTarget()
		var (
			actor     *actormodel.ActorRef
			recipient isFederatedEnvelopeRecipient
		)
		switch target.GetKind() {
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
			actor = target.GetEndpoint().GetActor()
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
			actor = target.GetRecoveryActor()
		default:
			continue
		}
		if actor.GetPtid() != targetActorPTID {
			continue
		}
		if targetActor == nil {
			targetActor = &actormodel.ActorRef{
				Ptid: targetActorPTID,
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			}
		}
		switch target.GetKind() {
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT:
			recipient = federatedEndpointRecipient{
				endpoint: &actormodel.ActorDeviceRef{
					Actor:    proto.Clone(targetActor).(*actormodel.ActorRef),
					DeviceId: target.GetEndpoint().GetDeviceId(),
				},
			}
		case securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY:
			recipient = federatedRecoveryRecipient{
				actor: proto.Clone(targetActor).(*actormodel.ActorRef),
			}
		}
		envelopes = append(envelopes, recipient.viewerEnvelope(prepared, claim))
	}
	if targetActor == nil || len(envelopes) == 0 {
		return nil, nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentConflict,
			"social.private_content.build_federated_envelopes",
			"target_actor_envelopes",
			"do not cover the remote actor",
		)
	}
	return envelopes, targetActor, nil
}

type isFederatedEnvelopeRecipient interface {
	viewerEnvelope(
		*securecontentpb.PreparedContentKeyEnvelope,
		*securecontentpb.ClaimedContentPreKey,
	) *securecontentpb.ViewerContentKeyEnvelope
}

type federatedEndpointRecipient struct {
	endpoint *actormodel.ActorDeviceRef
}

func (r federatedEndpointRecipient) viewerEnvelope(
	prepared *securecontentpb.PreparedContentKeyEnvelope,
	claim *securecontentpb.ClaimedContentPreKey,
) *securecontentpb.ViewerContentKeyEnvelope {
	envelope := federatedViewerEnvelopeBase(prepared, claim)
	envelope.Recipient = &securecontentpb.ViewerContentKeyEnvelope_Endpoint{
		Endpoint: proto.Clone(r.endpoint).(*actormodel.ActorDeviceRef),
	}
	return envelope
}

type federatedRecoveryRecipient struct {
	actor *actormodel.ActorRef
}

func (r federatedRecoveryRecipient) viewerEnvelope(
	prepared *securecontentpb.PreparedContentKeyEnvelope,
	claim *securecontentpb.ClaimedContentPreKey,
) *securecontentpb.ViewerContentKeyEnvelope {
	envelope := federatedViewerEnvelopeBase(prepared, claim)
	envelope.Recipient = &securecontentpb.ViewerContentKeyEnvelope_RecoveryActor{
		RecoveryActor: proto.Clone(r.actor).(*actormodel.ActorRef),
	}
	return envelope
}

func federatedViewerEnvelopeBase(
	prepared *securecontentpb.PreparedContentKeyEnvelope,
	claim *securecontentpb.ClaimedContentPreKey,
) *securecontentpb.ViewerContentKeyEnvelope {
	return &securecontentpb.ViewerContentKeyEnvelope{
		Binding: proto.Clone(
			prepared.GetBinding(),
		).(*securecontentpb.ContentKeyEnvelopeBinding),
		BindingSha256:       append([]byte(nil), prepared.GetBindingSha256()...),
		HpkeEncapsulatedKey: append([]byte(nil), prepared.GetHpkeEncapsulatedKey()...),
		HpkeCiphertext:      append([]byte(nil), prepared.GetHpkeCiphertext()...),
		SenderSignature:     append([]byte(nil), prepared.GetSenderSignature()...),
		PrincipalEpoch:      claim.GetPrekey().GetProfileOrRecoveryEpoch(),
	}
}

func (s *PrivateContentService) ReceiveFederatedPrivateResource(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
	frame *federationdelivery.Frame,
) (federationdelivery.Result, error) {
	startedAt := time.Now()
	if err := s.validateFederatedPrivateResource(
		ctx,
		transaction,
		message,
		frame,
	); err != nil {
		s.observeFederatedPrivateDelivery(startedAt, "receiver", "rejected", "domain")
		return deliveryResultForPrivateContentError(err), nil
	}
	canonical, err := socialdomain.CanonicalProtoBytes(message)
	if err != nil {
		return federationdelivery.Result{}, err
	}
	duplicate, err := s.store.InspectRemotePrivateResource(
		ctx,
		transaction,
		message,
		canonical,
	)
	if err != nil {
		if errors.Is(err, infrastructure.ErrPrivateContentConflict) {
			s.observeFederatedPrivateDelivery(
				startedAt,
				"receiver",
				"conflict",
				"identity",
			)
			return federationdelivery.PayloadHashConflictResult(), nil
		}
		return federationdelivery.Result{}, err
	}
	if duplicate {
		s.metrics.replayTotal.Inc("private_resource", "replay", "exact")
		s.observeFederatedPrivateDelivery(startedAt, "receiver", "replay", "exact")
		return federationdelivery.DuplicateResult(), nil
	}
	projected := proto.Clone(
		message,
	).(*privatecontentpb.FederatedPrivateResourceDelivery)
	sourceAttestation := projected.GetVerification().
		GetStationSigningKeyAttestation()
	if err := s.stationSigner.TrustImportedContentProofVerificationKeyInTransaction(
		ctx,
		transaction,
		projected.GetSourceStationPeerId(),
		sourceAttestation.GetProofSigningKeyId(),
		sourceAttestation.GetProofEd25519PublicKey(),
		s.now(),
	); err != nil {
		if errors.Is(err, authfed.ErrContentProofKeyConflict) {
			s.observeFederatedPrivateDelivery(
				startedAt,
				"receiver",
				"conflict",
				"proof_key",
			)
			return federationdelivery.TerminalResult(
				federationdelivery.FrameErrorDomainRejected,
			), nil
		}
		return federationdelivery.Result{}, mapPrivateDependencyError(
			"social.private_content.receive_federated_resource",
			err,
		)
	}
	localAttestation, err :=
		s.stationSigner.AttestImportedContentProofVerificationKeyInTransaction(
			ctx,
			transaction,
			projected.GetSourceStationPeerId(),
			projected.GetVerification().GetCommitProof().
				GetStationSigningKeyId(),
			s.now(),
		)
	if err != nil {
		return federationdelivery.Result{}, mapPrivateDependencyError(
			"social.private_content.receive_federated_resource",
			err,
		)
	}
	projected.Verification.StationSigningKeyAttestation = localAttestation
	duplicate, err = s.store.ApplyRemotePrivateResource(
		ctx,
		transaction,
		projected,
		canonical,
	)
	if err != nil {
		// A conflict that appears after the read-only identity preflight is a
		// concurrent race. Returning an error rolls back the newly imported
		// proof key and resource mutation; the retry will classify the stable
		// winner before any write.
		return federationdelivery.Result{}, err
	}
	if duplicate {
		s.metrics.replayTotal.Inc("private_resource", "replay", "exact")
		s.observeFederatedPrivateDelivery(startedAt, "receiver", "replay", "exact")
		return federationdelivery.DuplicateResult(), nil
	}
	targetPTID := projected.GetTargetActor().GetPtid()
	switch projected.GetResourceKind() {
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST:
		post := projected.GetPost()
		if err := s.events.StageImportedCreated(
			ctx,
			transaction,
			post.GetPostId(),
			post.GetAuthor().GetPtid(),
			targetPTID,
			post.GetAudienceKind(),
			projected.GetLifecycleRevision(),
		); err != nil {
			return federationdelivery.Result{}, err
		}
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT:
		comment := projected.GetComment()
		if err := s.events.StageImportedCommented(
			ctx,
			transaction,
			comment.GetPostId(),
			comment.GetCommentId(),
			comment.GetAuthor().GetPtid(),
			targetPTID,
		); err != nil {
			return federationdelivery.Result{}, err
		}
	}
	s.observeFederatedPrivateDelivery(startedAt, "receiver", "accepted", "none")
	return federationdelivery.AcceptedResult(), nil
}

func (s *PrivateContentService) observeFederatedPrivateDelivery(
	startedAt time.Time,
	operation string,
	outcome string,
	reason string,
) {
	s.metrics.deliveryTotal.Inc(operation, outcome, reason)
	s.metrics.deliveryLatency.Observe(
		time.Since(startedAt).Seconds(),
		operation,
		outcome,
	)
}

func deliveryResultForPrivateContentError(
	err error,
) federationdelivery.Result {
	switch socialdomain.PrivateContentCodeOf(err) {
	case socialdomain.PrivateContentConflict:
		return federationdelivery.PayloadHashConflictResult()
	case socialdomain.PrivateContentDependency,
		socialdomain.PrivateContentInternal:
		return federationdelivery.RetryableResult(
			federationdelivery.FrameErrorOverloaded,
		)
	default:
		return federationdelivery.TerminalResult(
			federationdelivery.FrameErrorDomainRejected,
		)
	}
}

func (s *PrivateContentService) validateFederatedPrivateResource(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	message *privatecontentpb.FederatedPrivateResourceDelivery,
	frame *federationdelivery.Frame,
) error {
	const operation = "social.private_content.validate_federated_resource"
	if s.localStationPeerID == "" ||
		s.federationMembership == nil ||
		s.events == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrationGap,
			operation,
			"dependencies",
			"federated private delivery is not configured",
		)
	}
	if transaction == nil || transaction.DB() == nil ||
		message == nil || frame == nil ||
		message.GetFormatVersion() != socialdomain.PrivateContentFormatVersion ||
		len(message.ProtoReflect().GetUnknown()) != 0 {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"delivery",
			"is invalid",
		)
	}
	canonical, err := socialdomain.CanonicalProtoBytes(message)
	if err != nil {
		return err
	}
	if frame.GetPayloadKind() != federationdelivery.PayloadKindSocialPrivateResource ||
		frame.GetPayloadId() != message.GetDeliveryId() ||
		frame.GetSourceStationPeerId() != message.GetSourceStationPeerId() ||
		frame.GetTargetStationPeerId() != message.GetTargetStationPeerId() ||
		!bytes.Equal(frame.GetOpaquePayload(), canonical) ||
		!bytes.Equal(frame.GetPayloadSha256(), federationdelivery.PayloadSHA256(canonical)) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"frame",
			"does not bind the canonical private resource delivery",
		)
	}
	for name, value := range map[string]string{
		"federation_id":          message.GetFederationId(),
		"delivery_id":            message.GetDeliveryId(),
		"source_station_peer_id": message.GetSourceStationPeerId(),
		"target_station_peer_id": message.GetTargetStationPeerId(),
	} {
		if value == "" || value != strings.TrimSpace(value) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				name,
				"must be canonical",
			)
		}
	}
	if message.GetTargetStationPeerId() != s.localStationPeerID {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			operation,
			"target_station_peer_id",
			"does not match the receiving Station",
		)
	}
	if err := s.federationMembership.ValidateActiveStationPair(
		ctx,
		message.GetFederationId(),
		message.GetSourceStationPeerId(),
		message.GetTargetStationPeerId(),
	); err != nil {
		if !errors.Is(err, federationdomain.ErrInactiveStationPair) {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentDependency,
				operation,
				err,
			)
		}
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			operation,
			err,
		)
	}
	resource := message.GetResource()
	post := message.GetPost()
	comment := message.GetComment()
	target := message.GetTargetActor()
	verification := message.GetVerification()
	proof := verification.GetCommitProof()
	sourceAttestation := verification.GetStationSigningKeyAttestation()
	if resource == nil ||
		resource.GetOwnerDomain() != securecontentpb.
			SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		resource.GetGeneration() == 0 ||
		message.GetLifecycleRevision() == 0 ||
		message.GetDeliveryId() != deterministicPrivateID(
			"federated-resource",
			resource.GetContentId(),
			target.GetPtid(),
		) ||
		target == nil ||
		target.GetPtid() == "" ||
		target.GetKind() != actormodel.ActorKind_ACTOR_KIND_PERSON ||
		message.GetPayload() == nil ||
		!proto.Equal(message.GetPayload().GetResource(), resource) ||
		proof == nil ||
		sourceAttestation == nil ||
		message.GetCommittedAt() == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"resource",
			"is not a complete supported viewer-scoped resource",
		)
	}
	var (
		resourceAuthor *actormodel.ActorRef
		audienceKind   actormodel.Audience_Kind
	)
	switch message.GetResourceKind() {
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST:
		mediaObjectCountValid :=
			(post.GetType() == actormodel.PostType_TEXT &&
				len(message.GetObjects()) == 0) ||
				((post.GetType() == actormodel.PostType_IMAGE ||
					post.GetType() == actormodel.PostType_VIDEO) &&
					len(message.GetObjects()) > 0)
		if post == nil ||
			post.GetPostId() != resource.GetContentId() ||
			post.GetContentId() != resource.GetContentId() ||
			!isFederatedPrivatePostType(post.GetType()) ||
			!mediaObjectCountValid ||
			!isFederatedPrivateAudienceKind(post.GetAudienceKind()) ||
			post.GetAuthor() == nil ||
			post.GetAuthor().GetPtid() == "" ||
			verification.GetReceiverVerifiedSenderSigningKey() != nil {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"resource",
				"is not a complete supported viewer-scoped Post",
			)
		}
		resourceAuthor = post.GetAuthor()
		audienceKind = post.GetAudienceKind()
	case privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT:
		if comment == nil ||
			comment.GetCommentId() != resource.GetContentId() ||
			comment.GetContentId() != resource.GetContentId() ||
			comment.GetPostId() == "" ||
			comment.GetAuthor() == nil ||
			comment.GetAuthor().GetPtid() == "" ||
			len(message.GetObjects()) != 0 {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"resource",
				"is not a complete supported viewer-scoped Comment",
			)
		}
		if err := s.interactionStore.ValidateRemotePrivateCommentParent(
			ctx,
			transaction,
			message,
		); err != nil {
			if errors.Is(err, infrastructure.ErrPrivateContentNotFound) {
				return socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentDependency,
					operation,
					err,
				)
			}
			return mapPrivateStoreError(operation, err)
		}
		resourceAuthor = comment.GetAuthor()
		audienceKind = message.GetAudienceExplanation().GetKind()
	default:
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnsupported,
			operation,
			"resource_kind",
			"is unsupported",
		)
	}
	if audienceKind == actormodel.Audience_FRIENDS {
		friendSnapshot, friendErr := s.audiences.ResolveFriendsPostSnapshot(
			ctx,
			transaction,
			resourceAuthor.GetPtid(),
		)
		if friendErr != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				friendErr,
			)
		}
		friendAuthorized := false
		for _, recipientPTID := range friendSnapshot.RecipientPTIDs {
			if recipientPTID == target.GetPtid() {
				friendAuthorized = true
				break
			}
		}
		if friendSnapshot.Audience.GetKind() != actormodel.Audience_FRIENDS ||
			!friendAuthorized {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentUnauthorized,
				operation,
				"friendship",
				"has not converged on the receiving Station",
			)
		}
	}
	if err := message.GetCommittedAt().CheckValid(); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			err,
		)
	}
	if err := securecontentkernel.ValidateEncryptedPayload(
		message.GetPayload(),
		s.policy,
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	objectIDs := make([]string, 0, len(message.GetObjects()))
	for _, descriptor := range message.GetObjects() {
		objectIDs = append(objectIDs, descriptor.GetObjectId())
	}
	_, objectSetHash, err := socialdomain.CanonicalizePrivateObjects(
		operation,
		&securecontentpb.ContentEncryptionPlan{
			Resource:  resource,
			ObjectIds: objectIDs,
		},
		message.GetObjects(),
		s.policy,
	)
	if err != nil {
		return err
	}
	payloadBytes, err := socialdomain.CanonicalProtoBytes(message.GetPayload())
	if err != nil {
		return err
	}
	if proof.GetDomainCommitId() != resource.GetContentId() ||
		!proto.Equal(proof.GetResource(), resource) ||
		proof.GetAuthor().GetActor().GetPtid() != resourceAuthor.GetPtid() ||
		!bytes.Equal(
			proof.GetEncryptedPayloadSha256(),
			privateSHA256(payloadBytes),
		) ||
		!bytes.Equal(proof.GetObjectDescriptorSetSha256(), objectSetHash[:]) ||
		sourceAttestation.GetStationPeerId() != message.GetSourceStationPeerId() ||
		sourceAttestation.GetProofSigningKeyId() != proof.GetStationSigningKeyId() ||
		sourceAttestation.GetAttestingSigningKeyId() != frame.GetSigningKeyId() ||
		len(sourceAttestation.GetProofEd25519PublicKey()) != ed25519.PublicKeySize ||
		len(sourceAttestation.GetStationSignature()) != ed25519.SignatureSize {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"verification",
			"does not bind the source proof",
		)
	}
	if _, err := authfed.CanonicalContentProofKeyAttestationBytes(
		sourceAttestation,
	); err != nil {
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	proofSigningBytes, err :=
		socialdomain.CanonicalCommitProofSigningBytes(proof)
	if err != nil {
		return err
	}
	if !ed25519.Verify(
		ed25519.PublicKey(sourceAttestation.GetProofEd25519PublicKey()),
		proofSigningBytes,
		proof.GetStationSignature(),
	) {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"commit_proof",
			"signature is invalid",
		)
	}
	explanation := message.GetAudienceExplanation()
	if explanation == nil ||
		explanation.GetKind() != audienceKind ||
		explanation.GetViewerIsAuthor() ||
		!explanation.GetViewerIsMember() {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"audience_explanation",
			"is not viewer scoped",
		)
	}
	endpointCount := 0
	recoveryCount := 0
	endpointIdentities := make(map[string]struct{})
	recipientSlotIDs := make(map[string]struct{})
	recipientKeyIDs := make(map[string]struct{})
	for _, envelope := range message.GetTargetActorEnvelopes() {
		if err := securecontentkernel.ValidateViewerContentKeyEnvelope(
			envelope,
			s.policy,
		); err != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		binding := envelope.GetBinding()
		if _, duplicate := recipientSlotIDs[binding.GetRecipientSlotId()]; duplicate {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentConflict,
				operation,
				"target_actor_envelopes",
				"contains a duplicate recipient slot",
			)
		}
		recipientSlotIDs[binding.GetRecipientSlotId()] = struct{}{}
		if _, duplicate := recipientKeyIDs[binding.GetRecipientKeyId()]; duplicate {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentConflict,
				operation,
				"target_actor_envelopes",
				"contains a duplicate recipient PreKey",
			)
		}
		recipientKeyIDs[binding.GetRecipientKeyId()] = struct{}{}
		if !proto.Equal(envelope.GetBinding().GetResource(), resource) ||
			!proto.Equal(envelope.GetBinding().GetSender(), proof.GetAuthor()) ||
			!bytes.Equal(
				envelope.GetBinding().GetPayloadCiphertextSha256(),
				message.GetPayload().GetCiphertextSha256(),
			) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"target_actor_envelopes",
				"do not bind the delivered payload",
			)
		}
		envelopeSigningBytes, err :=
			securecontentkernel.CanonicalEnvelopeBindingBytes(
				envelope.GetBinding(),
			)
		if err != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
		var signatureErr error
		if message.GetResourceKind() == privatecontentpb.
			FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT &&
			verification.GetReceiverVerifiedSenderSigningKey() != nil {
			signatureErr = verifyFederatedPrivateReceiverVerifiedSender(
				verification.GetReceiverVerifiedSenderSigningKey(),
				envelope.GetBinding().GetSender(),
				envelope.GetBinding().GetSenderSigningKeyId(),
				envelopeSigningBytes,
				envelope.GetSenderSignature(),
				message.GetCommittedAt().AsTime(),
			)
		} else {
			signatureErr = s.signatureVerifier.Verify(
				ctx,
				transaction,
				envelope.GetBinding().GetSender(),
				message.GetSourceStationPeerId(),
				envelope.GetBinding().GetSenderSigningKeyId(),
				envelopeSigningBytes,
				envelope.GetSenderSignature(),
				message.GetCommittedAt().AsTime(),
			)
		}
		if signatureErr != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				signatureErr,
			)
		}
		switch recipient := envelope.GetRecipient().(type) {
		case *securecontentpb.ViewerContentKeyEnvelope_Endpoint:
			if recipient.Endpoint.GetActor().GetPtid() != target.GetPtid() {
				return socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentUnauthorized,
					operation,
					"target_actor_envelopes",
					"contains another actor",
				)
			}
			endpointIdentity := recipient.Endpoint.GetActor().GetPtid() +
				"\x00" + recipient.Endpoint.GetDeviceId()
			if _, duplicate := endpointIdentities[endpointIdentity]; duplicate {
				return socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentConflict,
					operation,
					"target_actor_envelopes",
					"contains a duplicate endpoint",
				)
			}
			endpointIdentities[endpointIdentity] = struct{}{}
			if err := s.recipients.ValidateActiveEndpoint(
				ctx,
				recipient.Endpoint,
			); err != nil {
				return socialdomain.WrapPrivateContentError(
					socialdomain.PrivateContentUnauthorized,
					operation,
					err,
				)
			}
			endpointCount++
		case *securecontentpb.ViewerContentKeyEnvelope_RecoveryActor:
			if recipient.RecoveryActor.GetPtid() != target.GetPtid() {
				return socialdomain.NewPrivateContentError(
					socialdomain.PrivateContentUnauthorized,
					operation,
					"target_actor_envelopes",
					"contains another actor",
				)
			}
			recoveryCount++
		default:
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentInvalidArgument,
				operation,
				"target_actor_envelopes",
				"contains an unsupported recipient",
			)
		}
	}
	if endpointCount == 0 || recoveryCount != 1 {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"target_actor_envelopes",
			"must contain active endpoint and one recovery envelope",
		)
	}
	if routing := verification.GetMentionRouting(); routing != nil {
		if !proto.Equal(routing.GetSender(), proof.GetAuthor()) {
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				"mention_routing",
				"sender does not match the source proof",
			)
		}
		var signatureErr error
		if message.GetResourceKind() == privatecontentpb.
			FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT &&
			verification.GetReceiverVerifiedSenderSigningKey() != nil {
			signatureErr = verifyFederatedPrivateReceiverVerifiedSender(
				verification.GetReceiverVerifiedSenderSigningKey(),
				routing.GetSender(),
				routing.GetSenderSigningKeyId(),
				routing.GetCanonicalFactsSha256(),
				routing.GetSenderSignature(),
				message.GetCommittedAt().AsTime(),
			)
		} else {
			signatureErr = s.signatureVerifier.Verify(
				ctx,
				transaction,
				routing.GetSender(),
				message.GetSourceStationPeerId(),
				routing.GetSenderSigningKeyId(),
				routing.GetCanonicalFactsSha256(),
				routing.GetSenderSignature(),
				message.GetCommittedAt().AsTime(),
			)
		}
		if signatureErr != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				signatureErr,
			)
		}
	}
	return nil
}

func verifyFederatedPrivateReceiverVerifiedSender(
	key *actormodel.VerifiedActorDeviceSigningKey,
	sender *actormodel.ActorDeviceRef,
	signingKeyID string,
	canonical []byte,
	signature []byte,
	committedAt time.Time,
) error {
	if key == nil ||
		sender == nil ||
		sender.GetActor() == nil ||
		key.GetActorPtid() != sender.GetActor().GetPtid() ||
		key.GetActorDeviceId() != sender.GetDeviceId() ||
		strings.TrimSpace(key.GetHomeStationPeerId()) == "" ||
		key.GetSigningKeyId() != signingKeyID ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		key.GetProfileVersion() <= 0 ||
		key.GetValidFromUnixMs() <= 0 ||
		key.GetValidFromUnixMs() > committedAt.UTC().UnixMilli() ||
		(key.GetRevokedAtUnixMs() != 0 &&
			(key.GetRevokedAtUnixMs() <= key.GetValidFromUnixMs() ||
				committedAt.UTC().UnixMilli() >= key.GetRevokedAtUnixMs())) {
		return errors.New("receiver-verified sender signing key is invalid")
	}
	switch key.GetVerificationSource() {
	case actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_LOCATOR:
	default:
		return errors.New("receiver-verified sender signing key source is invalid")
	}
	if !ed25519.Verify(
		ed25519.PublicKey(key.GetEd25519PublicKey()),
		canonical,
		signature,
	) {
		return errors.New("receiver-verified sender signature is invalid")
	}
	return nil
}

func (s *PrivateContentService) projectRemotePrivateMoment(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	read *infrastructure.RemotePrivatePostReadModel,
) (*privatecontentpb.GetMomentResourceResponse, error) {
	const operation = "social.private_content.project_remote_moment"
	message := read.Delivery
	if message == nil || message.GetPost() == nil ||
		message.GetVerification() == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"projection",
			"is incomplete",
		)
	}
	verification := proto.Clone(
		message.GetVerification(),
	).(*privatecontentpb.PrivateContentVerification)
	attestation, err :=
		s.stationSigner.AttestImportedContentProofVerificationKey(
			ctx,
			message.GetSourceStationPeerId(),
			verification.GetCommitProof().GetStationSigningKeyId(),
			s.now(),
		)
	if err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	verification.StationSigningKeyAttestation = attestation
	var viewerEnvelope *securecontentpb.ViewerContentKeyEnvelope
	if len(message.GetTargetActorEnvelopes()) == 1 {
		viewerEnvelope = proto.Clone(
			message.GetTargetActorEnvelopes()[0],
		).(*securecontentpb.ViewerContentKeyEnvelope)
	}
	if viewerEnvelope == nil || viewerEnvelope.GetBinding() == nil ||
		viewerEnvelope.GetBinding().GetSender() == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"viewer_envelope",
			"is incomplete",
		)
	}
	authorKey, err := s.signatureVerifier.ResolveRetained(
		ctx,
		transaction,
		verification.GetCommitProof().GetAuthor(),
		message.GetSourceStationPeerId(),
		viewerEnvelope.GetBinding().GetSenderSigningKeyId(),
		message.GetCommittedAt().AsTime(),
	)
	if err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	if authorKey == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"receiver_verified_sender_signing_key",
			"is unavailable",
		)
	}
	verification.ReceiverVerifiedSenderSigningKey = authorKey
	return &privatecontentpb.GetMomentResourceResponse{
		Explanation: &actormodel.FeedObjectExplanation{
			ObjectId: message.GetPost().GetPostId(),
			Source: &actormodel.ActivitySource{
				Kind:          actormodel.ActivitySource_ACTIVITY_SOURCE_REMOTE,
				StationPeerId: message.GetSourceStationPeerId(),
			},
			RelationshipReason: &actormodel.RelationshipReason{
				Kind: actormodel.RelationshipReason_RELATIONSHIP_REASON_MUTUAL,
			},
			AudienceExplanation: proto.Clone(
				message.GetAudienceExplanation(),
			).(*actormodel.AudienceExplanation),
			BlockExplanation: &actormodel.BlockExplanation{
				Kind: actormodel.BlockExplanation_BLOCK_STATE_NOT_BLOCKED,
			},
		},
		Resource: &privatecontentpb.PostResource{
			Metadata: proto.Clone(
				message.GetPost(),
			).(*privatecontentpb.PostMetadata),
			Body: &privatecontentpb.PostResource_PrivateContent{
				PrivateContent: &privatecontentpb.PrivateContentAccess{
					Payload: proto.Clone(
						message.GetPayload(),
					).(*securecontentpb.EncryptedPayload),
					ViewerEnvelope: viewerEnvelope,
					Objects:        cloneEncryptedObjects(message.GetObjects()),
					Verification:   verification,
				},
			},
		},
	}, nil
}

func cloneEncryptedObjects(
	objects []*securecontentpb.EncryptedObjectDescriptor,
) []*securecontentpb.EncryptedObjectDescriptor {
	cloned := make([]*securecontentpb.EncryptedObjectDescriptor, 0, len(objects))
	for _, object := range objects {
		cloned = append(
			cloned,
			proto.Clone(object).(*securecontentpb.EncryptedObjectDescriptor),
		)
	}
	return cloned
}
