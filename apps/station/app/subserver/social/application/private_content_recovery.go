package application

import (
	"bytes"
	"context"
	"crypto/sha256"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

const maximumRecoverablePrivateContentPageSize = 100

// ListRecoverablePrivateContent returns only actor-scoped recovery envelopes
// whose Social authorization remains current at query time.
func (s *PrivateContentService) ListRecoverablePrivateContent(
	ctx context.Context,
	actorPTID string,
	request *privatecontentpb.ListRecoverablePrivateContentRequest,
) (*privatecontentpb.ListRecoverablePrivateContentResponse, error) {
	const operation = "social.private_content.list_recoverable"
	if request == nil ||
		len(request.ProtoReflect().GetUnknown()) != 0 {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"request",
			"is required and must contain only known fields",
		)
	}
	if request.GetLimit() < 1 ||
		request.GetLimit() > maximumRecoverablePrivateContentPageSize {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentInvalidArgument,
			operation,
			"limit",
			"must be between 1 and 100",
		)
	}

	cursor, err := socialdomain.DecodeRecoverableContentCursor(
		actorPTID,
		request.GetCursor(),
	)
	if err != nil {
		return nil, err
	}
	records, err := s.store.ListRecoverablePrivateContent(
		ctx,
		infrastructure.RecoverablePrivateContentQuery{
			ActorPTID:          actorPTID,
			CursorCreatedAt:    cursor.CreatedAt,
			CursorResourceKind: string(cursor.ResourceKind),
			CursorResourceID:   cursor.ResourceID,
			Limit:              int(request.GetLimit()) + 1,
		},
	)
	if err != nil {
		return nil, mapPrivateStoreError(operation, err)
	}

	hasMore := len(records) > int(request.GetLimit())
	if hasMore {
		records = records[:request.GetLimit()]
	}
	resources := make(
		[]*privatecontentpb.RecoverablePrivateContent,
		0,
		len(records),
	)
	for _, record := range records {
		resource, err := s.projectRecoverablePrivateContent(
			actorPTID,
			record,
		)
		if err != nil {
			return nil, err
		}
		resources = append(resources, resource)
	}

	nextCursor := ""
	if hasMore {
		last := records[len(records)-1]
		nextCursor, err = socialdomain.EncodeRecoverableContentCursor(
			actorPTID,
			socialdomain.RecoverableContentCursor{
				CreatedAt: last.CreatedAt,
				ResourceKind: socialdomain.PrivateContentResourceKind(
					last.ResourceKind,
				),
				ResourceID: last.ResourceID,
			},
		)
		if err != nil {
			return nil, err
		}
	}

	return &privatecontentpb.ListRecoverablePrivateContentResponse{
		Resources:  resources,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

func (s *PrivateContentService) projectRecoverablePrivateContent(
	actorPTID string,
	record infrastructure.RecoverablePrivateContentRecord,
) (*privatecontentpb.RecoverablePrivateContent, error) {
	const operation = "social.private_content.project_recoverable"
	if err := validateRecoverablePrivateContentRecord(
		operation,
		actorPTID,
		record,
	); err != nil {
		return nil, err
	}

	payload := &securecontentpb.EncryptedPayload{}
	if err := proto.Unmarshal(record.EncryptedPayloadBytes, payload); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	if len(record.ViewerEnvelopeBytes) != 0 {
		return s.projectRemoteRecoverablePrivateContent(
			operation,
			actorPTID,
			record,
			payload,
		)
	}
	payloadBytes, err := socialdomain.CanonicalProtoBytes(payload)
	if err != nil ||
		!bytes.Equal(
			privateSHA256(payloadBytes),
			record.EncryptedPayloadSHA256,
		) ||
		securecontentkernel.ValidateEncryptedPayload(payload, s.policy) != nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"payload",
			"does not match its persisted canonical commitment",
		)
	}

	prepared := &securecontentpb.PreparedContentKeyEnvelope{}
	if err := proto.Unmarshal(
		record.PreparedEnvelopeBytes,
		prepared,
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	preparedBytes, err := socialdomain.CanonicalProtoBytes(prepared)
	if err != nil ||
		!bytes.Equal(privateSHA256(preparedBytes), record.EnvelopeSHA256) ||
		securecontentkernel.ValidatePreparedContentKeyEnvelope(
			prepared,
			s.policy,
		) != nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"recovery_envelope",
			"does not match its persisted canonical commitment",
		)
	}

	binding := prepared.GetBinding()
	resource := binding.GetResource()
	senderSignatureHash := sha256.Sum256(prepared.GetSenderSignature())
	if resource.GetOwnerDomain() !=
		securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		resource.GetContentId() != record.ContentID ||
		resource.GetGeneration() != record.Generation ||
		!proto.Equal(payload.GetResource(), resource) ||
		binding.GetPlanId() != record.PlanID ||
		binding.GetRecipientKeyKind() !=
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY ||
		binding.GetRecipientKeyId() != record.EnvelopeOneTimeKeyID ||
		binding.GetRecipientSlotId() != record.EnvelopeRecipientSlotID ||
		binding.GetSender().GetActor().GetPtid() != record.AuthorPTID ||
		binding.GetSender().GetDeviceId() != record.AuthorDeviceID ||
		!bytes.Equal(
			binding.GetCanonicalPlanSha256(),
			record.PlanCanonicalSHA256,
		) ||
		!bytes.Equal(
			binding.GetCanonicalPlanSha256(),
			record.EnvelopeCanonicalPlanSHA256,
		) ||
		!bytes.Equal(
			binding.GetAuthorizationSnapshotSha256(),
			record.CanonicalSnapshotSHA256,
		) ||
		!bytes.Equal(
			binding.GetPrincipalBindingSha256(),
			record.EnvelopePrincipalBindingSHA256,
		) ||
		!bytes.Equal(
			prepared.GetBindingSha256(),
			record.EnvelopeBindingSHA256,
		) ||
		!bytes.Equal(
			binding.GetPayloadCiphertextSha256(),
			payload.GetCiphertextSha256(),
		) ||
		!bytes.Equal(
			senderSignatureHash[:],
			record.EnvelopeSenderSignatureSHA256,
		) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"binding",
			"locator, resource, content, or generation diverges",
		)
	}

	viewerEnvelope := &securecontentpb.ViewerContentKeyEnvelope{
		Binding: proto.Clone(
			binding,
		).(*securecontentpb.ContentKeyEnvelopeBinding),
		Recipient: &securecontentpb.ViewerContentKeyEnvelope_RecoveryActor{
			RecoveryActor: &actormodel.ActorRef{
				Ptid: actorPTID,
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
		},
		BindingSha256: cloneApplicationBytes(
			prepared.GetBindingSha256(),
		),
		HpkeEncapsulatedKey: cloneApplicationBytes(
			prepared.GetHpkeEncapsulatedKey(),
		),
		HpkeCiphertext: cloneApplicationBytes(
			prepared.GetHpkeCiphertext(),
		),
		SenderSignature: cloneApplicationBytes(
			prepared.GetSenderSignature(),
		),
		PrincipalEpoch: record.EnvelopePrincipalEpoch,
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

	return &privatecontentpb.RecoverablePrivateContent{
		Resource: proto.Clone(
			resource,
		).(*securecontentpb.SecureResourceRef),
		Locator:          recoverablePrivateContentLocator(record),
		RecoveryEnvelope: viewerEnvelope,
		PayloadCiphertextSha256: cloneApplicationBytes(
			payload.GetCiphertextSha256(),
		),
	}, nil
}

func (s *PrivateContentService) projectRemoteRecoverablePrivateContent(
	operation string,
	actorPTID string,
	record infrastructure.RecoverablePrivateContentRecord,
	payload *securecontentpb.EncryptedPayload,
) (*privatecontentpb.RecoverablePrivateContent, error) {
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		payload,
	)
	if err != nil ||
		!bytes.Equal(payloadBytes, record.EncryptedPayloadBytes) ||
		securecontentkernel.ValidateEncryptedPayload(payload, s.policy) != nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"payload",
			"does not match its retained remote projection",
		)
	}

	viewerEnvelope := &securecontentpb.ViewerContentKeyEnvelope{}
	if err := proto.Unmarshal(
		record.ViewerEnvelopeBytes,
		viewerEnvelope,
	); err != nil {
		return nil, socialdomain.WrapPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			err,
		)
	}
	envelopeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		viewerEnvelope,
	)
	if err != nil ||
		!bytes.Equal(envelopeBytes, record.ViewerEnvelopeBytes) ||
		securecontentkernel.ValidateViewerContentKeyEnvelope(
			viewerEnvelope,
			s.policy,
		) != nil {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"recovery_envelope",
			"does not match its retained remote projection",
		)
	}

	resource := payload.GetResource()
	binding := viewerEnvelope.GetBinding()
	recoveryActor := viewerEnvelope.GetRecoveryActor()
	if len(record.PreparedEnvelopeBytes) != 0 ||
		resource.GetOwnerDomain() !=
			securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		resource.GetContentId() != record.ContentID ||
		resource.GetGeneration() != record.Generation ||
		!proto.Equal(binding.GetResource(), resource) ||
		binding.GetRecipientKeyKind() !=
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY ||
		binding.GetRecipientKeyId() != record.EnvelopeOneTimeKeyID ||
		binding.GetSender().GetActor().GetPtid() != record.AuthorPTID ||
		recoveryActor.GetPtid() != actorPTID ||
		viewerEnvelope.GetEndpoint() != nil ||
		viewerEnvelope.GetPrincipalEpoch() != record.EnvelopePrincipalEpoch ||
		!bytes.Equal(
			binding.GetPayloadCiphertextSha256(),
			payload.GetCiphertextSha256(),
		) {
		return nil, socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"binding",
			"retained remote locator, actor, content, or generation diverges",
		)
	}

	return &privatecontentpb.RecoverablePrivateContent{
		Resource: proto.Clone(
			resource,
		).(*securecontentpb.SecureResourceRef),
		Locator: recoverablePrivateContentLocator(record),
		RecoveryEnvelope: proto.Clone(
			viewerEnvelope,
		).(*securecontentpb.ViewerContentKeyEnvelope),
		PayloadCiphertextSha256: cloneApplicationBytes(
			payload.GetCiphertextSha256(),
		),
	}, nil
}

