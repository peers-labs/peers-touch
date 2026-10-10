package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
)

// BindEnrollmentChallenge collapses the complete Relay challenge context into
// the 32-byte challenge accepted by the Station identity endpoint.
func BindEnrollmentChallenge(challenge EnrollmentChallenge) []byte {
	var payload bytes.Buffer
	payload.WriteString(EnrollmentChallengeDomain)
	writeChallengeString(&payload, string(challenge.Operation))
	writeChallengeString(&payload, challenge.ID)
	_ = binary.Write(&payload, binary.BigEndian, challenge.InviteID)
	writeChallengeString(&payload, challenge.InviteDigest)
	writeChallengeString(&payload, challenge.RelayPeerID)
	writeChallengeString(&payload, challenge.StationPeerID)
	_ = binary.Write(&payload, binary.BigEndian, challenge.MountID)
	_ = binary.Write(&payload, binary.BigEndian, challenge.Generation)
	writeChallengeString(&payload, challenge.CredentialJTI)
	writeChallengeString(&payload, challenge.Label)
	writeChallengeBytes(&payload, challenge.Nonce)
	_ = binary.Write(&payload, binary.BigEndian, challenge.IssuedAt.UnixMilli())
	_ = binary.Write(&payload, binary.BigEndian, challenge.ExpiresAt.UnixMilli())
	sum := sha256.Sum256(payload.Bytes())
	return sum[:]
}

func writeChallengeString(buffer *bytes.Buffer, value string) {
	writeChallengeBytes(buffer, []byte(value))
}

func writeChallengeBytes(buffer *bytes.Buffer, value []byte) {
	_ = binary.Write(buffer, binary.BigEndian, uint32(len(value)))
	_, _ = buffer.Write(value)
}
