// Package bot implements the IM Bot (ACTOR_KIND_AGENT) sub-server: a
// Station-resident non-human actor backed by Conversation's generic publishing
// capability and delivered through service-plaintext messages.
//
// Layering (mirrors subserver/conversation):
//
//	interface/http      -> application -> domain
//	application/delivery -> conversation / notification application ports
//	infrastructure      -> domain
//
// The bot sub-server never imports conversation/social infrastructure.
package bot
