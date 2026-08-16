package domain

import (
	"crypto/ed25519"
	"errors"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"google.golang.org/protobuf/proto"
)

var (
	ErrInvalidActorSignature     = errors.New("invalid actor signature")
	ErrInvalidStationSignature   = errors.New("invalid station signature")
	ErrInvalidSequencerSignature = errors.New("invalid sequencer signature")
)

type SignatureService struct{}

func NewSignatureService() *SignatureService { return &SignatureService{} }

func (s *SignatureService) SignActor(privateKey ed25519.PrivateKey, input *pb.ActorSignatureInput) ([]byte, error) {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, err
	}
	return ed25519.Sign(privateKey, data), nil
}

func (s *SignatureService) VerifyActor(publicKey ed25519.PublicKey, input *pb.ActorSignatureInput, signature []byte) error {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, data, signature) {
		return ErrInvalidActorSignature
	}
	return nil
}

func (s *SignatureService) SignStation(privateKey ed25519.PrivateKey, input *pb.StationSignatureInput) ([]byte, error) {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, err
	}
	return ed25519.Sign(privateKey, data), nil
}

func (s *SignatureService) VerifyStation(publicKey ed25519.PublicKey, input *pb.StationSignatureInput, signature []byte) error {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, data, signature) {
		return ErrInvalidStationSignature
	}
	return nil
}

func (s *SignatureService) SignSequencer(privateKey ed25519.PrivateKey, input *pb.SequencerSignatureInput) ([]byte, error) {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, err
	}
	return ed25519.Sign(privateKey, data), nil
}

func (s *SignatureService) VerifySequencer(publicKey ed25519.PublicKey, input *pb.SequencerSignatureInput, signature []byte) error {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return err
	}
	if !ed25519.Verify(publicKey, data, signature) {
		return ErrInvalidSequencerSignature
	}
	return nil
}
