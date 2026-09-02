package service

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	proofTestActorID      = "actor-proof-test"
	proofTestDeviceID     = "device-proof-test"
	proofTestSigningKeyID = "signing-key-proof-test"
)

type deterministicDeviceSigningKeyResolver struct {
	key *touchmodel.VerifiedActorDeviceSigningKey
	err error

	mu           sync.Mutex
	actorID      string
	deviceID     string
	signingKeyID string
}

func (r *deterministicDeviceSigningKeyResolver) ResolveSigningKey(
	_ context.Context,
	actorID string,
	deviceID string,
	signingKeyID string,
) (*touchmodel.VerifiedActorDeviceSigningKey, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.actorID = actorID
	r.deviceID = deviceID
	r.signingKeyID = signingKeyID
	return r.key, r.err
}

func TestClientCapabilityProofServiceVerifyAllCommandDomains(t *testing.T) {
	now := time.Date(2026, time.August, 22, 12, 0, 0, 123_000_000, time.UTC)
	publicKey, privateKey := deterministicProofTestKey()

	tests := []struct {
		name    string
		domain  model.ClientCapabilityCommandDomain
		request proto.Message
	}{
		{
			name:   "register lease",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE,
			request: &model.RegisterClientCapabilityLeaseRequest{
				Advertisement: &model.ClientCapabilityAdvertisement{
					AdvertisementId:    "advertisement-1",
					DeviceId:           proofTestDeviceID,
					DeviceSigningKeyId: proofTestSigningKeyID,
				},
			},
		},
		{
			name:   "renew lease",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE,
			request: &model.RenewClientCapabilityLeaseRequest{
				CapabilitySessionId:   "session-1",
				LeaseId:               "lease-1",
				ExpectedLeaseRevision: 2,
				CapabilitySetHash:     "capability-set-1",
				DeviceSigningKeyId:    proofTestSigningKeyID,
			},
		},
		{
			name:   "revoke lease",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REVOKE_LEASE,
			request: &model.RevokeClientCapabilityLeaseRequest{
				CapabilitySessionId:   "session-1",
				LeaseId:               "lease-1",
				ExpectedLeaseRevision: 2,
				Reason:                model.ClientCapabilityLeaseRevokeReason_CLIENT_CAPABILITY_LEASE_REVOKE_REASON_USER_LOGOUT,
			},
		},
		{
			name:   "pull requests",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
			request: &model.PullClientCapabilityRequestsRequest{
				CapabilitySessionId: "session-1",
				DeviceId:            proofTestDeviceID,
				AfterSequence:       7,
				Limit:               20,
			},
		},
		{
			name:   "submit active receipt",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_SUBMIT_ACTIVE_RECEIPT,
			request: &model.SubmitClientCapabilityReceiptRequest{
				Receipt: &model.ClientCapabilityReceipt{
					RequestId:      "request-1",
					TargetDeviceId: proofTestDeviceID,
					ResultId:       "result-1",
				},
			},
		},
		{
			name:   "pull operations",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_OPERATIONS,
			request: &model.PullCapabilityOperationsRequest{
				CapabilitySessionId: "session-1",
				DeviceId:            proofTestDeviceID,
				AfterSequence:       4,
				Limit:               20,
			},
		},
		{
			name:   "report operation event",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REPORT_OPERATION_EVENT,
			request: &model.ReportCapabilityOperationEventRequest{
				TargetDeviceId: proofTestDeviceID,
				Event: &model.CapabilityOperationEvent{
					OperationId:  "operation-1",
					AttemptEpoch: 1,
					Sequence:     2,
					FencingToken: 3,
				},
			},
		},
		{
			name:   "take over operation",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_TAKE_OVER_OPERATION,
			request: &model.TakeOverCapabilityOperationRequest{
				OperationId: "operation-1", ExpectedRevision: 2,
				TargetDeviceId: proofTestDeviceID, CapabilitySessionId: "session-1",
			},
		},
		{
			name:   "take over cleanup",
			domain: model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_TAKE_OVER_CLEANUP,
			request: &model.TakeOverCapabilityCleanupRequest{
				OperationId: "operation-1", ExpectedCleanupEpoch: 1,
				TargetDeviceId: proofTestDeviceID, CapabilitySessionId: "session-1",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resolver := &deterministicDeviceSigningKeyResolver{
				key: verifiedProofTestKey(publicKey),
			}
			proof, expectedBodyHash := signCapabilityCommandForTest(
				t,
				test.request,
				test.domain,
				now,
				privateKey,
			)
			attachCapabilityCommandProofForTest(t, test.request, proof)

			service := NewClientCapabilityProofService(resolver, nil, func() time.Time { return now })
			verified, err := service.Verify(
				context.Background(),
				proofTestActorID,
				proofTestDeviceID,
				test.domain,
				test.request,
				proof,
			)
			if err != nil {
				t.Fatalf("Verify() error = %v", err)
			}

			expectedNonceHash := sha256.Sum256(proof.GetNonce())
			if verified.CommandID != proof.GetCommandId() ||
				verified.DeviceID != proofTestDeviceID ||
				verified.SigningKeyID != proofTestSigningKeyID ||
				verified.NonceHash != hex.EncodeToString(expectedNonceHash[:]) ||
				verified.BodyHash != hex.EncodeToString(expectedBodyHash[:]) ||
				!verified.IssuedAt.Equal(now) {
				t.Fatalf("Verify() result = %+v", verified)
			}
			if resolver.actorID != proofTestActorID ||
				resolver.deviceID != proofTestDeviceID ||
				resolver.signingKeyID != proofTestSigningKeyID {
				t.Fatalf(
					"ResolveSigningKey() args = (%q, %q, %q)",
					resolver.actorID,
					resolver.deviceID,
					resolver.signingKeyID,
				)
			}
			if commandProofForTest(t, test.request) != proof {
				t.Fatal("Verify() mutated the request command proof")
			}
		})
	}
}

