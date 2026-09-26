package federation

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	presencemodel "github.com/peers-labs/peers-touch/station/frame/touch/model/presence"
	"google.golang.org/protobuf/proto"
)

// PresenceQueryRequestSHA256 binds an authenticated peer token to the exact
// deterministic Presence request body.
func PresenceQueryRequestSHA256(
	request *presencemodel.PresenceQueryRequest,
) (string, error) {
	if request == nil {
		return "", delivery.NewError(
			delivery.FailureInvalidArgument,
			"digest Federation presence query",
			errors.New("request is required"),
		)
	}
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(request)
	if err != nil {
		return "", delivery.NewError(
			delivery.FailureInvalidFrame,
			"digest Federation presence query",
			err,
		)
	}
	digest := sha256.Sum256(body)

	return hex.EncodeToString(digest[:]), nil
}
