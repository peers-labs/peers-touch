// Package social_gate defines the social-layer access control interface.
// It gates operations (create conversation, send message, manage members, etc.)
// based on relationship state, group roles, and federation trust — without
// embedding policy evaluation logic itself.
package social_gate

import "context"

// SocialGate evaluates whether a given operation is permitted under the
// current social policy. Implementations may compose relationship checks,
// role checks, rate limits, and federation trust into a single verdict.
type SocialGate interface {
	Evaluate(ctx context.Context, op Operation) error
}

// Operation describes what the caller intends to do. The gate inspects these
// fields against policy rules to produce allow / deny / rate-limit verdicts.
type Operation struct {
	// Action identifies the semantic operation being attempted.
	// Known values: "create_direct", "send_message", "add_member",
	// "remove_member", "dissolve", "leave", "mls_distribute",
	// "dkx_send", "fetch_key_package".
	Action string

	// TargetPtid is the ptid of the target actor for bilateral operations.
	// Empty for self/list operations or operations that only reference a conversation.
	TargetPtid string

	// ConversationID identifies the target conversation.
	// Empty for creation operations that have not yet allocated an ID.
	ConversationID string
}
