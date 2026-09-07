// Package conversation is the sole Station business authority for Direct and
// Group Chat.
//
// The domain, application, infrastructure, and interface packages contain the
// canonical Conversation DDD bounded context. During CA-W2 that context is
// composed only by tests; the existing production composition remains active
// until the atomic CA-W5 route, store, and consumer cutover.
//
// Conversation owns validation, sequencing, authority events, membership and
// MLS epochs, settings, read cursors, and delivery intent creation. Actor
// identity, presence, object storage, and Federation transport remain separate
// owners accessed through explicit ports.
//
// See docs/architecture/api-ownership/design.md and
// docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md.
package conversation
