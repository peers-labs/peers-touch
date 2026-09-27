package actor

import (
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

// ProtoActorRef builds the canonical actor reference for API responses.
// The federated account projection comes only from the persisted Actor row;
// request transport addresses are not actor identity.
func ProtoActorRef(a *db.Actor) *model.ActorRef {
	if a == nil {
		return nil
	}
	acct := ""
	if strings.TrimSpace(a.FederatedHandle) != "" {
		if canonical, err := locator.CanonicalHandle(a.FederatedHandle); err == nil {
			acct = canonical
		}
	}
	return &model.ActorRef{
		Ptid: a.PTID,
		Acct: acct,
		Kind: db.ActorKindFromShorthand(a.Kind),
	}
}
