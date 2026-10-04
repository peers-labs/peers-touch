package db

import "time"

const (
	SocialPrivatePlanStatePreparing         = "PREPARING"
	SocialPrivatePlanStatePreKeysClaimed    = "PREKEYS_CLAIMED"
	SocialPrivatePlanStatePrepared          = "PREPARED"
	SocialPrivatePlanStateConsumed          = "CONSUMED"
	SocialPrivatePlanStateRetryWait         = "RETRY_WAIT"
	SocialPrivatePlanStateRejectedStale     = "REJECTED_STALE"
	SocialPrivatePlanStateCancelled         = "CANCELLED"
	SocialPrivatePlanStateExpired           = "EXPIRED"
	SocialPrivateObjectCreated              = "CREATED"
	SocialPrivateObjectReceivingParts       = "RECEIVING_PARTS"
	SocialPrivateObjectVerifying            = "VERIFYING"
	SocialPrivateObjectCompleteUnattached   = "COMPLETE_UNATTACHED"
	SocialPrivateObjectAttached             = "ATTACHED"
	SocialPrivateObjectCancelled            = "CANCELLED"
	SocialPrivateObjectExpired              = "EXPIRED"
	SocialPrivateObjectTerminalCorrupt      = "TERMINAL_CORRUPT"
	SocialPrivateObjectGCClaimed            = "GC_CLAIMED"
	SocialPrivateObjectGarbageCollected     = "GARBAGE_COLLECTED"
	SocialPrivateObjectRetryWait            = "RETRY_WAIT"
	SocialPrivateObjectCleanupFailed        = "CLEANUP_FAILED"
	SocialPrivateObjectPartWriting          = "WRITING"
	SocialPrivateObjectPartStored           = "STORED"
	SocialPrivateDeliveryIntentStatePending = "PENDING"
	SocialPrivateDeliveryIntentStateRevoked = "REVOKED"
)

// SocialPrivateContentPlan is Social's durable authority for prepare replay.
// Canonical bytes are opaque protocol bytes; this row never stores private
// payload plaintext or content-encryption key material.
type SocialPrivateContentPlan struct {
	PlanID string `gorm:"column:plan_id;primaryKey;size:128"`

	AuthorPTID       string `gorm:"column:author_ptid;size:255;not null;uniqueIndex:uidx_social_private_plan_command,priority:1"`
	PrepareCommandID string `gorm:"column:prepare_command_id;size:128;not null;uniqueIndex:uidx_social_private_plan_command,priority:2"`
	ContentID        string `gorm:"column:content_id;size:128;not null;uniqueIndex:uidx_social_private_plan_resource,priority:1"`
	Generation       uint64 `gorm:"column:generation;not null;uniqueIndex:uidx_social_private_plan_resource,priority:2"`

	ResourceKind                  string     `gorm:"column:resource_kind;size:16;not null"`
	AudienceKind                  string     `gorm:"column:audience_kind;size:32;not null;default:'FRIENDS'"`
	AuthorDeviceID                string     `gorm:"column:author_device_id;size:128;not null"`
	AuthorHomeStationPeerID       string     `gorm:"column:author_home_station_peer_id;size:255;not null"`
	AudienceSnapshotID            string     `gorm:"column:audience_snapshot_id;size:128;not null"`
	AuthorizationSnapshotSHA256   []byte     `gorm:"column:authorization_snapshot_sha256;not null"`
	CanonicalPrepareBytes         []byte     `gorm:"column:canonical_prepare_bytes;not null"`
	CanonicalPrepareSHA256        []byte     `gorm:"column:canonical_prepare_sha256;not null"`
	AudienceBytes                 []byte     `gorm:"column:audience_bytes"`
	AudienceSHA256                []byte     `gorm:"column:audience_sha256"`
	RecipientLocalitiesBytes      []byte     `gorm:"column:recipient_localities_bytes"`
	RecipientLocalitiesSHA256     []byte     `gorm:"column:recipient_localities_sha256"`
	GroupRecipientSnapshotBytes   []byte     `gorm:"column:group_recipient_snapshot_bytes"`
	GroupRecipientSnapshotSHA256  []byte     `gorm:"column:group_recipient_snapshot_sha256"`
	SubtypePrepareAuthorityBytes  []byte     `gorm:"column:subtype_prepare_authority_bytes"`
	SubtypePrepareAuthoritySHA256 []byte     `gorm:"column:subtype_prepare_authority_sha256"`
	ClaimRequestBytes             []byte     `gorm:"column:claim_request_bytes;not null"`
	ClaimRequestSHA256            []byte     `gorm:"column:claim_request_sha256;not null"`
	ClaimResponseBytes            []byte     `gorm:"column:claim_response_bytes"`
	ClaimResponseSHA256           []byte     `gorm:"column:claim_response_sha256"`
	SignedPlanBytes               []byte     `gorm:"column:signed_plan_bytes"`
	SignedPlanSHA256              []byte     `gorm:"column:signed_plan_sha256"`
	CanonicalPlanSHA256           []byte     `gorm:"column:canonical_plan_sha256"`
	State                         string     `gorm:"column:state;size:32;not null;index:idx_social_private_plan_state_expiry"`
	DomainCommitID                string     `gorm:"column:domain_commit_id;size:128;index"`
	ExpiresAt                     time.Time  `gorm:"column:expires_at;not null;index:idx_social_private_plan_state_expiry"`
	PreparedAt                    *time.Time `gorm:"column:prepared_at"`
	ConsumedAt                    *time.Time `gorm:"column:consumed_at"`
	CreatedAt                     time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt                     time.Time  `gorm:"column:updated_at;not null"`
}

