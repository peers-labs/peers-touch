package securecontent

import (
	"bytes"
	"crypto/sha256"

	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func ValidateEncryptedPayload(
	payload *securecontentpb.EncryptedPayload,
	policy Policy,
) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	if payload == nil || hasUnknownFields(payload) {
		return invalidEnvelope("validate_encrypted_payload", "payload")
	}
	if payload.GetFormatVersion() != FormatVersion {
		return NewError(
			ErrorCodeUnsupportedVersion,
			"securecontent.validate_encrypted_payload",
			"format_version",
			"is not supported",
		)
	}
	if err := ValidateResourceRef(payload.GetResource()); err != nil {
		return err
	}
	if payload.GetSuite() != securecontentpb.PayloadEncryptionSuite_PAYLOAD_ENCRYPTION_SUITE_AES_256_GCM ||
		len(payload.GetNonce()) != AES256GCMNonceSize ||
		len(payload.GetCiphertext()) < AES256GCMTagSize ||
		uint64(len(payload.GetCiphertext())) > policy.MaximumPayloadCiphertextSize {
		return invalidEnvelope("validate_encrypted_payload", "ciphertext")
	}
	if err := hashField(
		payload.GetCiphertextSha256(),
		"ciphertext_sha256",
		"securecontent.validate_encrypted_payload",
	); err != nil {
		return err
	}
	if err := hashField(
		payload.GetAadSha256(),
		"aad_sha256",
		"securecontent.validate_encrypted_payload",
	); err != nil {
		return err
	}
	actualHash := sha256.Sum256(payload.GetCiphertext())
	if !bytes.Equal(payload.GetCiphertextSha256(), actualHash[:]) {
		return NewError(
			ErrorCodeIntegrityFailed,
			"securecontent.validate_encrypted_payload",
			"ciphertext_sha256",
			"does not match the encrypted payload",
		)
	}

	return nil
}

func ValidateContentEncryptionPlan(
	plan *securecontentpb.ContentEncryptionPlan,
	policy Policy,
) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	if plan == nil || hasUnknownFields(plan) {
		return invalidEnvelope("validate_encryption_plan", "plan")
	}
	if plan.GetFormatVersion() != FormatVersion {
		return NewError(
			ErrorCodeUnsupportedVersion,
			"securecontent.validate_encryption_plan",
			"format_version",
			"is not supported",
		)
	}
	if !validIdentifier(plan.GetPlanId(), MaximumIdentifierLength) ||
		!validIdentifier(plan.GetStationSigningKeyId(), MaximumIdentifierLength) ||
		len(plan.GetStationSignature()) != Ed25519SignatureSize ||
		len(plan.GetRequiredSlots()) == 0 ||
		len(plan.GetRequiredSlots()) > policy.MaximumRecipientSlots ||
		len(plan.GetObjectIds()) > policy.MaximumObjectsPerResource {
		return invalidEnvelope("validate_encryption_plan", "plan")
	}
	if err := ValidateResourceRef(plan.GetResource()); err != nil {
		return err
	}
	if err := validateActorDeviceRef(plan.GetAuthor(), "author"); err != nil {
		return err
	}
	for field, value := range map[string][]byte{
		"authorization_snapshot_sha256": plan.GetAuthorizationSnapshotSha256(),
		"canonical_plan_sha256":         plan.GetCanonicalPlanSha256(),
		"domain_binding_sha256":         plan.GetDomainBindingSha256(),
	} {
		if err := hashField(value, field, "securecontent.validate_encryption_plan"); err != nil {
			return err
		}
	}
	if err := validateTimestamp(plan.GetExpiresAt(), "expires_at", "validate_encryption_plan"); err != nil {
		return err
	}

	previousSlotID := ""
	keyIDs := make(map[string]struct{}, len(plan.GetRequiredSlots()))
	for _, slot := range plan.GetRequiredSlots() {
		if slot == nil || hasUnknownFields(slot) ||
			!validIdentifier(slot.GetRecipientSlotId(), MaximumIdentifierLength) ||
			slot.GetRecipientSlotId() <= previousSlotID ||
			!validIdentifier(slot.GetOneTimeKeyId(), MaximumIdentifierLength) ||
			len(slot.GetOneTimePublicKey()) != X25519PublicKeySize ||
			len(slot.GetPrincipalBindingSha256()) != SHA256Size ||
			(slot.GetKeyKind() != securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT &&
				slot.GetKeyKind() != securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY) {
			return invalidEnvelope("validate_encryption_plan", "required_slots")
		}
		if _, duplicate := keyIDs[slot.GetOneTimeKeyId()]; duplicate {
			return NewError(
				ErrorCodeConflict,
				"securecontent.validate_encryption_plan",
				"one_time_key_id",
				"must be unique inside the plan",
			)
		}
		keyIDs[slot.GetOneTimeKeyId()] = struct{}{}
		previousSlotID = slot.GetRecipientSlotId()
	}

	previousObjectID := ""
	for _, objectID := range plan.GetObjectIds() {
		if !validIdentifier(objectID, MaximumIdentifierLength) ||
			objectID <= previousObjectID {
			return invalidEnvelope("validate_encryption_plan", "object_ids")
		}
		previousObjectID = objectID
	}

	return nil
}

