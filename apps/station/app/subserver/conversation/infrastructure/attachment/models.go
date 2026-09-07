package attachment

import "time"

type UploadModel struct {
	UploadID                   string    `gorm:"column:upload_id;size:64;primaryKey"`
	Generation                 uint64    `gorm:"column:generation;not null"`
	ConversationID             string    `gorm:"column:conversation_id;size:128;not null;index"`
	MessageID                  string    `gorm:"column:message_id;size:128;not null"`
	AttachmentID               string    `gorm:"column:attachment_id;size:128;not null"`
	UploaderPTID               string    `gorm:"column:uploader_ptid;size:255;not null;uniqueIndex:uidx_conversation_attachment_upload_idempotency,priority:1"`
	UploaderDeviceID           string    `gorm:"column:uploader_device_id;size:255;not null;uniqueIndex:uidx_conversation_attachment_upload_idempotency,priority:2"`
	CiphertextSize             uint64    `gorm:"column:ciphertext_size;not null"`
	CiphertextSHA256           []byte    `gorm:"column:ciphertext_sha256;type:bytea;not null"`
	MediaType                  string    `gorm:"column:media_type;size:255;not null"`
	ChunkSize                  uint32    `gorm:"column:chunk_size;not null"`
	ChunkCount                 uint32    `gorm:"column:chunk_count;not null"`
	EncryptionSuite            int32     `gorm:"column:encryption_suite;not null"`
	TagSize                    uint32    `gorm:"column:tag_size;not null"`
	NonceStrategy              int32     `gorm:"column:nonce_strategy;not null"`
	ChunkCiphertextSHA256      []byte    `gorm:"column:chunk_ciphertext_sha256;type:bytea;not null"`
	DescriptorCommitmentSHA256 []byte    `gorm:"column:descriptor_commitment_sha256;type:bytea;not null"`
	IdempotencyKey             string    `gorm:"column:idempotency_key;size:128;not null;uniqueIndex:uidx_conversation_attachment_upload_idempotency,priority:3"`
	State                      int32     `gorm:"column:state;not null;index"`
	ReceivedChunkBitmap        []byte    `gorm:"column:received_chunk_bitmap;type:bytea;not null"`
	ObjectID                   string    `gorm:"column:object_id;size:64"`
	StorageRef                 string    `gorm:"column:storage_ref;size:128"`
	ExpiresAt                  time.Time `gorm:"column:expires_at;not null;index"`
	CreatedAt                  time.Time `gorm:"column:created_at;not null"`
	UpdatedAt                  time.Time `gorm:"column:updated_at;not null"`
}

func (*UploadModel) TableName() string {
	return "conversation_attachment_uploads"
}

type UploadPartModel struct {
	UploadID         string    `gorm:"column:upload_id;size:64;primaryKey"`
	Generation       uint64    `gorm:"column:generation;primaryKey"`
	ChunkIndex       uint32    `gorm:"column:chunk_index;primaryKey"`
	ByteOffset       uint64    `gorm:"column:byte_offset;not null"`
	CiphertextSize   uint64    `gorm:"column:ciphertext_size;not null"`
	CiphertextSHA256 []byte    `gorm:"column:ciphertext_sha256;type:bytea;not null"`
	StorageKey       string    `gorm:"column:storage_key;size:255;not null"`
	CreatedAt        time.Time `gorm:"column:created_at;not null"`
}

func (*UploadPartModel) TableName() string {
	return "conversation_attachment_upload_parts"
}

type ObjectModel struct {
	ObjectID                   string    `gorm:"column:object_id;size:64;primaryKey"`
	StorageRef                 string    `gorm:"column:storage_ref;size:128;not null;uniqueIndex"`
	StorageKey                 string    `gorm:"column:storage_key;size:255;not null"`
	ConversationID             string    `gorm:"column:conversation_id;size:128;not null;index"`
	MessageID                  string    `gorm:"column:message_id;size:128;not null"`
	AttachmentID               string    `gorm:"column:attachment_id;size:128;not null"`
	UploaderPTID               string    `gorm:"column:uploader_ptid;size:255;not null"`
	CiphertextSize             uint64    `gorm:"column:ciphertext_size;not null"`
	CiphertextSHA256           []byte    `gorm:"column:ciphertext_sha256;type:bytea;not null"`
	MediaType                  string    `gorm:"column:media_type;size:255;not null"`
	ChunkSize                  uint32    `gorm:"column:chunk_size;not null"`
	ChunkCount                 uint32    `gorm:"column:chunk_count;not null"`
	EncryptionSuite            int32     `gorm:"column:encryption_suite;not null"`
	TagSize                    uint32    `gorm:"column:tag_size;not null"`
	NonceStrategy              int32     `gorm:"column:nonce_strategy;not null"`
	ChunkCiphertextSHA256      []byte    `gorm:"column:chunk_ciphertext_sha256;type:bytea;not null"`
	DescriptorCommitmentSHA256 []byte    `gorm:"column:descriptor_commitment_sha256;type:bytea;not null"`
	EventID                    string    `gorm:"column:event_id;size:128;index"`
	State                      string    `gorm:"column:state;size:32;not null;index"`
	CreatedAt                  time.Time `gorm:"column:created_at;not null"`
}

func (*ObjectModel) TableName() string {
	return "conversation_attachment_objects"
}

type GrantModel struct {
	ObjectID       string    `gorm:"column:object_id;size:64;primaryKey"`
	ConversationID string    `gorm:"column:conversation_id;size:128;primaryKey"`
	RecipientPTID  string    `gorm:"column:recipient_ptid;size:255;primaryKey"`
	MessageID      string    `gorm:"column:message_id;size:128;not null"`
	EventID        string    `gorm:"column:event_id;size:128;not null;index"`
	GrantedAt      time.Time `gorm:"column:granted_at;not null"`
}

func (*GrantModel) TableName() string {
	return "conversation_attachment_grants"
}

type AuditModel struct {
	AuditID        string    `gorm:"column:audit_id;size:64;primaryKey"`
	Action         string    `gorm:"column:action;size:32;not null;index:idx_conversation_attachment_audit_metric,priority:1"`
	Outcome        string    `gorm:"column:outcome;size:32;not null;index:idx_conversation_attachment_audit_metric,priority:2"`
	ConversationID string    `gorm:"column:conversation_id;size:128;index"`
	MessageID      string    `gorm:"column:message_id;size:128"`
	AttachmentID   string    `gorm:"column:attachment_id;size:128"`
	UploadID       string    `gorm:"column:upload_id;size:64;index"`
	ObjectID       string    `gorm:"column:object_id;size:64;index"`
	EventID        string    `gorm:"column:event_id;size:128;index"`
	ActorPTID      string    `gorm:"column:actor_ptid;size:255"`
	DeviceID       string    `gorm:"column:device_id;size:255"`
	ChunkIndex     uint32    `gorm:"column:chunk_index;not null"`
	ByteCount      uint64    `gorm:"column:byte_count;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;not null;index"`
}

func (*AuditModel) TableName() string {
	return "conversation_attachment_audits"
}