func validateRecoverablePrivateContentRecord(
	operation string,
	actorPTID string,
	record infrastructure.RecoverablePrivateContentRecord,
) error {
	if record.EnvelopeKeyKind !=
		infrastructure.PrivateContentKeyKindActorRecovery ||
		record.EnvelopeRecipientPTID != actorPTID ||
		record.EnvelopeRecipientDeviceID != "" ||
		record.EnvelopePrincipalEpoch == 0 ||
		record.ContentID != record.ResourceID ||
		record.CreatedAt.IsZero() {
		return socialdomain.NewPrivateContentError(
			socialdomain.PrivateContentIntegrityFailed,
			operation,
			"record",
			"is not an exact actor recovery record",
		)
	}
	for field, value := range map[string]string{
		"resource_id": record.ResourceID,
		"content_id":  record.ContentID,
		"post_id":     record.PostID,
	} {
		if err := socialdomain.ValidatePrivateContentID(
			value,
			field,
			operation,
		); err != nil {
			return socialdomain.WrapPrivateContentError(
				socialdomain.PrivateContentIntegrityFailed,
				operation,
				err,
			)
		}
	}
	switch record.ResourceKind {
	case infrastructure.PrivateContentResourcePost:
		if record.PostID != record.ResourceID {
			return inconsistentRecoverableLocator(operation)
		}
	case infrastructure.PrivateContentResourceComment:
		if record.PostID == record.ResourceID {
			return inconsistentRecoverableLocator(operation)
		}
	default:
		return inconsistentRecoverableLocator(operation)
	}

	return nil
}

func recoverablePrivateContentLocator(
	record infrastructure.RecoverablePrivateContentRecord,
) *privatecontentpb.SocialPrivateContentLocator {
	if record.ResourceKind == infrastructure.PrivateContentResourcePost {
		return &privatecontentpb.SocialPrivateContentLocator{
			Resource: &privatecontentpb.SocialPrivateContentLocator_PostId{
				PostId: record.PostID,
			},
		}
	}

	return &privatecontentpb.SocialPrivateContentLocator{
		Resource: &privatecontentpb.SocialPrivateContentLocator_Comment{
			Comment: &privatecontentpb.PrivateCommentLocator{
				PostId:    record.PostID,
				CommentId: record.ResourceID,
			},
		},
	}
}

func inconsistentRecoverableLocator(operation string) error {
	return socialdomain.NewPrivateContentError(
		socialdomain.PrivateContentIntegrityFailed,
		operation,
		"locator",
		"does not identify the persisted private resource",
	)
}
