package securecontent

import "time"

const (
	FormatVersion uint32 = 1

	SHA256Size                  = 32
	AES256GCMNonceSize          = 12
	AES256GCMTagSize            = 16
	X25519PublicKeySize         = 32
	Ed25519SignatureSize        = 64
	ObjectChunkSize      uint32 = 1024 * 1024

	MaximumPayloadCiphertextSize  uint64 = 1024 * 1024
	MaximumObjectChunkCount       uint32 = 2048
	MaximumObjectPlaintextSize    uint64 = 2 * 1024 * 1024 * 1024
	MaximumObjectsPerResource            = 10
	MaximumRecipientActors               = 256
	MaximumRecipientSlots                = 1000
	MaximumEnvelopeBytes                 = 4 * 1024 * 1024
	MaximumActivePlanCount               = 4
	MaximumActiveUploadCount             = 4
	MaximumConcurrentPartCount           = 4
	MaximumRecoveryPageSize              = 100
	MaximumIdentifierLength              = 256
	MaximumStorageReferenceLength        = 512

	MaximumUploadTTL                = 24 * time.Hour
	MaximumUnattachedObjectTTL      = 24 * time.Hour
	MaximumPlanLifetime             = 5 * time.Minute
	MaximumVerificationLeaseTTL     = time.Hour
	MaximumVerificationAttemptCount = 3
	MaximumCleanupLeaseTTL          = 5 * time.Minute
	MaximumCleanupBatchSize         = 100
	MaximumCleanupAttemptCount      = 10
	MinimumCleanupRetryDelay        = time.Second
	MaximumCleanupRetryDelay        = 5 * time.Minute
)

// Policy contains only bounded, domain-neutral Secure Content limits.
type Policy struct {
	MaximumPayloadCiphertextSize uint64
	ObjectChunkSize              uint32
	ObjectTagSize                uint32
	MaximumObjectChunkCount      uint32
	MaximumObjectPlaintextSize   uint64
	MaximumObjectsPerResource    int
	MaximumRecipientActors       int
	MaximumRecipientSlots        int
	MaximumEnvelopeBytes         int
	MaximumActivePlans           int
	MaximumActiveUploads         int
	MaximumConcurrentParts       int
	MaximumRecoveryPageSize      int
	MaximumPlanLifetime          time.Duration
	MaximumUploadTTL             time.Duration
	MaximumUnattachedObjectTTL   time.Duration
}

// DefaultPolicy returns an immutable-by-value copy of the accepted v1 limits.
func DefaultPolicy() Policy {
	return Policy{
		MaximumPayloadCiphertextSize: MaximumPayloadCiphertextSize,
		ObjectChunkSize:              ObjectChunkSize,
		ObjectTagSize:                AES256GCMTagSize,
		MaximumObjectChunkCount:      MaximumObjectChunkCount,
		MaximumObjectPlaintextSize:   MaximumObjectPlaintextSize,
		MaximumObjectsPerResource:    MaximumObjectsPerResource,
		MaximumRecipientActors:       MaximumRecipientActors,
		MaximumRecipientSlots:        MaximumRecipientSlots,
		MaximumEnvelopeBytes:         MaximumEnvelopeBytes,
		MaximumActivePlans:           MaximumActivePlanCount,
		MaximumActiveUploads:         MaximumActiveUploadCount,
		MaximumConcurrentParts:       MaximumConcurrentPartCount,
		MaximumRecoveryPageSize:      MaximumRecoveryPageSize,
		MaximumPlanLifetime:          MaximumPlanLifetime,
		MaximumUploadTTL:             MaximumUploadTTL,
		MaximumUnattachedObjectTTL:   MaximumUnattachedObjectTTL,
	}
}

// Validate rejects zero, negative, or widened policy values.
func (p Policy) Validate() error {
	if p.MaximumPayloadCiphertextSize == 0 ||
		p.MaximumPayloadCiphertextSize > MaximumPayloadCiphertextSize ||
		p.ObjectChunkSize != ObjectChunkSize ||
		p.ObjectTagSize != AES256GCMTagSize ||
		p.MaximumObjectChunkCount == 0 ||
		p.MaximumObjectChunkCount > MaximumObjectChunkCount ||
		p.MaximumObjectPlaintextSize == 0 ||
		p.MaximumObjectPlaintextSize > MaximumObjectPlaintextSize ||
		p.MaximumObjectsPerResource <= 0 ||
		p.MaximumObjectsPerResource > MaximumObjectsPerResource ||
		p.MaximumRecipientActors <= 0 ||
		p.MaximumRecipientActors > MaximumRecipientActors ||
		p.MaximumRecipientSlots <= 0 ||
		p.MaximumRecipientSlots > MaximumRecipientSlots ||
		p.MaximumEnvelopeBytes <= 0 ||
		p.MaximumEnvelopeBytes > MaximumEnvelopeBytes ||
		p.MaximumActivePlans <= 0 ||
		p.MaximumActivePlans > MaximumActivePlanCount ||
		p.MaximumActiveUploads <= 0 ||
		p.MaximumActiveUploads > MaximumActiveUploadCount ||
		p.MaximumConcurrentParts <= 0 ||
		p.MaximumConcurrentParts > MaximumConcurrentPartCount ||
		p.MaximumRecoveryPageSize <= 0 ||
		p.MaximumRecoveryPageSize > MaximumRecoveryPageSize ||
		p.MaximumPlanLifetime <= 0 ||
		p.MaximumPlanLifetime > MaximumPlanLifetime ||
		p.MaximumUploadTTL <= 0 ||
		p.MaximumUploadTTL > MaximumUploadTTL ||
		p.MaximumUnattachedObjectTTL <= 0 ||
		p.MaximumUnattachedObjectTTL > MaximumUnattachedObjectTTL {
		return NewError(
			ErrorCodeInvalidArgument,
			"securecontent.validate_policy",
			"policy",
			"must be positive and no wider than the accepted v1 bounds",
		)
	}

	return nil
}
