// Package domain defines Device Link's immutable cryptographic bindings.
package domain

import (
	"bytes"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"strings"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"google.golang.org/protobuf/proto"
)

const (
	OfferDomain      = "peers-touch/device-link/offer/v1\x00"
	ClaimDomain      = "peers-touch/device-link/claim/v1\x00"
	ApprovalDomain   = "peers-touch/device-link/approval/v1\x00"
	CredentialDomain = "peers-touch/device-link/credential/v1\x00"
	MaxProtocolBytes = 64 * 1024
	MaxClaims        = 4
)

type Error struct {
	Code   pb.DeviceLinkErrorCode
	Status *pb.DeviceLinkStatus
}

func (e *Error) Error() string                 { return "device_link: " + e.Code.String() }
func Reject(code pb.DeviceLinkErrorCode) error { return &Error{Code: code} }

func Encode(message proto.Message) ([]byte, error) {
	return proto.MarshalOptions{Deterministic: true}.Marshal(message)
}

func Decode(raw []byte, message proto.Message) error {
	if len(raw) == 0 || len(raw) > MaxProtocolBytes {
		return Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	if err := proto.Unmarshal(raw, message); err != nil {
		return Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	canonical, err := Encode(message)
	if err != nil || !bytes.Equal(canonical, raw) || hasUnknown(message.ProtoReflect()) {
		return Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	return nil
}

func Digest(raw []byte) []byte {
	hash := sha256.Sum256(raw)
	return hash[:]
}

func Random(size int) ([]byte, error) {
	raw := make([]byte, size)
	_, err := rand.Read(raw)
	return raw, err
}

// Capability is recoverable from the existing Station keyring. Storage keeps
// only its hash and key ID, never a locator, unsealing key or bearer secret.
func Capability(key []byte, purpose, id string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("peers-touch/device-link/capability/v1\x00" + purpose + "\x00" + id))
	return mac.Sum(nil)
}

func SameSecret(secret, hash []byte) bool {
	return len(secret) == 32 && subtle.ConstantTimeCompare(Digest(secret), hash) == 1
}

func Identifier(value string, limit int) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= limit &&
		!strings.ContainsRune(value, '\x00')
}

func VerifySignature(key []byte, purpose string, raw, signature []byte) error {
	if len(key) != ed25519.PublicKeySize || len(signature) != ed25519.SignatureSize ||
		!ed25519.Verify(key, append([]byte(purpose), raw...), signature) {
		return Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	return nil
}

func VerifyClaim(request *pb.ClaimDeviceLinkRequest) (*pb.DeviceLinkClaimStatement, error) {
	if request == nil || !Identifier(request.GetOfferId(), 128) || len(request.GetScanCapability()) != 32 {
		return nil, Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	statement := &pb.DeviceLinkClaimStatement{}
	if err := Decode(request.GetStatementBytes(), statement); err != nil {
		return nil, err
	}
	if statement.GetProtocolVersion() != 1 || statement.GetOfferId() != request.GetOfferId() ||
		!Identifier(statement.GetRequestId(), 128) || !Identifier(statement.GetMobileDeviceId(), 128) ||
		!Identifier(statement.GetStationPeerId(), 255) ||
		(statement.GetPlatform() != "android" && statement.GetPlatform() != "ios") ||
		len(statement.GetDeviceLabel()) > 128 || len(statement.GetAppVersion()) > 64 ||
		len(statement.GetMobileHpkePublicKey()) != 32 || bytes.Equal(statement.GetMobileHpkePublicKey(), make([]byte, 32)) ||
		len(statement.GetMobileDeviceSigningPublicKey()) != 32 ||
		len(statement.GetClaimNonce()) != 32 || statement.GetLifecycleGeneration() == 0 ||
		len(statement.GetTransportSourcePublicKey()) == 0 || len(statement.GetTransportSourcePublicKey()) > 128 {
		return nil, Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	return statement, VerifySignature(statement.GetMobileDeviceSigningPublicKey(),
		ClaimDomain, request.GetStatementBytes(), request.GetDeviceSignature())
}

func Approval(offer *pb.SignedDeviceLinkOffer, claim *pb.DeviceLinkClaim, revision uint64) (*pb.DeviceLinkApprovalTranscript, error) {
	statement := &pb.DeviceLinkOfferStatement{}
	mobile := &pb.DeviceLinkClaimStatement{}
	if err := Decode(offer.GetStatementBytes(), statement); err != nil {
		return nil, err
	}
	if err := Decode(claim.GetStatementBytes(), mobile); err != nil {
		return nil, err
	}
	raw, err := Encode(offer)
	if err != nil {
		return nil, err
	}
	return &pb.DeviceLinkApprovalTranscript{
		ProtocolVersion: 1, OfferId: statement.GetOfferId(), OfferDigest: Digest(raw),
		ClaimId: claim.GetClaimId(), ClaimDigest: Digest(claim.GetStatementBytes()),
		StationPeerId: statement.GetStationPeerId(), Actor: statement.GetActor(),
		DesktopDeviceId: statement.GetDesktopDeviceId(), MobileDeviceId: mobile.GetMobileDeviceId(),
		DesktopHpkePublicKey: statement.GetDesktopHpkePublicKey(), MobileHpkePublicKey: mobile.GetMobileHpkePublicKey(),
		MobileDeviceSigningPublicKey: mobile.GetMobileDeviceSigningPublicKey(), AccessAttemptId: claim.GetAccessAttemptId(),
		ApprovalRevision: revision, ProfileRevision: claim.GetProfileRevision(), ExpiresAtUnixMs: statement.GetExpiresAtUnixMs(),
	}, nil
}

func ComparisonCode(transcript *pb.DeviceLinkApprovalTranscript) (string, error) {
	raw, err := Encode(transcript)
	if err != nil {
		return "", err
	}
	hash := Digest(append([]byte(ApprovalDomain), raw...))
	value := uint32(hash[0])<<24 | uint32(hash[1])<<16 | uint32(hash[2])<<8 | uint32(hash[3])
	return fmt.Sprintf("%06d", value%1_000_000), nil
}

func Terminal(state pb.DeviceLinkState) bool {
	return state >= pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED
}

// OperationProof clears only the designated PoP field on a defensive clone.
// Other signatures and all operation arguments remain covered.
func OperationProof(request proto.Message, clear func(proto.Message), key, signature []byte, operation string) error {
	copy := proto.Clone(request)
	clear(copy)
	raw, err := Encode(copy)
	if err != nil {
		return err
	}
	return VerifySignature(key, "peers-touch/device-link/"+operation+"/v1\x00", raw, signature)
}
