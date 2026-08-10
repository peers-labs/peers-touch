package domain

import (
	"errors"
	"testing"

	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

func validAttachmentUploadSpec() *chat.EncryptedObjectUploadSpec {
	return &chat.EncryptedObjectUploadSpec{
		CiphertextSize:   uint64(AttachmentChunkSize) + uint64(2*AttachmentTagSize) + 1,
		CiphertextSha256: make([]byte, 32),
		MediaType:        "application/octet-stream",
		ChunkSize:        AttachmentChunkSize,
		ChunkCount:       2,
		EncryptionSuite:  chat.AttachmentEncryptionSuite_ATTACHMENT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED,
		TagSize:          AttachmentTagSize,
		NonceStrategy:    chat.AttachmentNonceStrategy_ATTACHMENT_NONCE_STRATEGY_COUNTER32_BE,
		ChunkCiphertextSha256: [][]byte{
			make([]byte, 32),
			make([]byte, 32),
		},
	}
}

func TestValidateEncryptedObjectUploadSpec(t *testing.T) {
	if err := ValidateEncryptedObjectUploadSpec(validAttachmentUploadSpec()); err != nil {
		t.Fatalf("valid spec: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*chat.EncryptedObjectUploadSpec)
		want   error
	}{
		{
			name: "wrong hash length",
			mutate: func(spec *chat.EncryptedObjectUploadSpec) {
				spec.CiphertextSha256 = []byte{1}
			},
			want: ErrAttachmentDescriptor,
		},
		{
			name: "chunk hash count mismatch",
			mutate: func(spec *chat.EncryptedObjectUploadSpec) {
				spec.ChunkCiphertextSha256 = spec.ChunkCiphertextSha256[:1]
			},
			want: ErrAttachmentDescriptor,
		},
		{
			name: "size arithmetic mismatch",
			mutate: func(spec *chat.EncryptedObjectUploadSpec) {
				spec.CiphertextSize = 1
			},
			want: ErrAttachmentDescriptor,
		},
		{
			name: "chunk policy exceeded",
			mutate: func(spec *chat.EncryptedObjectUploadSpec) {
				spec.ChunkCount = AttachmentMaxChunkCount + 1
				spec.ChunkCiphertextSha256 = make([][]byte, spec.ChunkCount)
				for index := range spec.ChunkCiphertextSha256 {
					spec.ChunkCiphertextSha256[index] = make([]byte, 32)
				}
			},
			want: ErrAttachmentTooLarge,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			spec := validAttachmentUploadSpec()
			test.mutate(spec)
			if err := ValidateEncryptedObjectUploadSpec(spec); !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestValidateEncryptedObjectDescriptorRequiresAuthorityIdentity(t *testing.T) {
	spec := validAttachmentUploadSpec()
	descriptor := &chat.EncryptedObjectDescriptor{
		ObjectId:              "object-1",
		StorageRef:            "opaque/object-1",
		CiphertextSize:        spec.CiphertextSize,
		CiphertextSha256:      spec.CiphertextSha256,
		MediaType:             spec.MediaType,
		ChunkSize:             spec.ChunkSize,
		ChunkCount:            spec.ChunkCount,
		EncryptionSuite:       spec.EncryptionSuite,
		TagSize:               spec.TagSize,
		NonceStrategy:         spec.NonceStrategy,
		ChunkCiphertextSha256: spec.ChunkCiphertextSha256,
	}
	if err := ValidateEncryptedObjectDescriptor(descriptor); err != nil {
		t.Fatalf("valid descriptor: %v", err)
	}
	descriptor.ObjectId = ""
	if !errors.Is(ValidateEncryptedObjectDescriptor(descriptor), ErrAttachmentDescriptor) {
		t.Fatal("descriptor without object identity must fail")
	}
}
