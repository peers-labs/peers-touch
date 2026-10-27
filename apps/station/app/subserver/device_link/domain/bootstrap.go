package domain

import (
	"bytes"
	"crypto/sha256"
	"io"

	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"golang.org/x/crypto/hkdf"
	"google.golang.org/protobuf/proto"
)

const MaxCompactReferenceBytes = 301

// BootstrapKeys derives independent capabilities from one immutable context.
// The caller retains the seed locally; only lookup is sent to blob hosting.
func BootstrapKeys(reference *pb.DeviceLinkLocator) (lookup, unseal []byte, err error) {
	if reference == nil || reference.GetProtocolVersion() != 1 ||
		len(reference.GetBootstrapSecret()) != 32 || len(reference.GetOfferDigest()) != 32 ||
		len(reference.GetStationRootEd25519()) != 32 || reference.GetCanonicalDiscoveryOrigin() == "" ||
		reference.GetExpiresAtUnixMs() <= 0 {
		return nil, nil, Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	switch reference.GetEndpointRole() {
	case peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_DIRECT_STATION:
		if len(reference.GetRelayEd25519()) != 0 {
			return nil, nil, Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
		}
	case peerpb.AccessEndpointRole_ACCESS_ENDPOINT_ROLE_RELAY:
		if len(reference.GetRelayEd25519()) != 32 || bytes.Equal(reference.GetRelayEd25519(), reference.GetStationRootEd25519()) {
			return nil, nil, Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
		}
	default:
		return nil, nil, Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	context := proto.Clone(reference).(*pb.DeviceLinkLocator)
	context.BootstrapSecret = nil
	raw, err := Encode(context)
	if err != nil {
		return nil, nil, err
	}
	salt := Digest(append([]byte("peers-touch/device-link/bootstrap-context/v1\x00"), raw...))
	derive := func(purpose string) ([]byte, error) {
		key := make([]byte, 32)
		_, err := io.ReadFull(hkdf.New(sha256.New, reference.BootstrapSecret, salt,
			[]byte("peers-touch/device-link/bootstrap/"+purpose+"/v1\x00")), key)
		return key, err
	}
	lookup, err = derive("lookup")
	if err != nil {
		return nil, nil, err
	}
	unseal, err = derive("unseal")
	return
}
