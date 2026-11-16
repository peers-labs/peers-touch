//go:build social_acceptance

package social

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

type privateDeliveryAcceptanceRule struct {
	socialAcceptanceScope
	ID            string `json:"id"`
	Actor         string `json:"actor"`
	SourceStation string `json:"sourceStation"`
	IssuedMillis  int64  `json:"issuedMillis"`
	ExpiresMillis int64  `json:"expiresMillis"`
	EffectCount   uint32 `json:"effectCount"`
	FrameSHA256   string `json:"frameSha256"`
}

type privateDeliveryAcceptance struct {
	infrastructure.FederatedPrivateResourceReceiver
	scope socialAcceptanceScope
	root  string
	mu    sync.Mutex
}

func configurePrivateDeliveryAcceptance(receiver infrastructure.FederatedPrivateResourceReceiver,
	station string,
) (infrastructure.FederatedPrivateResourceReceiver, error) {
	scope, enabled, err := socialAcceptanceRuntimeScope(station)
	if err != nil || !enabled {
		return receiver, err
	}
	return &privateDeliveryAcceptance{
		FederatedPrivateResourceReceiver: receiver, scope: scope,
		root: "/tmp/peers-social-acceptance-" + scope.RunID,
	}, nil
}

// Federation has already authenticated this frame. A hold returns retryable,
// never accepted; release/expiry reaches the unchanged domain receiver.
// The embedded port delegates all invalidations without inspecting any rule.
func (c *privateDeliveryAcceptance) ReceiveFederatedPrivateResource(ctx context.Context,
	tx delivery.Transaction, request *privatecontentpb.FederatedPrivateResourceDelivery,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if c.hold(request, frame, time.Now()) {
		return delivery.RetryableResult(delivery.FrameErrorOverloaded), nil
	}
	return c.FederatedPrivateResourceReceiver.ReceiveFederatedPrivateResource(ctx, tx, request, frame)
}

func (c *privateDeliveryAcceptance) hold(request *privatecontentpb.FederatedPrivateResourceDelivery,
	frame *delivery.Frame, now time.Time,
) bool {
	if !c.scope.valid() || request == nil || frame == nil ||
		frame.PayloadKind != delivery.PayloadKindSocialPrivateResource ||
		request.ResourceKind != privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST ||
		request.GetPost() == nil || request.GetTargetActor().GetPtid() == "" ||
		request.SourceStationPeerId != frame.SourceStationPeerId ||
		request.TargetStationPeerId != c.scope.Station || frame.TargetStationPeerId != c.scope.Station {
		return false
	}
	wire, err := proto.MarshalOptions{Deterministic: true}.Marshal(frame)
	if err != nil {
		return false
	}
	hash := sha256.Sum256(wire)
	digest := hex.EncodeToString(hash[:])
	var rule privateDeliveryAcceptanceRule
	return updateSocialAcceptanceRule(c.root, &c.mu, &rule, func() bool {
		if rule.socialAcceptanceScope != c.scope || rule.ID != "private-post-hold" ||
			rule.Actor != request.GetTargetActor().GetPtid() ||
			rule.SourceStation == c.scope.Station || rule.SourceStation != frame.SourceStationPeerId ||
			!socialAcceptanceLeaseValid(rule.IssuedMillis, rule.ExpiresMillis, now) ||
			(rule.EffectCount == 0 && rule.FrameSHA256 != "") ||
			(rule.EffectCount != 0 && rule.FrameSHA256 != digest) {
			return false
		}
		rule.FrameSHA256 = digest
		if rule.EffectCount != ^uint32(0) {
			rule.EffectCount++
		}
		return true
	})
}
