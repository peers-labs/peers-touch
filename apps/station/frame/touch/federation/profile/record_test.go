package profile

import (
	"testing"
	"time"

	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

func TestActorProfileEnvelopeSignatureCoversDeviceSigningKeys(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	localKey, err := authfed.MintLocalKey(now)
	if err != nil {
		t.Fatal(err)
	}
	envelope, _, err := Sign(SignInput{
		Handle:            "alice@station-a.example",
		HomeStationPeerID: "station-a",
		HomeStationDomain: "station-a.example",
		Profile:           &model.ActorProfile{Username: "alice"},
		DeviceSigningKeys: []*model.VerifiedActorDeviceSigningKey{{
			ActorPtid:          "alice",
			ActorDeviceId:      "alice-device",
			HomeStationPeerId:  "station-a",
			SigningKeyId:       "alice-key",
			Ed25519PublicKey:   make([]byte, 32),
			ProfileVersion:     1,
			VerificationSource: model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_VERIFIED_PROFILE,
		}},
		Now:      now,
		LocalKey: localKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := Verify(envelope, VerifyOptions{
		ExpectedHandle:        "alice@station-a.example",
		ExpectedSigningKeyPEM: localKey.PubPEM,
		Now:                   now,
	}); err != nil {
		t.Fatalf("verify signed envelope: %v", err)
	}

	envelope.DeviceSigningKeys[0].SigningKeyId = "forged-key"
	if err := Verify(envelope, VerifyOptions{
		ExpectedHandle:        "alice@station-a.example",
		ExpectedSigningKeyPEM: localKey.PubPEM,
		Now:                   now,
	}); err == nil {
		t.Fatal("tampered device signing key passed envelope verification")
	}
}