func (SocialPrivateContentPlan) TableName() string {
	return "social_private_content_plans"
}

// SocialPrivateContentPlanSlot binds one opaque prepare slot to the exact
// irreversibly claimed Content PreKey and recipient principal.
type SocialPrivateContentPlanSlot struct {
	PlanID          string `gorm:"column:plan_id;primaryKey;size:128;uniqueIndex:uidx_social_private_plan_slot_key,priority:1"`
	RecipientSlotID string `gorm:"column:recipient_slot_id;primaryKey;size:128"`

	ClaimID      string `gorm:"column:claim_id;size:128;not null;uniqueIndex:uidx_social_private_plan_slot_claim"`
	OneTimeKeyID string `gorm:"column:one_time_key_id;size:128;not null;uniqueIndex:uidx_social_private_plan_slot_key,priority:2"`
	KeyKind      string `gorm:"column:key_kind;size:32;not null"`

	RecipientPTID     string `gorm:"column:recipient_ptid;size:255;not null"`
	RecipientDeviceID string `gorm:"column:recipient_device_id;size:128"`
	PrincipalEpoch    uint64 `gorm:"column:principal_epoch;not null"`

	ClaimedPreKeyBytes     []byte    `gorm:"column:claimed_prekey_bytes;not null"`
	ClaimedPreKeySHA256    []byte    `gorm:"column:claimed_prekey_sha256;not null"`
	PrincipalBindingSHA256 []byte    `gorm:"column:principal_binding_sha256;not null"`
	CreatedAt              time.Time `gorm:"column:created_at;not null"`
}

func (SocialPrivateContentPlanSlot) TableName() string {
	return "social_private_content_plan_slots"
}