func TestClientCapabilityProofServiceRejectsInvalidProofs(t *testing.T) {
	now := time.Date(2026, time.August, 22, 12, 0, 0, 0, time.UTC)
	publicKey, privateKey := deterministicProofTestKey()

	tests := []struct {
		name       string
		prepare    func(*testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string)
		expectCode model.ClientCapabilityCommandErrorCode
	}{
		{
			name: "proof required",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				return proofTestResolver(publicKey), proofTestPullRequest(), nil,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_REQUIRED,
		},
		{
			name: "nonce size",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				proof.Nonce = proof.Nonce[:clientCapabilityCommandNonceSize-1]
				return proofTestResolver(publicKey), request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
		},
		{
			name: "signature size",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				proof.Signature = proof.Signature[:ed25519.SignatureSize-1]
				return proofTestResolver(publicKey), request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
		},
		{
			name: "expired timestamp",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now.Add(-60*time.Second-time.Nanosecond), privateKey)
				return proofTestResolver(publicKey), request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_EXPIRED,
		},
		{
			name: "future timestamp",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now.Add(60*time.Second+time.Nanosecond), privateKey)
				return proofTestResolver(publicKey), request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_EXPIRED,
		},
		{
			name: "domain mismatch",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				return proofTestResolver(publicKey), request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
		},
		{
			name: "body tampering",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				request.(*model.PullClientCapabilityRequestsRequest).AfterSequence++
				return proofTestResolver(publicKey), request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
		},
		{
			name: "request device mismatch",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				return proofTestResolver(publicKey), request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					"other-device"
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
		},
		{
			name: "resolver failure",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				resolver := proofTestResolver(publicKey)
				resolver.err = errors.New("key unavailable")
				return resolver, request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND,
		},
		{
			name: "revoked key",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				resolver := proofTestResolver(publicKey)
				resolver.key.RevokedAtUnixMs = now.Add(-time.Minute).UnixMilli()
				return resolver, request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_DEVICE_KEY_REVOKED,
		},
		{
			name: "resolved identity mismatch",
			prepare: func(t *testing.T) (*deterministicDeviceSigningKeyResolver, proto.Message, *model.ClientCapabilityCommandProof, model.ClientCapabilityCommandDomain, string) {
				request, proof := signedProofTestPull(t, now, privateKey)
				resolver := proofTestResolver(publicKey)
				resolver.key.ActorPtid = "other-actor"
				return resolver, request, proof,
					model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
					proofTestDeviceID
			},
			expectCode: model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resolver, request, proof, domain, headerDeviceID := test.prepare(t)
			service := NewClientCapabilityProofService(resolver, nil, func() time.Time { return now })

			verified, err := service.Verify(
				context.Background(),
				proofTestActorID,
				headerDeviceID,
				domain,
				request,
				proof,
			)
			if err == nil || verified != nil {
				t.Fatalf("Verify() = (%+v, %v), want rejection", verified, err)
			}

			var proofErr *ClientCapabilityCommandProofError
			if !errors.As(err, &proofErr) {
				t.Fatalf("Verify() error type = %T, want *ClientCapabilityCommandProofError", err)
			}
			if proofErr.Code != test.expectCode {
				t.Fatalf("Verify() error code = %s, want %s", proofErr.Code, test.expectCode)
			}
		})
	}
}

