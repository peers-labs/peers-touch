package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	recordcrypto "github.com/peers-labs/peers-touch/oauth2-client/internal/infrastructure/crypto"
)

func encodedRecord(
	t *testing.T,
	codec *recordcrypto.Codec,
	kind, path string,
) encryptedRecord {
	t.Helper()
	payload, err := codec.Encrypt(kind, path, []byte(`{"schema_version":1}`))
	if err != nil {
		t.Fatal(err)
	}
	return encryptedRecord{
		Path:    path,
		Payload: base64.StdEncoding.EncodeToString(payload),
	}
}

func TestVerifyAuthenticatesActiveAndRetainedEnvelopes(t *testing.T) {
	v1 := bytes.Repeat([]byte{1}, 32)
	v2 := bytes.Repeat([]byte{2}, 32)
	oldCodec, err := recordcrypto.NewCodec("v1", map[string][]byte{"v1": v1})
	if err != nil {
		t.Fatal(err)
	}
	currentCodec, err := recordcrypto.NewCodec(
		"v2",
		map[string][]byte{"v1": v1, "v2": v2},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := verificationRequest{
		ActiveKeyID: "V2",
		Keys: map[string]string{
			"v1": base64.StdEncoding.EncodeToString(v1),
			"v2": base64.StdEncoding.EncodeToString(v2),
		},
		Records: []encryptedRecord{
			encodedRecord(
				t,
				oldCodec,
				"authorization-transaction",
				"oauth-data/transactions/old.json",
			),
			encodedRecord(
				t,
				currentCodec,
				"oauth-audit",
				"oauth-data/audits/2026/current.json",
			),
		},
	}

	result, err := verify(request)
	if err != nil {
		t.Fatal(err)
	}
	if result.RecordCount != 2 ||
		result.ActiveKeyEnvelopeCount != 1 ||
		result.RetainedKeyEnvelopeCount != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestVerifyRejectsTamperedEnvelope(t *testing.T) {
	key := bytes.Repeat([]byte{3}, 32)
	codec, err := recordcrypto.NewCodec("v1", map[string][]byte{"v1": key})
	if err != nil {
		t.Fatal(err)
	}
	record := encodedRecord(
		t,
		codec,
		"oauth-credential",
		"oauth-data/credentials/example.json",
	)
	payload, err := base64.StdEncoding.DecodeString(record.Payload)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope["ciphertext"] = strings.Repeat("A", 24)
	payload, err = json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	record.Payload = base64.StdEncoding.EncodeToString(payload)

	_, err = verify(verificationRequest{
		ActiveKeyID: "v1",
		Keys: map[string]string{
			"v1": base64.StdEncoding.EncodeToString(key),
		},
		Records: []encryptedRecord{record},
	})
	if err == nil {
		t.Fatal("tampered envelope unexpectedly authenticated")
	}
}
