package oauth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"time"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	"golang.org/x/crypto/hkdf"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const credentialEnvelopeDomain = "peers-touch/oauth-credential-envelope"

type credentialSealer interface {
	Seal(
		context.Context,
		*dbmodel.AccessAttempt,
		*dbmodel.OAuthAttempt,
		*dbmodel.OAuthSessionCandidate,
		string,
		proto.Message,
		time.Time,
	) (*dbmodel.OAuthCredentialEnvelope, error)
}

type x25519CredentialSealer struct{}

func (x25519CredentialSealer) Seal(
	_ context.Context,
	accessAttempt *dbmodel.AccessAttempt,
	attempt *dbmodel.OAuthAttempt,
	candidate *dbmodel.OAuthSessionCandidate,
	sessionID string,
	credential proto.Message,
	expiresAt time.Time,
) (*dbmodel.OAuthCredentialEnvelope, error) {
	curve := ecdh.X25519()
	clientPublicKey, err := curve.NewPublicKey(attempt.CredentialDeliveryPublicKey)
	if err != nil {
		return nil, fmt.Errorf("parse credential delivery public key: %w", err)
	}
	serverPrivateKey, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate credential envelope key: %w", err)
	}
	sharedSecret, err := serverPrivateKey.ECDH(clientPublicKey)
	if err != nil {
		return nil, fmt.Errorf("derive credential envelope secret: %w", err)
	}

	associatedData := credentialEnvelopeAssociatedData(
		candidate.ID,
		sessionID,
		attempt.StationPeerID,
		attempt.DeviceID,
		attempt.LifecycleGeneration,
		accessAttempt.ID,
		accessAttempt.DecisionRevision,
	)
	key := make([]byte, 32)
	if _, err := io.ReadFull(
		hkdf.New(sha256.New, sharedSecret, nil, associatedData),
		key,
	); err != nil {
		return nil, fmt.Errorf("derive credential envelope key: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create credential envelope cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create credential envelope AEAD: %w", err)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate credential envelope nonce: %w", err)
	}
	plaintext, err := proto.Marshal(credential)
	if err != nil {
		return nil, fmt.Errorf("marshal credential envelope plaintext: %w", err)
	}

	return &dbmodel.OAuthCredentialEnvelope{
		CandidateID:              candidate.ID,
		SessionID:                sessionID,
		StationPeerID:            attempt.StationPeerID,
		DeviceID:                 attempt.DeviceID,
		LifecycleGeneration:      attempt.LifecycleGeneration,
		ServerEphemeralPublicKey: serverPrivateKey.PublicKey().Bytes(),
		Nonce:                    nonce,
		Ciphertext:               aead.Seal(nil, nonce, plaintext, associatedData),
		ExpiresAt:                expiresAt,
	}, nil
}

func credentialEnvelopeAssociatedData(
	candidateID,
	sessionID,
	stationPeerID,
	deviceID string,
	lifecycleGeneration uint64,
	accessAttemptID string,
	decisionRevision uint64,
) []byte {
	values := []string{
		credentialEnvelopeDomain,
		candidateID,
		sessionID,
		stationPeerID,
		deviceID,
		accessAttemptID,
	}
	size := 16
	for _, value := range values {
		size += 4 + len(value)
	}
	encoded := make([]byte, 0, size)
	for _, value := range values {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(value)))
		encoded = append(encoded, length[:]...)
		encoded = append(encoded, value...)
	}
	var number [8]byte
	binary.BigEndian.PutUint64(number[:], lifecycleGeneration)
	encoded = append(encoded, number[:]...)
	binary.BigEndian.PutUint64(number[:], decisionRevision)
	return append(encoded, number[:]...)
}

func envelopeProto(
	envelope *dbmodel.OAuthCredentialEnvelope,
	candidate *dbmodel.OAuthSessionCandidate,
) *oauthpb.OAuthCredentialEnvelope {
	if envelope == nil || candidate == nil {
		return nil
	}
	return &oauthpb.OAuthCredentialEnvelope{
		CandidateId:              candidate.ID,
		SessionId:                envelope.SessionID,
		ActorRef:                 candidateProto(candidate).GetActorRef(),
		StationPeerId:            envelope.StationPeerID,
		DeviceId:                 envelope.DeviceID,
		LifecycleGeneration:      envelope.LifecycleGeneration,
		ServerEphemeralPublicKey: append([]byte(nil), envelope.ServerEphemeralPublicKey...),
		Nonce:                    append([]byte(nil), envelope.Nonce...),
		Ciphertext:               append([]byte(nil), envelope.Ciphertext...),
		ExpiresAt:                timestamppb.New(envelope.ExpiresAt),
	}
}