// SocialPrivateCommandReceipt stores the immutable business result. Replay
// metadata is deliberately not persisted; callers set exact_replay only on a
// returned clone.
type SocialPrivateCommandReceipt struct {
	AuthorPTID string `gorm:"column:author_ptid;primaryKey;size:255"`
	CommandID  string `gorm:"column:command_id;primaryKey;size:128"`

	PlanID                string    `gorm:"column:plan_id;size:128;not null"`
	CanonicalSubmitSHA256 []byte    `gorm:"column:canonical_submit_sha256;not null"`
	ResourceKind          string    `gorm:"column:resource_kind;size:16;not null"`
	ContentID             string    `gorm:"column:content_id;size:128;not null"`
	Generation            uint64    `gorm:"column:generation;not null"`
	DomainCommitID        string    `gorm:"column:domain_commit_id;size:128;not null;uniqueIndex:uidx_social_private_receipt_commit"`
	ResponseBytes         []byte    `gorm:"column:response_bytes;not null"`
	ResponseSHA256        []byte    `gorm:"column:response_sha256;not null"`
	CompletedAt           time.Time `gorm:"column:completed_at;not null"`
}

func (SocialPrivateCommandReceipt) TableName() string {
	return "social_private_command_receipts"
}

// SocialPrivateContentPost is the encrypted private Post fact. Its distinct Go
// name keeps the hard-cut persistence substrate independent from the retired
// plaintext model while retaining the accepted table name.
type SocialPrivateContentPost struct {
	PostID    string `gorm:"column:post_id;primaryKey;size:128;uniqueIndex:uidx_social_private_post_id"`
	ContentID string `gorm:"column:content_id;size:128;not null;uniqueIndex:uidx_social_private_post_content"`

	AuthorPTID                string     `gorm:"column:author_ptid;size:255;not null;index:idx_social_private_post_author_created"`
	Generation                uint64     `gorm:"column:generation;not null"`
	AudienceSnapshotID        string     `gorm:"column:audience_snapshot_id;size:128;not null"`
	Kind                      string     `gorm:"column:kind;size:32;not null"`
	EncryptedPayloadBytes     []byte     `gorm:"column:encrypted_payload_bytes;not null"`
	EncryptedPayloadSHA256    []byte     `gorm:"column:encrypted_payload_sha256;not null"`
	ObjectDescriptorSetSHA256 []byte     `gorm:"column:object_descriptor_set_sha256;not null"`
	MentionRoutingBytes       []byte     `gorm:"column:mention_routing_bytes"`
	MentionRoutingSHA256      []byte     `gorm:"column:mention_routing_sha256"`
	SubtypeAuthoritySHA256    []byte     `gorm:"column:subtype_authority_sha256"`
	LifecycleState            string     `gorm:"column:lifecycle_state;size:32;not null"`
	CommentsCount             int64      `gorm:"column:comments_count;not null;default:0"`
	ReactionsCount            int64      `gorm:"column:reactions_count;not null;default:0"`
	CreatedAt                 time.Time  `gorm:"column:created_at;not null;index:idx_social_private_post_author_created"`
	UpdatedAt                 time.Time  `gorm:"column:updated_at;not null"`
	DeletedAt                 *time.Time `gorm:"column:deleted_at;index"`
}

func (SocialPrivateContentPost) TableName() string {
	return "social_private_posts"
}

// SocialPrivateContentComment is the encrypted private Comment fact.
type SocialPrivateContentComment struct {
	CommentID string `gorm:"column:comment_id;primaryKey;size:128"`
	ContentID string `gorm:"column:content_id;size:128;not null;uniqueIndex:uidx_social_private_comment_content"`

	PostID                    string     `gorm:"column:post_id;size:128;not null;index:idx_social_private_comment_post_created"`
	ReplyToCommentID          string     `gorm:"column:reply_to_comment_id;size:128"`
	AuthorPTID                string     `gorm:"column:author_ptid;size:255;not null;index"`
	Generation                uint64     `gorm:"column:generation;not null"`
	InteractionSnapshotID     string     `gorm:"column:interaction_snapshot_id;size:128;not null"`
	EncryptedPayloadBytes     []byte     `gorm:"column:encrypted_payload_bytes;not null"`
	EncryptedPayloadSHA256    []byte     `gorm:"column:encrypted_payload_sha256;not null"`
	ObjectDescriptorSetSHA256 []byte     `gorm:"column:object_descriptor_set_sha256;not null"`
	MentionRoutingBytes       []byte     `gorm:"column:mention_routing_bytes"`
	MentionRoutingSHA256      []byte     `gorm:"column:mention_routing_sha256"`
	LifecycleState            string     `gorm:"column:lifecycle_state;size:32;not null"`
	ReactionsCount            int64      `gorm:"column:reactions_count;not null;default:0"`
	RepliesCount              int64      `gorm:"column:replies_count;not null;default:0"`
	CreatedAt                 time.Time  `gorm:"column:created_at;not null;index:idx_social_private_comment_post_created"`
	UpdatedAt                 time.Time  `gorm:"column:updated_at;not null"`
	DeletedAt                 *time.Time `gorm:"column:deleted_at;index"`
}

