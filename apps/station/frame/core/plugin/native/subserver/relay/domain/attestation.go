package domain

import (
	"errors"
	"time"

	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

var ErrRouteAttestationInvalid = errors.New(
	"Station route attestation is invalid",
)

func VerifyStationRouteAttestation(
	attestation *peerpb.StationRouteAttestation,
	relayPeerID string,
	now time.Time,
) (*peerpb.StationRouteStatement, error) {
	verified, err := peerpb.VerifyStationRouteAttestation(
		attestation,
		relayPeerID,
		now,
	)
	if err != nil {
		return nil, ErrRouteAttestationInvalid
	}
	return verified.Statement, nil
}
