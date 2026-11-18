//go:build social_acceptance

package social

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

type acceptancePrivateReceiver struct {
	calls, invalidations int
	err                  error
}

func (r *acceptancePrivateReceiver) ReceiveFederatedPrivateResource(context.Context,
	delivery.Transaction, *privatecontentpb.FederatedPrivateResourceDelivery, *delivery.Frame,
) (delivery.Result, error) {
	r.calls++
	return delivery.TerminalResult(delivery.FrameErrorDomainRejected), r.err
}

func (r *acceptancePrivateReceiver) ReceiveFederatedPrivateInvalidation(context.Context,
	delivery.Transaction, *privatecontentpb.FederatedPrivateResourceInvalidation, *delivery.Frame,
) (delivery.Result, error) {
	r.invalidations++
	return delivery.AcceptedResult(), r.err
}

func privateAcceptanceFixture(t *testing.T) (*privateDeliveryAcceptance,
	privateDeliveryAcceptanceRule, *privatecontentpb.FederatedPrivateResourceDelivery, *delivery.Frame, time.Time,
) {
	t.Helper()
	feed, _, now := testFeedAcceptanceControl(t)
	rule := privateDeliveryAcceptanceRule{
		socialAcceptanceScope: feed.scope, ID: "private-post-hold",
		Actor: "ptid:bob", SourceStation: "sender",
		IssuedMillis: now.UnixMilli(), ExpiresMillis: now.Add(feedAcceptanceLease).UnixMilli(),
	}
	c := &privateDeliveryAcceptance{scope: feed.scope, root: feed.root,
		FederatedPrivateResourceReceiver: &acceptancePrivateReceiver{}}
	request := &privatecontentpb.FederatedPrivateResourceDelivery{
		SourceStationPeerId: "sender", TargetStationPeerId: "receiver",
		TargetActor:  &model.ActorRef{Ptid: "ptid:bob"},
		ResourceKind: privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POST,
		Metadata:     &privatecontentpb.FederatedPrivateResourceDelivery_Post{Post: &privatecontentpb.PostMetadata{}},
	}
	frame := &delivery.Frame{SourceStationPeerId: "sender", TargetStationPeerId: "receiver",
		PayloadKind: delivery.PayloadKindSocialPrivateResource, OpaquePayload: []byte("original")}
	writePrivateAcceptanceRule(t, c.root, rule)
	return c, rule, request, frame, now
}

func writePrivateAcceptanceRule(t *testing.T, root string, rule privateDeliveryAcceptanceRule) {
	t.Helper()
	wire, err := json.Marshal(rule)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "rule.json"), wire, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestPrivateAcceptanceHoldsOnlyOriginalFrameAndDelegatesReleaseAndInvalidation(t *testing.T) {
	c, _, request, frame, now := privateAcceptanceFixture(t)
	if !c.hold(request, frame, now) || !c.hold(request, frame, now) {
		t.Fatal("original matching retry was not held")
	}
	frame.OpaquePayload = []byte("foreign")
	if c.hold(request, frame, now) {
		t.Fatal("another frame consumed the hold")
	}
	frame.OpaquePayload = []byte("original")
	receiver := c.FederatedPrivateResourceReceiver.(*acceptancePrivateReceiver)
	result, err := c.ReceiveFederatedPrivateResource(context.Background(), nil, request, frame)
	if err != nil || result.Disposition != delivery.DispositionRetryable || receiver.calls != 0 {
		t.Fatal("held frame claimed acceptance or reached persistence")
	}
	receiver.err = errors.New("original receiver error")
	_, err = c.ReceiveFederatedPrivateInvalidation(context.Background(), nil, nil, frame)
	if err != receiver.err || receiver.invalidations != 1 {
		t.Fatal("invalidation was intercepted")
	}
	os.Remove(filepath.Join(c.root, "rule.json"))
	result, err = c.ReceiveFederatedPrivateResource(context.Background(), nil, request, frame)
	if err != receiver.err || result.Disposition != delivery.DispositionTerminal || receiver.calls != 1 {
		t.Fatal("release did not delegate the original receiver outcome")
	}
}

func TestPrivateAcceptanceRejectsForeignScopePayloadAndLease(t *testing.T) {
	for _, boundary := range []string{
		"run", "profile", "commit", "station", "actor", "source", "target",
		"kind", "metadata", "frame-source", "frame-target", "rule-kind",
		"expired", "future", "long", "stable", "missing-scope", "inconsistent-hash",
	} {
		t.Run(boundary, func(t *testing.T) {
			c, rule, request, frame, now := privateAcceptanceFixture(t)
			switch boundary {
			case "run":
				rule.RunID = strings.Repeat("b", 16)
			case "profile":
				rule.Profile = "foreign"
			case "commit":
				rule.Commit = strings.Repeat("b", 40)
			case "station":
				rule.Station = "foreign"
			case "actor":
				rule.Actor = "ptid:eve"
			case "source":
				rule.SourceStation = "foreign"
			case "target":
				request.TargetStationPeerId = "foreign"
			case "kind":
				request.ResourceKind = privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT
			case "metadata":
				request.Metadata = nil
			case "frame-source":
				frame.SourceStationPeerId = "foreign"
			case "frame-target":
				frame.TargetStationPeerId = "foreign"
			case "rule-kind":
				rule.ID = "lost-notification"
			case "expired":
				now = now.Add(feedAcceptanceLease)
			case "future":
				rule.IssuedMillis = now.Add(time.Second).UnixMilli()
			case "long":
				rule.ExpiresMillis++
			case "stable":
				c.scope.Profile = "corpstable"
				rule.Profile = c.scope.Profile
			case "missing-scope":
				c.scope.Commit = ""
				rule.Commit = ""
			case "inconsistent-hash":
				rule.FrameSHA256 = strings.Repeat("b", 64)
			}
			writePrivateAcceptanceRule(t, c.root, rule)
			if c.hold(request, frame, now) {
				t.Fatal("foreign scope, payload or lease consumed fault")
			}
		})
	}
}
