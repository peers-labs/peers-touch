// Package actor_identity owns the Station-side Actor Device lifecycle.
//
// CA-W3 prepares its domain, application, persistence, and HTTP mapping layers
// for test composition only. Production route registration remains deferred to
// the atomic CA-W5 cutover so the repository never exposes two device owners.
package actor_identity
