package securecontent

import (
	"bytes"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"google.golang.org/protobuf/proto"
)

func readCanonicalVector(t *testing.T, name string) []byte {
	t.Helper()

	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve contract test source")
	}
	path := filepath.Join(
		filepath.Dir(source),
		"..", "..", "..", "..", "..", "..",
		"model", "domain", "secure_content", "testdata", name+".hex",
	)
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read canonical vector %s: %v", name, err)
	}
	decoded, err := hex.DecodeString(string(bytes.TrimSpace(encoded)))
	if err != nil {
		t.Fatalf("decode canonical vector %s: %v", name, err)
	}
	return decoded
}

func requireSemanticRoundTrip(t *testing.T, message proto.Message) {
	t.Helper()

	reencoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		t.Fatalf("marshal canonical vector: %v", err)
	}
	roundTrip := message.ProtoReflect().Type().New().Interface()
	if err := proto.Unmarshal(reencoded, roundTrip); err != nil {
		t.Fatalf("unmarshal re-encoded vector: %v", err)
	}
	if !proto.Equal(message, roundTrip) {
		t.Fatalf("semantic round-trip changed: %x", reencoded)
	}
	secondEncoding, err := proto.MarshalOptions{Deterministic: true}.Marshal(roundTrip)
	if err != nil {
		t.Fatalf("marshal round-trip vector: %v", err)
	}
	if !bytes.Equal(reencoded, secondEncoding) {
		t.Fatalf("runtime deterministic encoding changed: %x != %x", reencoded, secondEncoding)
	}
}

func TestEncryptedPayloadCanonicalVector(t *testing.T) {
	encoded := readCanonicalVector(t, "encrypted_payload")

	var payload EncryptedPayload
	if err := proto.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal vector: %v", err)
	}

	if payload.GetFormatVersion() != 1 ||
		payload.GetResource().GetOwnerDomain() != SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		payload.GetResource().GetContentId() != "01HX" ||
		payload.GetResource().GetGeneration() != 7 ||
		payload.GetSuite() != PayloadEncryptionSuite_PAYLOAD_ENCRYPTION_SUITE_AES_256_GCM {
		t.Fatalf("decoded vector does not match the canonical payload: %+v", &payload)
	}

	if !proto.Equal(&payload, &EncryptedPayload{
		FormatVersion: 1,
		Resource: &SecureResourceRef{
			OwnerDomain: SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:   "01HX",
			Generation:  7,
		},
		Suite:            PayloadEncryptionSuite_PAYLOAD_ENCRYPTION_SUITE_AES_256_GCM,
		Nonce:            []byte{1, 2, 3},
		Ciphertext:       []byte{0xaa, 0xbb},
		CiphertextSha256: []byte{0xcc},
		AadSha256:        []byte{0xdd},
	}) {
		t.Fatal("decoded vector fields differ from the expected payload")
	}
	requireSemanticRoundTrip(t, &payload)
}

func TestViewerContentKeyEnvelopeCanonicalVector(t *testing.T) {
	encoded := readCanonicalVector(t, "viewer_content_key_envelope")

	var envelope ViewerContentKeyEnvelope
	if err := proto.Unmarshal(encoded, &envelope); err != nil {
		t.Fatalf("unmarshal vector: %v", err)
	}
	if envelope.GetBinding().GetFormatVersion() != 1 ||
		envelope.GetBinding().GetPlanId() != "plan-1" ||
		envelope.GetBinding().GetResource().GetContentId() != "01HX" ||
		envelope.GetEndpoint().GetActor().GetPtid() != "did:plc:bob" ||
		envelope.GetEndpoint().GetDeviceId() != "device-b" ||
		envelope.GetPrincipalEpoch() != 9 {
		t.Fatalf("decoded vector does not match the canonical envelope: %+v", &envelope)
	}
	requireSemanticRoundTrip(t, &envelope)
}

func TestEncryptedObjectDescriptorCanonicalVector(t *testing.T) {
	encoded := readCanonicalVector(t, "encrypted_object_descriptor")

	var descriptor EncryptedObjectDescriptor
	if err := proto.Unmarshal(encoded, &descriptor); err != nil {
		t.Fatalf("unmarshal vector: %v", err)
	}
	if descriptor.GetObjectId() != "obj-1" ||
		descriptor.GetStorageRef() != "secure://obj-1" ||
		descriptor.GetCommitment().GetCiphertextSize() != 42 ||
		descriptor.GetCommitment().GetChunkSize() != 1_048_576 ||
		descriptor.GetCommitment().GetEncryptionSuite() != ObjectEncryptionSuite_OBJECT_ENCRYPTION_SUITE_AES_256_GCM_CHUNKED ||
		descriptor.GetCommitment().GetNonceStrategy() != ObjectNonceStrategy_OBJECT_NONCE_STRATEGY_COUNTER32_BE {
		t.Fatalf("decoded vector does not match the canonical descriptor: %+v", &descriptor)
	}
	requireSemanticRoundTrip(t, &descriptor)
}
