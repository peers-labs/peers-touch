package identity

import (
	identityCore "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
	apAdapter "github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity/provider/activitypub"
)

func Init(domain string) {
	identityCore.Register(apAdapter.NewAdapter(domain))
}