func (SocialPrivateContentComment) TableName() string {
	return "social_private_comments"
}

type SocialPrivateAudienceSnapshot struct {
	SnapshotID string `gorm:"column:snapshot_id;primaryKey;size:128"`

	ResourceKind            string    `gorm:"column:resource_kind;size:16;not null;uniqueIndex:uidx_social_private_snapshot_resource,priority:1"`
	ResourceID              string    `gorm:"column:resource_id;size:128;not null;uniqueIndex:uidx_social_private_snapshot_resource,priority:2"`
	PostID                  string    `gorm:"column:post_id;size:128;not null;index"`
	AudienceKind            string    `gorm:"column:audience_kind;size:32;not null"`
	AudienceTarget          string    `gorm:"column:audience_target_id;size:128"`
	SourceRevision          uint64    `gorm:"column:source_revision;not null"`
	CanonicalSnapshotSHA256 []byte    `gorm:"column:canonical_snapshot_sha256;not null"`
	CreatedAt               time.Time `gorm:"column:created_at;not null"`
}

func (SocialPrivateAudienceSnapshot) TableName() string {
	return "social_private_audience_snapshots"
}

type SocialPrivateRecipientGrant struct {
	SnapshotID    string `gorm:"column:snapshot_id;primaryKey;size:128"`
	RecipientPTID string `gorm:"column:recipient_ptid;primaryKey;size:255"`

	GrantedAt    time.Time  `gorm:"column:granted_at;not null"`
	RevokedAt    *time.Time `gorm:"column:revoked_at;index"`
	RevokeReason string     `gorm:"column:revoke_reason;size:64"`
}

func (SocialPrivateRecipientGrant) TableName() string {
	return "social_private_recipient_grants"
}

type SocialPrivateContentEnvelope struct {
	ContentID         string `gorm:"column:content_id;primaryKey;size:128"`
	KeyKind           string `gorm:"column:key_kind;primaryKey;size:32"`
	RecipientPTID     string `gorm:"column:recipient_ptid;primaryKey;size:255"`
	RecipientDeviceID string `gorm:"column:recipient_device_id;primaryKey;size:128"`
	OneTimeKeyID      string `gorm:"column:one_time_key_id;primaryKey;size:128"`

	PlanID                 string    `gorm:"column:plan_id;size:128;not null;index"`
	RecipientSlotID        string    `gorm:"column:recipient_slot_id;size:128;not null"`
	PrincipalEpoch         uint64    `gorm:"column:principal_epoch;not null"`
	PreparedEnvelopeBytes  []byte    `gorm:"column:prepared_envelope_bytes;not null"`
	CanonicalPlanSHA256    []byte    `gorm:"column:canonical_plan_sha256;not null"`
	PrincipalBindingSHA256 []byte    `gorm:"column:principal_binding_sha256;not null"`
	BindingSHA256          []byte    `gorm:"column:binding_sha256;not null"`
	EnvelopeSHA256         []byte    `gorm:"column:envelope_sha256;not null"`
	SenderSignatureSHA256  []byte    `gorm:"column:sender_signature_sha256;not null"`
	CreatedAt              time.Time `gorm:"column:created_at;not null"`
}

