package application

import (
	"bytes"
	"context"
	"errors"
	"strings"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const maximumPrivateCommentPageSize = 100

func ProjectPublicCommentResource(
	comment *actormodel.Comment,
) *privatecontentpb.CommentResource {
	if comment == nil {
		return nil
	}
	author := comment.GetAuthor()
	authorPTID := comment.GetAuthorPtid()
	authorAcct := ""
	if author != nil {
		if author.GetId() != "" {
			authorPTID = author.GetId()
		}
		authorAcct = strings.TrimPrefix(author.GetFederatedHandle(), "@")
	}
	return &privatecontentpb.CommentResource{
		Metadata: &privatecontentpb.CommentMetadata{
			CommentId:        comment.GetId(),
			ContentId:        comment.GetId(),
			PostId:           comment.GetPostId(),
			ReplyToCommentId: comment.GetReplyToCommentId(),
			Author: &actormodel.ActorRef{
				Ptid: authorPTID,
				Acct: authorAcct,
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			CreatedAt:      comment.GetCreatedAt(),
			UpdatedAt:      comment.GetUpdatedAt(),
			IsDeleted:      comment.GetIsDeleted(),
			ReactionsCount: comment.GetLikesCount(),
			RepliesCount:   comment.GetRepliesCount(),
		},
		Body: &privatecontentpb.CommentResource_PublicContent{
			PublicContent: &privatecontentpb.PublicCommentContent{
				Text: comment.GetContent(),
			},
		},
	}
}

func (s *PrivateContentService) GetPrivateComment(
	ctx context.Context,
	viewer *actormodel.ActorDeviceRef,
	postID string,
	commentID string,
) (*privatecontentpb.GetMomentCommentResourceResponse, error) {
	const operation = "social.private_content.get_comment"
	if err := s.validatePrivateContentViewer(ctx, viewer, operation); err != nil {
		return nil, err
	}
	if err := socialdomain.ValidatePrivateContentID(
		postID,
		"post_id",
		operation,
	); err != nil {
		return nil, err
	}
	if err := socialdomain.ValidatePrivateContentID(
		commentID,
		"comment_id",
		operation,
	); err != nil {
		return nil, err
	}
	read, err := s.store.GetPrivateComment(
		ctx,
		postID,
		commentID,
		viewer.GetActor().GetPtid(),
		viewer.GetDeviceId(),
	)
	if err != nil {
		if errors.Is(err, infrastructure.ErrPrivateContentNotFound) {
			var remoteResponse *privatecontentpb.GetMomentCommentResourceResponse
			remoteErr := s.store.ReadRemotePrivateComment(
				ctx,
				postID,
				commentID,
				viewer.GetActor().GetPtid(),
				viewer.GetDeviceId(),
				func(
					transaction federationdelivery.Transaction,
					read *infrastructure.RemotePrivateCommentReadModel,
				) error {
					comment, projectErr := s.projectRemotePrivateComment(
						ctx,
						transaction,
						read,
					)
					if projectErr == nil {
						remoteResponse =
							&privatecontentpb.GetMomentCommentResourceResponse{
								Comment: comment,
							}
					}
					return projectErr
				},
			)
			if remoteErr == nil {
				return remoteResponse, nil
			}
			if socialdomain.PrivateContentCodeOf(remoteErr) != "" {
				return nil, remoteErr
			}
			err = remoteErr
		}
		return nil, mapPrivateStoreError(operation, err)
	}
	comment, err := s.projectPrivateComment(ctx, viewer, read, operation)
	if err != nil {
		return nil, err
	}
	return &privatecontentpb.GetMomentCommentResourceResponse{
		Comment: comment,
	}, nil
}

func (s *PrivateContentService) ListPrivateComments(
	ctx context.Context,
	viewer *actormodel.ActorDeviceRef,
	request *privatecontentpb.ListMomentCommentsRequest,
) (*privatecontentpb.ListMomentCommentsResponse, error) {
	const operation = "social.private_content.list_comments"
	if err := s.validatePrivateContentViewer(ctx, viewer, operation); err != nil {
		return nil, err
	}
	if request == nil || len(request.ProtoReflect().GetUnknown()) != 0 {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"request",
			"is required and must contain only known fields",
		)
	}
	if err := socialdomain.ValidatePrivateContentID(
		request.GetPostId(),
		"post_id",
		operation,
	); err != nil {
		return nil, err
	}
	if request.GetLimit() < 1 ||
		request.GetLimit() > maximumPrivateCommentPageSize {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"limit",
			"must be between 1 and 100",
		)
	}
	viewerPTID := viewer.GetActor().GetPtid()
	cursor, err := socialdomain.DecodePrivateCommentCursor(
		viewerPTID,
		request.GetPostId(),
		request.GetCursor(),
	)
	if err != nil {
		return nil, err
	}
	page, err := s.store.ListPrivateComments(
		ctx,
		infrastructure.PrivateCommentListQuery{
			PostID:          request.GetPostId(),
			ViewerPTID:      viewerPTID,
			ViewerDeviceID:  viewer.GetDeviceId(),
			CursorCreatedAt: cursor.CreatedAt,
			CursorCommentID: cursor.CommentID,
			Limit:           int(request.GetLimit()),
		},
	)
	if err != nil {
		if errors.Is(err, infrastructure.ErrPrivateContentNotFound) {
			var remoteResponse *privatecontentpb.ListMomentCommentsResponse
			remoteErr := s.store.ListRemotePrivateComments(
				ctx,
				infrastructure.PrivateCommentListQuery{
					PostID:          request.GetPostId(),
					ViewerPTID:      viewerPTID,
					ViewerDeviceID:  viewer.GetDeviceId(),
					CursorCreatedAt: cursor.CreatedAt,
					CursorCommentID: cursor.CommentID,
					Limit:           int(request.GetLimit()),
				},
				func(
					transaction federationdelivery.Transaction,
					page infrastructure.RemotePrivateCommentPage,
				) error {
					comments := make(
						[]*privatecontentpb.CommentResource,
						0,
						len(page.Comments),
					)
					for _, read := range page.Comments {
						comment, projectErr := s.projectRemotePrivateComment(
							ctx,
							transaction,
							read,
						)
						if projectErr != nil {
							return projectErr
						}
						comments = append(comments, comment)
					}
					nextCursor := ""
					if page.HasMore {
						last := comments[len(comments)-1].GetMetadata()
						encoded, encodeErr :=
							socialdomain.EncodePrivateCommentCursor(
								viewerPTID,
								request.GetPostId(),
								socialdomain.PrivateCommentCursor{
									CreatedAt: last.GetCreatedAt().AsTime(),
									CommentID: last.GetCommentId(),
								},
							)
						if encodeErr != nil {
							return encodeErr
						}
						nextCursor = encoded
					}
					remoteResponse = &privatecontentpb.ListMomentCommentsResponse{
						Comments:   comments,
						NextCursor: nextCursor,
						HasMore:    page.HasMore,
					}
					return nil
				},
			)
			if remoteErr == nil {
				return remoteResponse, nil
			}
			if socialdomain.PrivateContentCodeOf(remoteErr) != "" {
				return nil, remoteErr
			}
			err = remoteErr
		}
		return nil, mapPrivateStoreError(operation, err)
	}
	comments := make(
		[]*privatecontentpb.CommentResource,
		0,
		len(page.Comments),
	)
	for _, read := range page.Comments {
		comment, err := s.projectPrivateComment(ctx, viewer, read, operation)
		if err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	nextCursor := ""
	if page.HasMore {
		last := page.Comments[len(page.Comments)-1].Comment
		nextCursor, err = socialdomain.EncodePrivateCommentCursor(
			viewerPTID,
			request.GetPostId(),
			socialdomain.PrivateCommentCursor{
				CreatedAt: last.CreatedAt,
				CommentID: last.CommentID,
			},
		)
		if err != nil {
			return nil, err
		}
	}
	return &privatecontentpb.ListMomentCommentsResponse{
		Comments:   comments,
		NextCursor: nextCursor,
		HasMore:    page.HasMore,
	}, nil
}

func (s *PrivateContentService) projectRemotePrivateComment(
	ctx context.Context,
	transaction federationdelivery.Transaction,
	read *infrastructure.RemotePrivateCommentReadModel,
) (*privatecontentpb.CommentResource, error) {
	const operation = "social.private_content.project_remote_comment"
	if read == nil ||
		read.Delivery == nil ||
		read.Delivery.GetComment() == nil ||
		read.Delivery.GetVerification() == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"projection",
			"is incomplete",
		)
	}
	message := read.Delivery
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
	if verification.GetReceiverVerifiedSenderSigningKey() == nil {
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
	}
	return &privatecontentpb.CommentResource{
		Metadata: proto.Clone(
			message.GetComment(),
		).(*privatecontentpb.CommentMetadata),
		Body: &privatecontentpb.CommentResource_PrivateContent{
			PrivateContent: &privatecontentpb.PrivateContentAccess{
				Payload: proto.Clone(
					message.GetPayload(),
				).(*securecontentpb.EncryptedPayload),
				ViewerEnvelope: viewerEnvelope,
				Objects:        cloneEncryptedObjects(message.GetObjects()),
				Verification:   verification,
			},
		},
	}, nil
}

