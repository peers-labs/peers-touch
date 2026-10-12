// Package bot implements the IM Bot (ACTOR_KIND_AGENT) sub-server: a
// Station-resident, webhook-driven non-human actor that delivers structured
// events into an owner-only conversation via service-plaintext messages.
//
// Layering (mirrors subserver/conversation):
//
//	interface/http      -> application -> domain
//	application/delivery -> conversation / notification application ports
//	infrastructure      -> domain
//
// The bot sub-server never imports conversation/social infrastructure.
package bot
