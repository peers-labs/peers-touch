package service

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	touchmodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

const (
	clientCapabilityCommandNonceSize    = 32
	clientCapabilityCommandProofMaxSkew = 60 * time.Second
)

// VerifiedCapabilityCommand contains the authenticated values needed by the
// coordinator's nonce/digest persistence boundary.
type VerifiedCapabilityCommand struct {
	CommandID    string
	DeviceID     string
	SigningKeyID string
	NonceHash    string
	BodyHash     string
	IssuedAt     time.Time
}

// DeviceSigningKeyResolver matches actor.DeviceStore.ResolveSigningKey.
type DeviceSigningKeyResolver interface {
	ResolveSigningKey(
		context.Context,
		string,
		string,
		string,
	) (*touchmodel.VerifiedActorDeviceSigningKey, error)
}

// ClientCapabilityCommandProofError exposes the protocol error code without
// including proof material in the error text.
type ClientCapabilityCommandProofError struct {
	Code  model.ClientCapabilityCommandErrorCode
	Cause error
}

func (e *ClientCapabilityCommandProofError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("client capability command proof rejected (%s): %v", e.Code.String(), e.Cause)
	}
	return fmt.Sprintf("client capability command proof rejected (%s)", e.Code.String())
}

func (e *ClientCapabilityCommandProofError) Unwrap() error {
	return e.Cause
}

// ActorPTIDResolver resolves a numeric actor ID to its canonical PTID.
type ActorPTIDResolver interface {
	ResolvePTID(ctx context.Context, actorID string) (string, error)
}

type ClientCapabilityProofService struct {
	resolver     DeviceSigningKeyResolver
	ptidResolver ActorPTIDResolver
	now          func() time.Time
}

// NewClientCapabilityProofService creates a verifier with explicit key and
// clock dependencies. Production callers must provide both dependencies.
func NewClientCapabilityProofService(
	resolver DeviceSigningKeyResolver,
	ptidResolver ActorPTIDResolver,
	now func() time.Time,
) *ClientCapabilityProofService {
	return &ClientCapabilityProofService{
		resolver:     resolver,
		ptidResolver: ptidResolver,
		now:          now,
	}
}

