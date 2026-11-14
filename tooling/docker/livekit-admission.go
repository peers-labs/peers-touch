// Peers-Touch admission extension for the pinned LiveKit v1.13.0 source.
// Copied into pkg/service by livekit.Dockerfile; not a second media server.
package service

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net/http"
	"strings"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"google.golang.org/protobuf/encoding/protowire"
)

const peersAdmissionContract = "sid-fence-replay-deny-v1"

// The private protobuf extension is transported by the original authenticated
// RoomService -> Participant RPC. It never enters attributes or metadata.
// Both hops preserve unknown protobuf fields. Missing/stripped fields deny.
const peersExpectedSIDField protowire.Number = 1001

func peersGroupRoom(room string) bool { return strings.HasPrefix(room, "gc-") }

func peersEndpointIdentity(identity string) bool {
	if !strings.HasPrefix(identity, "gce-") || len(identity) != 68 {
		return false
	}
	_, err := hex.DecodeString(identity[4:])
	return err == nil && strings.ToLower(identity) == identity
}

func (r *RoomManager) lockPeersEndpoint(room, identity string) func() {
	if !peersGroupRoom(room) || identity == "" {
		return func() {}
	}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(room + "\x00" + identity))
	// Bounded memory, including failed/adversarial joins. A shard collision
	// serializes two endpoints but does not weaken their SID checks.
	lock := &r.peersEndpointFences[hash.Sum32()%uint32(len(r.peersEndpointFences))]
	lock.Lock()
	return lock.Unlock
}

func peersInitialGrants(grants *auth.ClaimGrants) (*auth.ClaimGrants, error) {
	if grants == nil || grants.Video == nil {
		return nil, fmt.Errorf("group media requires join grants")
	}
	grants = grants.Clone()
	grants.Video.SetCanPublish(false)
	grants.Video.SetCanSubscribe(false)
	grants.Video.SetCanPublishData(false)
	grants.Video.SetCanUpdateOwnMetadata(false)
	grants.Video.CanPublishSources = nil
	grants.Metadata = ""
	grants.Attributes = nil
	return grants, nil
}

func peersExpectedSID(req *livekit.UpdateParticipantRequest) (string, error) {
	var sid string
	wire := req.ProtoReflect().GetUnknown()
	for len(wire) > 0 {
		number, kind, n := protowire.ConsumeTag(wire)
		if n < 0 {
			return "", fmt.Errorf("malformed admission control")
		}
		wire = wire[n:]
		if number == peersExpectedSIDField {
			if kind != protowire.BytesType || sid != "" {
				return "", fmt.Errorf("invalid admission SID")
			}
			value, n := protowire.ConsumeString(wire)
			if n < 0 || value == "" {
				return "", fmt.Errorf("invalid admission SID")
			}
			sid, wire = value, wire[n:]
		} else {
			n := protowire.ConsumeFieldValue(number, kind, wire)
			if n < 0 {
				return "", fmt.Errorf("malformed admission control")
			}
			wire = wire[n:]
		}
	}
	if sid == "" {
		return "", fmt.Errorf("group participant updates require expected SID")
	}
	return sid, nil
}

func peersAdmissionCapabilities(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	// The same API-key middleware as RoomService verifies the JWT.
	if err := EnsureListPermission(req.Context()); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"contract": peersAdmissionContract,
		"source":   "b93c1e160770d93179dc5b1c9027567befec5e62",
	})
}