func TestClientCapabilityProofServiceAllowsExactClockSkewBoundary(t *testing.T) {
	now := time.Date(2026, time.August, 22, 12, 0, 0, 0, time.UTC)
	publicKey, privateKey := deterministicProofTestKey()

	for _, issuedAt := range []time.Time{
		now.Add(-clientCapabilityCommandProofMaxSkew),
		now.Add(clientCapabilityCommandProofMaxSkew),
	} {
		request, proof := signedProofTestPull(t, issuedAt, privateKey)
		service := NewClientCapabilityProofService(
			proofTestResolver(publicKey),
			nil,
			func() time.Time { return now },
		)
		if _, err := service.Verify(
			context.Background(),
			proofTestActorID,
			proofTestDeviceID,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
			request,
			proof,
		); err != nil {
			t.Fatalf("Verify() at skew boundary %s: %v", issuedAt, err)
		}
	}
}

func deterministicProofTestKey() (ed25519.PublicKey, ed25519.PrivateKey) {
	seed := bytes.Repeat([]byte{0x5a}, ed25519.SeedSize)
	privateKey := ed25519.NewKeyFromSeed(seed)
	return privateKey.Public().(ed25519.PublicKey), privateKey
}

func verifiedProofTestKey(publicKey ed25519.PublicKey) *touchmodel.VerifiedActorDeviceSigningKey {
	return &touchmodel.VerifiedActorDeviceSigningKey{
		ActorPtid:          proofTestActorID,
		ActorDeviceId:      proofTestDeviceID,
		SigningKeyId:       proofTestSigningKeyID,
		Ed25519PublicKey:   append([]byte(nil), publicKey...),
		VerificationSource: touchmodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
	}
}

func proofTestResolver(publicKey ed25519.PublicKey) *deterministicDeviceSigningKeyResolver {
	return &deterministicDeviceSigningKeyResolver{key: verifiedProofTestKey(publicKey)}
}

func proofTestPullRequest() *model.PullClientCapabilityRequestsRequest {
	return &model.PullClientCapabilityRequestsRequest{
		CapabilitySessionId: "session-1",
		DeviceId:            proofTestDeviceID,
		AfterSequence:       7,
		Limit:               20,
	}
}