func (SocialPrivateContentEnvelope) TableName() string {
	return "social_private_content_envelopes"
}

type SocialPrivateDeliveryIntent struct {
	IntentID string `gorm:"column:intent_id;primaryKey;size:128"`

	ContentID         string    `gorm:"column:content_id;size:128;not null;index"`
	DomainCommitID    string    `gorm:"column:domain_commit_id;size:128;not null;index"`
	RecipientPTID     string    `gorm:"column:recipient_ptid;size:255;not null"`
	RecipientDeviceID string    `gorm:"column:recipient_device_id;size:128;not null"`
	IdempotencyKey    string    `gorm:"column:idempotency_key;size:255;not null;uniqueIndex:uidx_social_private_delivery_idempotency"`
	OpaquePayload     []byte    `gorm:"column:opaque_payload;not null"`
	PayloadSHA256     []byte    `gorm:"column:payload_sha256;not null"`
	State             string    `gorm:"column:state;size:32;not null;index"`
	CreatedAt         time.Time `gorm:"column:created_at;not null"`
}

func (SocialPrivateDeliveryIntent) TableName() string {
	return "social_private_delivery_intents"
}

type SocialPrivateObjectUpload struct {
	UploadID   string `gorm:"column:upload_id;primaryKey;size:128"`
	Generation uint64 `gorm:"column:generation;primaryKey"`

	PlanID                     string `gorm:"column:plan_id;size:128;not null;index"`
	ObjectID                   string `gorm:"column:object_id;size:128;not null;uniqueIndex:uidx_social_private_upload_object"`
	ContentID                  string `gorm:"column:content_id;size:128;not null;index"`
	UploaderPTID               string `gorm:"column:uploader_ptid;size:255;not null;uniqueIndex:uidx_social_private_upload_begin,priority:1"`
	UploaderDeviceID           string `gorm:"column:uploader_device_id;size:128;not null"`
	UploadSpecBytes            []byte `gorm:"column:upload_spec_bytes;not null"`
	UploadSpecSHA256           []byte `gorm:"column:upload_spec_sha256;not null"`
	DescriptorCommitmentSHA256 []byte `gorm:"column:descriptor_commitment_sha256;not null"`
	BeginCommandID             string `gorm:"column:begin_command_id;size:128;not null;uniqueIndex:uidx_social_private_upload_begin,priority:2"`
	BeginCommandBytes          []byte `gorm:"column:begin_command_bytes;not null"`
	BeginCommandSHA256         []byte `gorm:"column:begin_command_sha256;not null"`
	ReceivedChunkBitmap        []byte `gorm:"column:received_chunk_bitmap;not null"`
	State                      string `gorm:"column:state;size:32;not null;index"`

	CompleteCommandID       string     `gorm:"column:complete_command_id;size:128"`
	CompleteCommandBytes    []byte     `gorm:"column:complete_command_bytes"`
	CompleteCommandSHA256   []byte     `gorm:"column:complete_command_sha256"`
	CompleteResponseBytes   []byte     `gorm:"column:complete_response_bytes"`
	CompleteResponseSHA256  []byte     `gorm:"column:complete_response_sha256"`
	CancelCommandID         string     `gorm:"column:cancel_command_id;size:128"`
	CancelCommandBytes      []byte     `gorm:"column:cancel_command_bytes"`
	CancelCommandSHA256     []byte     `gorm:"column:cancel_command_sha256"`
	FinalStorageKey         string     `gorm:"column:final_storage_key;size:512"`
	VerificationLeaseOwner  string     `gorm:"column:verification_lease_owner;size:128"`
	VerificationLeaseEpoch  uint64     `gorm:"column:verification_lease_epoch;not null;default:0"`
	VerificationLeaseExpiry *time.Time `gorm:"column:verification_lease_expires_at;index"`
	VerificationAttempts    uint32     `gorm:"column:verification_attempts;not null;default:0"`
	VerificationNextAttempt *time.Time `gorm:"column:verification_next_attempt_at;index"`
	TerminalReason          string     `gorm:"column:terminal_reason;size:64"`
	CleanupLeaseOwner       string     `gorm:"column:cleanup_lease_owner;size:128"`
	CleanupLeaseEpoch       uint64     `gorm:"column:cleanup_lease_epoch;not null;default:0"`
	CleanupLeaseExpiry      *time.Time `gorm:"column:cleanup_lease_expires_at;index"`
	CleanupAttempts         uint32     `gorm:"column:cleanup_attempts;not null;default:0"`
	CleanupNextAttempt      *time.Time `gorm:"column:cleanup_next_attempt_at;index"`
	ExpiresAt               time.Time  `gorm:"column:expires_at;not null;index"`
	CreatedAt               time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt               time.Time  `gorm:"column:updated_at;not null"`
	TombstonedAt            *time.Time `gorm:"column:tombstoned_at;index"`
}