func ValidateContentKeyEnvelopeBinding(
	binding *securecontentpb.ContentKeyEnvelopeBinding,
) error {
	if binding == nil || hasUnknownFields(binding) {
		return invalidEnvelope("validate_envelope_binding", "binding")
	}
	if binding.GetFormatVersion() != FormatVersion {
		return NewError(
			ErrorCodeUnsupportedVersion,
			"securecontent.validate_envelope_binding",
			"format_version",
			"is not supported",
		)
	}
	if !validIdentifier(binding.GetPlanId(), MaximumIdentifierLength) ||
		!validIdentifier(binding.GetRecipientSlotId(), MaximumIdentifierLength) ||
		!validIdentifier(binding.GetRecipientKeyId(), MaximumIdentifierLength) ||
		!validIdentifier(binding.GetSenderSigningKeyId(), MaximumIdentifierLength) ||
		(binding.GetRecipientKeyKind() != securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT &&
			binding.GetRecipientKeyKind() != securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY) {
		return invalidEnvelope("validate_envelope_binding", "binding")
	}
	if err := ValidateResourceRef(binding.GetResource()); err != nil {
		return err
	}
	if err := validateActorDeviceRef(binding.GetSender(), "sender"); err != nil {
		return err
	}
	for field, value := range map[string][]byte{
		"canonical_plan_sha256":         binding.GetCanonicalPlanSha256(),
		"principal_binding_sha256":      binding.GetPrincipalBindingSha256(),
		"authorization_snapshot_sha256": binding.GetAuthorizationSnapshotSha256(),
		"payload_ciphertext_sha256":     binding.GetPayloadCiphertextSha256(),
		"object_descriptor_set_sha256":  binding.GetObjectDescriptorSetSha256(),
	} {
		if err := hashField(value, field, "securecontent.validate_envelope_binding"); err != nil {
			return err
		}
	}

	return validateTimestamp(
		binding.GetPlanExpiresAt(),
		"plan_expires_at",
		"validate_envelope_binding",
	)
}

func ValidateEnvelopeBindingMatch(
	actual *securecontentpb.ContentKeyEnvelopeBinding,
	expected *securecontentpb.ContentKeyEnvelopeBinding,
) error {
	if err := ValidateContentKeyEnvelopeBinding(actual); err != nil {
		return err
	}
	if err := ValidateContentKeyEnvelopeBinding(expected); err != nil {
		return err
	}
	if !proto.Equal(actual, expected) {
		return NewError(
			ErrorCodeBindingMismatch,
			"securecontent.validate_envelope_binding_match",
			"binding",
			"does not match the expected plan, resource, recipient, and ciphertext commitments",
		)
	}

	return nil
}

func CanonicalEnvelopeBindingBytes(
	binding *securecontentpb.ContentKeyEnvelopeBinding,
) ([]byte, error) {
	if err := ValidateContentKeyEnvelopeBinding(binding); err != nil {
		return nil, err
	}
	return canonicalEnvelopeBinding(binding), nil
}

func EnvelopeBindingSHA256(
	binding *securecontentpb.ContentKeyEnvelopeBinding,
) ([SHA256Size]byte, error) {
	encoded, err := CanonicalEnvelopeBindingBytes(binding)
	if err != nil {
		return [SHA256Size]byte{}, err
	}

	return sha256.Sum256(encoded), nil
}

func ValidatePreparedContentKeyEnvelope(
	envelope *securecontentpb.PreparedContentKeyEnvelope,
	policy Policy,
) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	if envelope == nil || hasUnknownFields(envelope) {
		return invalidEnvelope("validate_prepared_envelope", "envelope")
	}
	if err := validateEnvelopeCiphertext(
		envelope.GetBinding(),
		envelope.GetBindingSha256(),
		envelope.GetHpkeEncapsulatedKey(),
		envelope.GetHpkeCiphertext(),
		envelope.GetSenderSignature(),
		policy,
		"validate_prepared_envelope",
	); err != nil {
		return err
	}

	return nil
}

func ValidateViewerContentKeyEnvelope(
	envelope *securecontentpb.ViewerContentKeyEnvelope,
	policy Policy,
) error {
	if err := policy.Validate(); err != nil {
		return err
	}
	if envelope == nil || hasUnknownFields(envelope) || envelope.GetPrincipalEpoch() == 0 {
		return invalidEnvelope("validate_viewer_envelope", "envelope")
	}
	if err := validateEnvelopeCiphertext(
		envelope.GetBinding(),
		envelope.GetBindingSha256(),
		envelope.GetHpkeEncapsulatedKey(),
		envelope.GetHpkeCiphertext(),
		envelope.GetSenderSignature(),
		policy,
		"validate_viewer_envelope",
	); err != nil {
		return err
	}

	switch recipient := envelope.GetRecipient().(type) {
	case *securecontentpb.ViewerContentKeyEnvelope_Endpoint:
		if envelope.GetBinding().GetRecipientKeyKind() !=
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT {
			return invalidEnvelope("validate_viewer_envelope", "recipient")
		}
		return validateActorDeviceRef(recipient.Endpoint, "recipient.endpoint")
	case *securecontentpb.ViewerContentKeyEnvelope_RecoveryActor:
		if envelope.GetBinding().GetRecipientKeyKind() !=
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY {
			return invalidEnvelope("validate_viewer_envelope", "recipient")
		}
		return validateActorRef(recipient.RecoveryActor, "recipient.recovery_actor")
	default:
		return invalidEnvelope("validate_viewer_envelope", "recipient")
	}
}

