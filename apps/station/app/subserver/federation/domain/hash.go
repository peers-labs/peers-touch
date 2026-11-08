package domain

import (
	"crypto/subtle"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"google.golang.org/protobuf/proto"
)

type HashService struct{}

func NewHashService() *HashService { return &HashService{} }

func (h *HashService) ComputePayloadHash(payload proto.Message) ([]byte, error) {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return signedlog.HashBytes(data), nil
}

func (h *HashService) ComputeEventHash(input *pb.EventHashInput) ([]byte, error) {
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, err
	}
	return signedlog.HashBytes(data), nil
}

func (h *HashService) VerifyEventHash(event *pb.LedgerEvent, expectedPayloadHash []byte) (bool, error) {
	input := &pb.EventHashInput{
		FederationId:  event.FederationId,
		Seq:           event.Seq,
		PrevHash:      event.PrevHash,
		EventTypeName: event.EventType.String(),
		PayloadHash:   expectedPayloadHash,
	}
	computed, err := h.ComputeEventHash(input)
	if err != nil {
		return false, err
	}
	return subtle.ConstantTimeCompare(computed, event.EventHash) == 1, nil
}