func (s *PrivateContentService) validatePrivateContentViewer(
	ctx context.Context,
	viewer *actormodel.ActorDeviceRef,
	operation string,
) error {
	if viewer == nil || viewer.GetActor() == nil {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentUnauthorized,
			operation,
			"viewer",
			"requires an authenticated active device",
		)
	}
	if err := s.recipients.ValidateActiveEndpoint(ctx, viewer); err != nil {
		switch {
		case errors.Is(err, ErrPrivateContentInactiveEndpoint),
			actoridentitydomain.IsCode(
				err,
				actoridentitydomain.ErrorCodeDeviceNotFound,
			),
			actoridentitydomain.IsCode(
				err,
				actoridentitydomain.ErrorCodeDeviceRevoked,
			):
			return socialdomain.NewPrivateContentError(
				socialdomain.PrivateContentNotFound,
				operation,
				"viewer",
				"does not identify an active authorized endpoint",
			)
		}
		return socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentDependency,
			operation,
			err,
		)
	}
	return nil
}

func (s *PrivateContentService) projectPrivateComment(
	ctx context.Context,
	viewer *actormodel.ActorDeviceRef,
	read *infrastructure.PrivateCommentReadModel,
	operation string,
) (*privatecontentpb.CommentResource, error) {
	if read == nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"comment",
			"is unavailable",
		)
	}
	payload := &securecontentpb.EncryptedPayload{}
	if err := proto.Unmarshal(
		read.Comment.EncryptedPayloadBytes,
		payload,
	); err != nil {
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
			read.Comment.EncryptedPayloadSHA256,
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
	if read.Comment.CommentID != read.Comment.ContentID ||
		read.CommitProof.ContentID != read.Comment.ContentID ||
		read.CommitProof.Generation != read.Comment.Generation ||
		read.CommitProof.DomainCommitID != read.Comment.CommentID ||
		read.CommitProof.ResourceKind !=
			string(socialdomain.PrivateContentResourceComment) ||
		proof.GetDomainCommitId() != read.Comment.CommentID ||
		proof.GetDomainCommitId() != read.CommitProof.DomainCommitID ||
		proof.GetStationSigningKeyId() !=
			read.CommitProof.StationSigningKeyID {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"commit_proof.identity",
			"does not match the requested persisted Comment",
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
		proof.GetResource().GetContentId() != read.Comment.ContentID ||
		proof.GetResource().GetGeneration() != read.Comment.Generation ||
		proof.GetAuthor().GetActor().GetPtid() != read.Comment.AuthorPTID ||
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
			read.Comment.ObjectDescriptorSetSHA256,
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
	mentionRouting, err := decodePersistedMentionRouting(
		read.Comment.MentionRoutingBytes,
		read.Comment.MentionRoutingSHA256,
		proof,
		payloadBytes,
		operation,
	)
	if err != nil {
		return nil, err
	}
	return &privatecontentpb.CommentResource{
		Metadata: &privatecontentpb.CommentMetadata{
			CommentId:        read.Comment.CommentID,
			ContentId:        read.Comment.ContentID,
			PostId:           read.Comment.PostID,
			ReplyToCommentId: read.Comment.ReplyToCommentID,
			Author: proto.Clone(
				proof.GetAuthor().GetActor(),
			).(*actormodel.ActorRef),
			CreatedAt:      timestamppb.New(read.Comment.CreatedAt),
			UpdatedAt:      timestamppb.New(read.Comment.UpdatedAt),
			ReactionsCount: read.Comment.ReactionsCount,
			RepliesCount:   read.Comment.RepliesCount,
		},
		Body: &privatecontentpb.CommentResource_PrivateContent{
			PrivateContent: privateContentAccess(
				payload,
				objects,
				viewerEnvelope,
				proof,
				attestation,
				mentionRouting,
				nil,
				nil,
			),
		},
	}, nil
}