func (SocialPrivateObjectUpload) TableName() string {
	return "social_private_object_uploads"
}

type SocialPrivateObjectChunk struct {
	UploadID   string `gorm:"column:upload_id;primaryKey;size:128;uniqueIndex:uidx_social_private_object_part_command,priority:1"`
	Generation uint64 `gorm:"column:generation;primaryKey;uniqueIndex:uidx_social_private_object_part_command,priority:2"`
	ChunkIndex uint32 `gorm:"column:chunk_index;primaryKey"`

	Offset                 uint64     `gorm:"column:offset;not null"`
	Size                   uint64     `gorm:"column:size;not null"`
	CiphertextSHA256       []byte     `gorm:"column:ciphertext_sha256;not null"`
	IdempotencyKey         string     `gorm:"column:idempotency_key;size:128;not null;uniqueIndex:uidx_social_private_object_part_command,priority:3"`
	CanonicalCommandSHA256 []byte     `gorm:"column:canonical_command_sha256;not null"`
	StorageKey             string     `gorm:"column:storage_key;size:512;not null;uniqueIndex:uidx_social_private_object_part_storage"`
	State                  string     `gorm:"column:state;size:16;not null;index"`
	LeaseOwner             string     `gorm:"column:lease_owner;size:128"`
	LeaseEpoch             uint64     `gorm:"column:lease_epoch;not null;default:0"`
	LeaseExpiresAt         *time.Time `gorm:"column:lease_expires_at;index"`
	Attempts               uint32     `gorm:"column:attempts;not null;default:0"`
	NextAttemptAt          *time.Time `gorm:"column:next_attempt_at;index"`
	StoredAt               *time.Time `gorm:"column:stored_at"`
	CreatedAt              time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt              time.Time  `gorm:"column:updated_at;not null"`
}

func (SocialPrivateObjectChunk) TableName() string {
	return "social_private_object_parts"
}

