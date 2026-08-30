package oss

import (
	"context"
	"errors"
	"testing"

	ossdb "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
)

// stubChatResolver lets each test pin the (sessionID, actorID) →
// participation answer it cares about. It records every call so
// tests can assert that the resolver was *not* consulted in the
// fast paths (public, owner short-circuit).
type stubChatResolver struct {
	allow map[string]struct{} // keys: sessionID + "|" + actorID
	err   error
	calls int
}

func newStubChatResolver() *stubChatResolver {
	return &stubChatResolver{allow: map[string]struct{}{}}
}

func (r *stubChatResolver) IsParticipant(_ context.Context, sessionID, actorID string) (bool, error) {
	r.calls++
	if r.err != nil {
		return false, r.err
	}
	_, ok := r.allow[sessionID+"|"+actorID]
	return ok, nil
}

func (r *stubChatResolver) grant(sessionID, actorID string) {
	r.allow[sessionID+"|"+actorID] = struct{}{}
}

// TestCheckRead_PolicyMatrix is the single-row table that pins down
// every visibility × caller combination the OSS subserver supports.
// Adding a row here is the canonical way to extend the policy
// surface — when a regression slips into checkRead, this test fails
// loudly enough to catch it before deployment.
func TestCheckRead_PolicyMatrix(t *testing.T) {
	const owner = "did:test:alice"
	const otherActor = "did:test:bob"
	const sessionID = "session-shared"

	mkMeta := func(vis, ownerID, sess string) *ossdb.FileMeta {
		return &ossdb.FileMeta{
			Key:           "k",
			OwnerPTID:     ownerID,
			Visibility:    vis,
			ChatSessionID: sess,
		}
	}

	cases := []struct {
		name         string
		meta         *ossdb.FileMeta
		subjectID    string
		setupResolv  func(*stubChatResolver)
		wantAllow    bool
		wantReason   string
		expectCalled bool
	}{
		{
			name:       "public_no_subject_passes",
			meta:       mkMeta(ossdb.VisibilityPublic, owner, ""),
			subjectID:  "",
			wantAllow:  true,
			wantReason: reasonOK,
		},
		{
			name:       "public_with_subject_still_passes",
			meta:       mkMeta(ossdb.VisibilityPublic, owner, ""),
			subjectID:  otherActor,
			wantAllow:  true,
			wantReason: reasonOK,
		},
		{
			name:       "private_no_subject_denies",
			meta:       mkMeta(ossdb.VisibilityPrivate, owner, ""),
			subjectID:  "",
			wantAllow:  false,
			wantReason: reasonNoSubject,
		},
		{
			name:       "private_owner_passes",
			meta:       mkMeta(ossdb.VisibilityPrivate, owner, ""),
			subjectID:  owner,
			wantAllow:  true,
			wantReason: reasonOK,
		},
		{
			name:       "private_other_actor_denies",
			meta:       mkMeta(ossdb.VisibilityPrivate, owner, ""),
			subjectID:  otherActor,
			wantAllow:  false,
			wantReason: reasonNotOwner,
		},
		{
			name:       "chat_no_subject_denies",
			meta:       mkMeta(ossdb.VisibilityChat, owner, sessionID),
			subjectID:  "",
			wantAllow:  false,
			wantReason: reasonNoSubject,
		},
		{
			name:       "chat_owner_passes_without_consulting_resolver",
			meta:       mkMeta(ossdb.VisibilityChat, owner, sessionID),
			subjectID:  owner,
			wantAllow:  true,
			wantReason: reasonOK,
			// expectCalled stays false — owners short-circuit.
		},
		{
			name:       "chat_missing_session_id_denies",
			meta:       mkMeta(ossdb.VisibilityChat, owner, ""),
			subjectID:  otherActor,
			wantAllow:  false,
			wantReason: reasonNoSession,
		},
		{
			name:         "chat_participant_passes",
			meta:         mkMeta(ossdb.VisibilityChat, owner, sessionID),
			subjectID:    otherActor,
			setupResolv:  func(r *stubChatResolver) { r.grant(sessionID, otherActor) },
			wantAllow:    true,
			wantReason:   reasonOK,
			expectCalled: true,
		},
		{
			name:         "chat_non_participant_denies",
			meta:         mkMeta(ossdb.VisibilityChat, owner, sessionID),
			subjectID:    otherActor,
			setupResolv:  func(r *stubChatResolver) { /* no grant */ },
			wantAllow:    false,
			wantReason:   reasonNotInSession,
			expectCalled: true,
		},
		{
			name:         "chat_resolver_error_denies",
			meta:         mkMeta(ossdb.VisibilityChat, owner, sessionID),
			subjectID:    otherActor,
			setupResolv:  func(r *stubChatResolver) { r.err = errors.New("boom") },
			wantAllow:    false,
			wantReason:   reasonResolverError,
			expectCalled: true,
		},
		{
			name:       "unknown_visibility_denies",
			meta:       mkMeta("rumor", owner, ""),
			subjectID:  owner,
			wantAllow:  false,
			wantReason: reasonUnknownVis,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resolver := newStubChatResolver()
			if tc.setupResolv != nil {
				tc.setupResolv(resolver)
			}
			got := checkRead(context.Background(), resolver, tc.meta, tc.subjectID, "")
			if got.Allow != tc.wantAllow {
				t.Fatalf("allow = %v, want %v (reason=%q)", got.Allow, tc.wantAllow, got.Reason)
			}
			if got.Reason != tc.wantReason {
				t.Errorf("reason = %q, want %q", got.Reason, tc.wantReason)
			}
			if tc.expectCalled && resolver.calls == 0 {
				t.Errorf("expected resolver to be consulted, was not")
			}
			if !tc.expectCalled && resolver.calls > 0 {
				t.Errorf("resolver consulted %d times in fast-path case", resolver.calls)
			}
		})
	}
}

// TestCheckRead_ChatNoResolverDenies — the policy says fail-closed
// when no resolver is wired. This protects the deployment posture
// where a misconfiguration would otherwise give every authenticated
// caller access to every chat-visibility file.
func TestCheckRead_ChatNoResolverDenies(t *testing.T) {
	meta := &ossdb.FileMeta{
		Key: "k", OwnerPTID: "owner", Visibility: ossdb.VisibilityChat,
		ChatSessionID: "sess",
	}
	got := checkRead(context.Background(), nil, meta, "did:test:bob", "")
	if got.Allow {
		t.Fatal("expected deny when resolver is nil")
	}
	if got.Reason != reasonResolverMissing {
		t.Errorf("reason = %q, want %q", got.Reason, reasonResolverMissing)
	}
}

// TestCheckRead_PeerSubjectTrumpsLocal — when both a peer-station
// JWT (federation) and a local subject are present, the federation
// token wins. This protects against a stale local cookie weakening
// a federated permission claim.
func TestCheckRead_PeerSubjectTrumpsLocal(t *testing.T) {
	meta := &ossdb.FileMeta{
		Key: "k", OwnerPTID: "did:test:alice", Visibility: ossdb.VisibilityPrivate,
	}
	// Local cookie = alice (would allow), peer JWT = bob (must deny).
	got := checkRead(context.Background(), nil, meta, "did:test:alice", "did:test:bob")
	if got.Allow {
		t.Fatal("peer subject must override and deny")
	}
	if got.Reason != reasonNotOwner {
		t.Errorf("reason = %q, want %q", got.Reason, reasonNotOwner)
	}
}