// Verify authenticates one capability command without mutating or persisting
// the request. Replay CAS remains the coordinator's responsibility.
func (s *ClientCapabilityProofService) Verify(
	ctx context.Context,
	actorID string,
	headerDeviceID string,
	domain model.ClientCapabilityCommandDomain,
	request proto.Message,
	proof *model.ClientCapabilityCommandProof,
) (*VerifiedCapabilityCommand, error) {
	if s == nil || s.resolver == nil || s.now == nil {
		return nil, fmt.Errorf("client capability proof verifier dependencies are unavailable")
	}
	if strings.TrimSpace(actorID) == "" || strings.TrimSpace(headerDeviceID) == "" {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_REQUIRED,
			fmt.Errorf("authenticated actor and device header are required"),
		)
	}
	if proof == nil ||
		strings.TrimSpace(proof.GetCommandId()) == "" ||
		strings.TrimSpace(proof.GetDeviceSigningKeyId()) == "" ||
		proof.GetIssuedAt() == nil ||
		len(proof.GetNonce()) == 0 ||
		len(proof.GetSignature()) == 0 {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_REQUIRED,
			fmt.Errorf("complete command proof is required"),
		)
	}
	if len(proof.GetNonce()) != clientCapabilityCommandNonceSize {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
			fmt.Errorf("command proof nonce must be %d bytes", clientCapabilityCommandNonceSize),
		)
	}
	if len(proof.GetSignature()) != ed25519.SignatureSize {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
			fmt.Errorf("command proof signature must be %d bytes", ed25519.SignatureSize),
		)
	}
	if err := proof.GetIssuedAt().CheckValid(); err != nil {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_EXPIRED,
			fmt.Errorf("command proof issued_at is invalid: %w", err),
		)
	}

	issuedAt := proof.GetIssuedAt().AsTime()
	now := s.now()
	if issuedAt.Before(now.Add(-clientCapabilityCommandProofMaxSkew)) ||
		issuedAt.After(now.Add(clientCapabilityCommandProofMaxSkew)) {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_PROOF_EXPIRED,
			fmt.Errorf("command proof issued_at exceeds allowed clock skew"),
		)
	}

	canonicalRequest, expectedDomain, requestDeviceID, requestSigningKeyID, err :=
		canonicalCapabilityCommandRequest(request)
	if err != nil {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
			err,
		)
	}
	if domain == model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_UNSPECIFIED ||
		domain != expectedDomain {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
			fmt.Errorf("command domain does not match request type"),
		)
	}
	if requestDeviceID != "" && requestDeviceID != headerDeviceID {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
			fmt.Errorf("request device does not match device header"),
		)
	}
	if requestSigningKeyID != "" && requestSigningKeyID != proof.GetDeviceSigningKeyId() {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
			fmt.Errorf("request signing key does not match command proof"),
		)
	}

	bodyBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(canonicalRequest)
	if err != nil {
		return nil, fmt.Errorf("marshal canonical capability command body: %w", err)
	}
	bodyHash := sha256.Sum256(bodyBytes)

	resolvedActorID := actorID
	if s.ptidResolver != nil && !strings.HasPrefix(actorID, "ptid:") {
		ptid, resolveErr := s.ptidResolver.ResolvePTID(ctx, actorID)
		if resolveErr != nil {
			return nil, proofError(
				model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND,
				fmt.Errorf("resolve actor PTID: %w", resolveErr),
			)
		}
		resolvedActorID = ptid
	}

	key, err := s.resolver.ResolveSigningKey(
		ctx,
		resolvedActorID,
		headerDeviceID,
		proof.GetDeviceSigningKeyId(),
	)
	if err != nil {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND,
			fmt.Errorf("resolve device signing key: %w", err),
		)
	}
	if key == nil {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND,
			fmt.Errorf("device signing key was not resolved"),
		)
	}
	if key.GetRevokedAtUnixMs() > 0 {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_DEVICE_KEY_REVOKED,
			fmt.Errorf("device signing key is revoked"),
		)
	}
	if key.GetActorPtid() != resolvedActorID ||
		key.GetActorDeviceId() != headerDeviceID ||
		key.GetSigningKeyId() != proof.GetDeviceSigningKeyId() ||
		len(key.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		key.GetVerificationSource() ==
			touchmodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_KEY_NOT_FOUND,
			fmt.Errorf("resolved device signing key does not match verified command identity"),
		)
	}

	signingPayload := &model.ClientCapabilityCommandSigningPayload{
		Domain:    domain,
		ActorPtid: resolvedActorID,
		DeviceId:  headerDeviceID,
		CommandId: proof.GetCommandId(),
		BodyHash:  bodyHash[:],
		Nonce:     proof.GetNonce(),
		IssuedAt:  proof.GetIssuedAt(),
	}
	signingBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(signingPayload)
	if err != nil {
		return nil, fmt.Errorf("marshal capability command signing payload: %w", err)
	}
	if !ed25519.Verify(
		ed25519.PublicKey(key.GetEd25519PublicKey()),
		signingBytes,
		proof.GetSignature(),
	) {
		return nil, proofError(
			model.ClientCapabilityCommandErrorCode_CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID,
			fmt.Errorf("command proof signature is invalid"),
		)
	}

	nonceHash := sha256.Sum256(proof.GetNonce())
	return &VerifiedCapabilityCommand{
		CommandID:    proof.GetCommandId(),
		DeviceID:     headerDeviceID,
		SigningKeyID: proof.GetDeviceSigningKeyId(),
		NonceHash:    hex.EncodeToString(nonceHash[:]),
		BodyHash:     hex.EncodeToString(bodyHash[:]),
		IssuedAt:     issuedAt,
	}, nil
}

func canonicalCapabilityCommandRequest(
	request proto.Message,
) (
	proto.Message,
	model.ClientCapabilityCommandDomain,
	string,
	string,
	error,
) {
	if request == nil || !request.ProtoReflect().IsValid() {
		return nil,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_UNSPECIFIED,
			"",
			"",
			fmt.Errorf("capability command request is required")
	}

	switch typed := proto.Clone(request).(type) {
	case *model.RegisterClientCapabilityLeaseRequest:
		typed.CommandProof = nil
		if typed.GetAdvertisement() == nil {
			return nil, 0, "", "", fmt.Errorf("capability advertisement is required")
		}
		return typed,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REGISTER_LEASE,
			typed.GetAdvertisement().GetDeviceId(),
			typed.GetAdvertisement().GetDeviceSigningKeyId(),
			nil
	case *model.RenewClientCapabilityLeaseRequest:
		typed.CommandProof = nil
		return typed,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_RENEW_LEASE,
			"",
			typed.GetDeviceSigningKeyId(),
			nil
	case *model.RevokeClientCapabilityLeaseRequest:
		typed.CommandProof = nil
		return typed,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REVOKE_LEASE,
			"",
			"",
			nil
	case *model.PullClientCapabilityRequestsRequest:
		typed.CommandProof = nil
		return typed,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_REQUESTS,
			typed.GetDeviceId(),
			"",
			nil
	case *model.SubmitClientCapabilityReceiptRequest:
		typed.CommandProof = nil
		if typed.GetReceipt() == nil {
			return nil, 0, "", "", fmt.Errorf("capability receipt is required")
		}
		return typed,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_SUBMIT_ACTIVE_RECEIPT,
			typed.GetReceipt().GetTargetDeviceId(),
			"",
			nil
	default:
		return nil,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_UNSPECIFIED,
			"",
			"",
			fmt.Errorf("unsupported capability command request type %T", request)
	}
}

func proofError(
	code model.ClientCapabilityCommandErrorCode,
	cause error,
) *ClientCapabilityCommandProofError {
	return &ClientCapabilityCommandProofError{Code: code, Cause: cause}
}