func signedProofTestPull(
	t *testing.T,
	issuedAt time.Time,
	privateKey ed25519.PrivateKey,
) (proto.Message, *model.ClientCapabilityCommandProof) {
	t.Helper()
	request := proofTestPullRequest()
	proof, _ := signCapabilityCommandForTest(
		t,
		request,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
		issuedAt,
		privateKey,
	)
	attachCapabilityCommandProofForTest(t, request, proof)
	return request, proof
}

func signCapabilityCommandForTest(
	t *testing.T,
	request proto.Message,
	domain model.ClientCapabilityCommandDomain,
	issuedAt time.Time,
	privateKey ed25519.PrivateKey,
) (*model.ClientCapabilityCommandProof, [sha256.Size]byte) {
	t.Helper()

	bodyBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		t.Fatalf("marshal command body: %v", err)
	}
	bodyHash := sha256.Sum256(bodyBytes)
	proof := &model.ClientCapabilityCommandProof{
		CommandId:          "command-1",
		DeviceSigningKeyId: proofTestSigningKeyID,
		Nonce:              bytes.Repeat([]byte{0xa5}, clientCapabilityCommandNonceSize),
		IssuedAt:           timestamppb.New(issuedAt),
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&model.ClientCapabilityCommandSigningPayload{
			Domain:    domain,
			ActorPtid: proofTestActorID,
			DeviceId:  proofTestDeviceID,
			CommandId: proof.GetCommandId(),
			BodyHash:  bodyHash[:],
			Nonce:     proof.GetNonce(),
			IssuedAt:  proof.GetIssuedAt(),
		},
	)
	if err != nil {
		t.Fatalf("marshal signing payload: %v", err)
	}
	proof.Signature = ed25519.Sign(privateKey, signingBytes)
	return proof, bodyHash
}

func attachCapabilityCommandProofForTest(
	t *testing.T,
	request proto.Message,
	proof *model.ClientCapabilityCommandProof,
) {
	t.Helper()

	switch typed := request.(type) {
	case *model.RegisterClientCapabilityLeaseRequest:
		typed.CommandProof = proof
	case *model.RenewClientCapabilityLeaseRequest:
		typed.CommandProof = proof
	case *model.RevokeClientCapabilityLeaseRequest:
		typed.CommandProof = proof
	case *model.PullClientCapabilityRequestsRequest:
		typed.CommandProof = proof
	case *model.SubmitClientCapabilityReceiptRequest:
		typed.CommandProof = proof
	case *model.PullCapabilityOperationsRequest:
		typed.CommandProof = proof
	case *model.ReportCapabilityOperationEventRequest:
		typed.CommandProof = proof
	case *model.TakeOverCapabilityOperationRequest:
		typed.CommandProof = proof
	case *model.TakeOverCapabilityCleanupRequest:
		typed.CommandProof = proof
	default:
		t.Fatalf("unsupported request type %T", request)
	}
}

func commandProofForTest(
	t *testing.T,
	request proto.Message,
) *model.ClientCapabilityCommandProof {
	t.Helper()

	switch typed := request.(type) {
	case *model.RegisterClientCapabilityLeaseRequest:
		return typed.GetCommandProof()
	case *model.RenewClientCapabilityLeaseRequest:
		return typed.GetCommandProof()
	case *model.RevokeClientCapabilityLeaseRequest:
		return typed.GetCommandProof()
	case *model.PullClientCapabilityRequestsRequest:
		return typed.GetCommandProof()
	case *model.SubmitClientCapabilityReceiptRequest:
		return typed.GetCommandProof()
	case *model.PullCapabilityOperationsRequest:
		return typed.GetCommandProof()
	case *model.ReportCapabilityOperationEventRequest:
		return typed.GetCommandProof()
	case *model.TakeOverCapabilityOperationRequest:
		return typed.GetCommandProof()
	case *model.TakeOverCapabilityCleanupRequest:
		return typed.GetCommandProof()
	default:
		t.Fatalf("unsupported request type %T", request)
		return nil
	}
}