// SocialPrivateObjectAttachment is the committed object descriptor and its
// attachment lifecycle. The encrypted bytes remain in object storage.
type SocialPrivateObjectAttachment struct {
	ObjectID string `gorm:"column:object_id;primaryKey;size:128"`

	UploadID                 string     `gorm:"column:upload_id;size:128;not null;uniqueIndex:uidx_social_private_object_upload,priority:1"`
	UploadGeneration         uint64     `gorm:"column:upload_generation;not null;uniqueIndex:uidx_social_private_object_upload,priority:2"`
	ContentID                string     `gorm:"column:content_id;size:128;not null;index"`
	UploaderPTID             string     `gorm:"column:uploader_ptid;size:255;not null"`
	UploaderDeviceID         string     `gorm:"column:uploader_device_id;size:128;not null"`
	CanonicalDescriptorBytes []byte     `gorm:"column:canonical_descriptor_bytes;not null"`
	DescriptorSHA256         []byte     `gorm:"column:descriptor_sha256;not null"`
	StorageKey               string     `gorm:"column:storage_key;size:512;not null;uniqueIndex:uidx_social_private_object_storage"`
	TotalCiphertextSize      uint64     `gorm:"column:total_ciphertext_size;not null"`
	CiphertextSHA256         []byte     `gorm:"column:ciphertext_sha256;not null"`
	State                    string     `gorm:"column:state;size:32;not null;index"`
	DomainCommitID           string     `gorm:"column:domain_commit_id;size:128;index"`
	CreatedAt                time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt                time.Time  `gorm:"column:updated_at;not null"`
	ExpiresAt                time.Time  `gorm:"column:expires_at;not null;index"`
	AttachedAt               *time.Time `gorm:"column:attached_at"`
	CleanupLeaseOwner        string     `gorm:"column:cleanup_lease_owner;size:128"`
	CleanupLeaseEpoch        uint64     `gorm:"column:cleanup_lease_epoch;not null;default:0"`
	CleanupLeaseExpiry       *time.Time `gorm:"column:cleanup_lease_expires_at;index"`
	CleanupAttempts          uint32     `gorm:"column:cleanup_attempts;not null;default:0"`
	CleanupNextAttempt       *time.Time `gorm:"column:cleanup_next_attempt_at;index"`
	TombstonedAt             *time.Time `gorm:"column:tombstoned_at;index"`
}

func (SocialPrivateObjectAttachment) TableName() string {
	return "social_private_objects"
}

type SocialPrivateObjectGrant struct {
	ObjectID          string `gorm:"column:object_id;primaryKey;size:128"`
	PrincipalKind     string `gorm:"column:principal_kind;primaryKey;size:32"`
	PrincipalPTID     string `gorm:"column:principal_ptid;primaryKey;size:255"`
	PrincipalDeviceID string `gorm:"column:principal_device_id;primaryKey;size:128"`

	DomainCommitID string     `gorm:"column:domain_commit_id;size:128;not null;index"`
	GrantedAt      time.Time  `gorm:"column:granted_at;not null"`
	RevokedAt      *time.Time `gorm:"column:revoked_at;index"`
	RevokeReason   string     `gorm:"column:revoke_reason;size:64"`
}

func (SocialPrivateObjectGrant) TableName() string {
	return "social_private_object_grants"
}

type SocialPrivateCommitProof struct {
	ContentID  string `gorm:"column:content_id;primaryKey;size:128"`
	Generation uint64 `gorm:"column:generation;primaryKey"`

	DomainCommitID       string    `gorm:"column:domain_commit_id;size:128;not null;uniqueIndex:uidx_social_private_commit_proof_commit"`
	ResourceKind         string    `gorm:"column:resource_kind;size:16;not null"`
	CanonicalProofBytes  []byte    `gorm:"column:canonical_proof_bytes;not null"`
	CanonicalProofSHA256 []byte    `gorm:"column:canonical_proof_sha256;not null"`
	StationSigningKeyID  string    `gorm:"column:station_signing_key_id;size:128;not null"`
	CommittedAt          time.Time `gorm:"column:committed_at;not null"`
}

func (SocialPrivateCommitProof) TableName() string {
	return "social_private_commit_proofs"
}

// SocialPrivateContentModels returns the complete W6 private persistence
// substrate for explicit, owner-controlled migrations.
func SocialPrivateContentModels() []any {
	return []any{
		&SocialPrivateContentPlan{},
		&SocialPrivateContentPlanSlot{},
		&SocialPrivateCommandReceipt{},
		&SocialPrivateContentPost{},
		&SocialPrivateContentComment{},
		&SocialPrivateAudienceSnapshot{},
		&SocialPrivateRecipientGrant{},
		&SocialPrivateContentEnvelope{},
		&SocialPrivateDeliveryIntent{},
		&SocialPrivateObjectUpload{},
		&SocialPrivateObjectChunk{},
		&SocialPrivateObjectAttachment{},
		&SocialPrivateObjectGrant{},
		&SocialPrivateCommitProof{},
	}
}
