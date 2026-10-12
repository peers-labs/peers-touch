package domain

// Principal is the internal, authenticated acting identity for a bot
// operation. It is never derived from a webhook body: for management calls it
// comes from the JWT owner; for edge ingestion it comes from the registry row
// resolved by webhook id + secret.
type Principal struct {
	BotPtid   string
	OwnerPtid string
	Scope     DeliveryScope
}

// OwnerOnly enforces the v1 recipient boundary: a bot may only address its
// owning actor. Federation / non-owner delivery is rejected here.
func (p Principal) OwnerOnly(recipientPtid string) bool {
	return p.Scope == ScopeOwnerOnly && recipientPtid == p.OwnerPtid
}