func ValidateViewerContentCommitProof(
	proof *securecontentpb.ViewerContentCommitProof,
) error {
	if proof == nil || hasUnknownFields(proof) {
		return invalidEnvelope("validate_commit_proof", "proof")
	}
	if proof.GetFormatVersion() != FormatVersion {
		return NewError(
			ErrorCodeUnsupportedVersion,
			"securecontent.validate_commit_proof",
			"format_version",
			"is not supported",
		)
	}
	if !validIdentifier(proof.GetDomainCommitId(), MaximumIdentifierLength) ||
		!validIdentifier(proof.GetStationSigningKeyId(), MaximumIdentifierLength) ||
		len(proof.GetStationSignature()) != Ed25519SignatureSize {
		return invalidEnvelope("validate_commit_proof", "proof")
	}
	if err := ValidateResourceRef(proof.GetResource()); err != nil {
		return err
	}
	if err := validateActorDeviceRef(proof.GetAuthor(), "author"); err != nil {
		return err
	}
	for field, value := range map[string][]byte{
		"canonical_plan_sha256":         proof.GetCanonicalPlanSha256(),
		"authorization_snapshot_sha256": proof.GetAuthorizationSnapshotSha256(),
		"domain_binding_sha256":         proof.GetDomainBindingSha256(),
		"encrypted_payload_sha256":      proof.GetEncryptedPayloadSha256(),
		"object_descriptor_set_sha256":  proof.GetObjectDescriptorSetSha256(),
		"mention_routing_sha256":        proof.GetMentionRoutingSha256(),
		"subtype_authority_sha256":      proof.GetSubtypeAuthoritySha256(),
	} {
		if err := hashField(value, field, "securecontent.validate_commit_proof"); err != nil {
			return err
		}
	}

	return validateTimestamp(proof.GetCommittedAt(), "committed_at", "validate_commit_proof")
}

func validateEnvelopeCiphertext(
	binding *securecontentpb.ContentKeyEnvelopeBinding,
	bindingHash []byte,
	encapsulatedKey []byte,
	ciphertext []byte,
	signature []byte,
	policy Policy,
	operation string,
) error {
	if err := ValidateContentKeyEnvelopeBinding(binding); err != nil {
		return err
	}
	if len(bindingHash) != SHA256Size ||
		len(encapsulatedKey) != X25519PublicKeySize ||
		len(ciphertext) < AES256GCMTagSize ||
		len(ciphertext) > policy.MaximumEnvelopeBytes ||
		len(signature) != Ed25519SignatureSize {
		return invalidEnvelope(operation, "envelope")
	}
	expectedHash, err := EnvelopeBindingSHA256(binding)
	if err != nil {
		return err
	}
	if !bytes.Equal(bindingHash, expectedHash[:]) {
		return NewError(
			ErrorCodeBindingMismatch,
			"securecontent."+operation,
			"binding_sha256",
			"does not match the canonical envelope binding",
		)
	}

	return nil
}

func validateActorDeviceRef(ref *actormodel.ActorDeviceRef, field string) error {
	if ref == nil || hasUnknownFields(ref) ||
		!validIdentifier(ref.GetDeviceId(), MaximumIdentifierLength) {
		return invalidEnvelope("validate_actor_device_ref", field)
	}

	return validateActorRef(ref.GetActor(), field+".actor")
}

func validateActorRef(ref *actormodel.ActorRef, field string) error {
	if ref == nil || hasUnknownFields(ref) ||
		!validIdentifier(ref.GetPtid(), MaximumIdentifierLength) ||
		ref.GetKind() == actormodel.ActorKind_ACTOR_KIND_UNSPECIFIED {
		return invalidEnvelope("validate_actor_ref", field)
	}

	return nil
}

func validateTimestamp(
	value *timestamppb.Timestamp,
	field string,
	operation string,
) error {
	if value == nil || hasUnknownFields(value) || value.AsTime().IsZero() {
		return invalidEnvelope(operation, field)
	}
	if err := value.CheckValid(); err != nil {
		return WrapError(
			ErrorCodeInvalidArgument,
			"securecontent."+operation,
			err,
		)
	}

	return nil
}

func invalidEnvelope(operation string, field string) error {
	return NewError(
		ErrorCodeInvalidArgument,
		"securecontent."+operation,
		field,
		"does not satisfy the canonical Secure Content contract",
	)
}
