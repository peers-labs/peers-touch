package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"testing"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

func TestPrivateContentServiceListRecoverablePrivateContent(t *testing.T) {
	t.Run("projects exact Post and Comment locators", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		post := seedRecoverablePrivateMoment(t, fixture, "locator-post")
		fixture.clock.now = fixture.clock.now.Add(time.Second)
		comment := seedRecoverablePrivateComment(
			t,
			fixture,
			post.postID,
			"locator-comment",
		)

		response := listRecoverablePrivateContent(
			t,
			fixture,
			"ptid:bob",
			"",
			10,
		)
		if response.GetHasMore() ||
			response.GetNextCursor() != "" ||
			len(response.GetResources()) != 2 {
			t.Fatalf("recovery response = %+v", response)
		}

		byContentID := make(
			map[string]*privatecontentpb.RecoverablePrivateContent,
			len(response.GetResources()),
		)
		for _, resource := range response.GetResources() {
			byContentID[resource.GetResource().GetContentId()] = resource
		}
		postResult := byContentID[post.contentID]
		if postResult == nil ||
			postResult.GetLocator().GetPostId() != post.postID ||
			postResult.GetLocator().GetComment() != nil {
			t.Fatalf("Post recovery locator = %+v", postResult)
		}
		commentResult := byContentID[comment.contentID]
		if commentResult == nil ||
			commentResult.GetLocator().GetPostId() != "" ||
			commentResult.GetLocator().GetComment().GetPostId() != post.postID ||
			commentResult.GetLocator().GetComment().GetCommentId() !=
				comment.commentID {
			t.Fatalf("Comment recovery locator = %+v", commentResult)
		}
		for _, expected := range []recoverableSeed{post, comment} {
			actual := byContentID[expected.contentID]
			if actual.GetRecoveryEnvelope().GetRecoveryActor().GetPtid() !=
				"ptid:bob" ||
				actual.GetRecoveryEnvelope().GetEndpoint() != nil ||
				actual.GetResource().GetGeneration() != 1 ||
				!bytes.Equal(
					actual.GetPayloadCiphertextSha256(),
					expected.payloadCiphertextSHA256,
				) {
				t.Fatalf("recovery projection = %+v", actual)
			}
		}

		authorResponse := listRecoverablePrivateContent(
			t,
			fixture,
			"ptid:alice",
			"",
			10,
		)
		if len(authorResponse.GetResources()) != 2 {
			t.Fatalf(
				"author recovery resource count = %d, want 2",
				len(authorResponse.GetResources()),
			)
		}
		for _, resource := range authorResponse.GetResources() {
			if resource.GetRecoveryEnvelope().GetRecoveryActor().GetPtid() !=
				"ptid:alice" {
				t.Fatalf("author recovery envelope = %+v", resource)
			}
		}
	})

	t.Run("pagination restarts without duplicates", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		seeds := make([]recoverableSeed, 0, 5)
		for index := 0; index < 5; index++ {
			seeds = append(seeds, seedRecoverablePrivateMoment(
				t,
				fixture,
				"page-"+string(rune('a'+index)),
			))
			fixture.clock.now = fixture.clock.now.Add(time.Second)
		}
		collisionBase := time.Date(
			2026,
			time.September,
			14,
			12,
			0,
			0,
			123000000,
			time.UTC,
		)
		for index, seed := range seeds[:3] {
			if err := fixture.database.Model(
				&dbmodel.SocialPrivateContentPost{},
			).Where(
				"content_id = ?",
				seed.contentID,
			).Update(
				"created_at",
				collisionBase.Add(time.Duration(index)*time.Nanosecond),
			).Error; err != nil {
				t.Fatal(err)
			}
		}

		first := listRecoverablePrivateContent(
			t,
			fixture,
			"ptid:bob",
			"",
			2,
		)
		second := listRecoverablePrivateContent(
			t,
			fixture,
			"ptid:bob",
			first.GetNextCursor(),
			2,
		)
		restartedSecond := listRecoverablePrivateContent(
			t,
			fixture,
			"ptid:bob",
			first.GetNextCursor(),
			2,
		)
		third := listRecoverablePrivateContent(
			t,
			fixture,
			"ptid:bob",
			second.GetNextCursor(),
			2,
		)

		if !first.GetHasMore() ||
			!second.GetHasMore() ||
			third.GetHasMore() ||
			third.GetNextCursor() != "" ||
			len(first.GetResources()) != 2 ||
			len(second.GetResources()) != 2 ||
			len(third.GetResources()) != 1 {
			t.Fatalf(
				"pagination sizes = %d/%d/%d, more=%t/%t/%t",
				len(first.GetResources()),
				len(second.GetResources()),
				len(third.GetResources()),
				first.GetHasMore(),
				second.GetHasMore(),
				third.GetHasMore(),
			)
		}
		if !proto.Equal(second, restartedSecond) {
			t.Fatal("restarting from the same cursor changed the page")
		}
		seen := make(map[string]struct{}, 5)
		for _, page := range []*privatecontentpb.ListRecoverablePrivateContentResponse{
			first,
			second,
			third,
		} {
			for _, resource := range page.GetResources() {
				contentID := resource.GetResource().GetContentId()
				if _, duplicated := seen[contentID]; duplicated {
					t.Fatalf("duplicate recovery resource %q", contentID)
				}
				seen[contentID] = struct{}{}
			}
		}
		if len(seen) != 5 {
			t.Fatalf("recovered %d unique resources, want 5", len(seen))
		}
	})

	t.Run("wrong actor and revoked authority return no resources", func(t *testing.T) {
		testCases := []struct {
			name   string
			actor  string
			mutate func(*testing.T, *privateContentServiceFixture, recoverableSeed)
		}{
			{
				name:  "wrong actor",
				actor: "ptid:eve",
			},
			{
				name:  "missing recovery envelope",
				actor: "ptid:bob",
				mutate: func(
					t *testing.T,
					fixture *privateContentServiceFixture,
					seed recoverableSeed,
				) {
					t.Helper()
					if err := fixture.database.Where(
						"content_id = ? AND key_kind = ? AND recipient_ptid = ?",
						seed.contentID,
						infrastructure.PrivateContentKeyKindActorRecovery,
						"ptid:bob",
					).Delete(
						&dbmodel.SocialPrivateContentEnvelope{},
					).Error; err != nil {
						t.Fatal(err)
					}
				},
			},
			{
				name:  "revoked recipient grant",
				actor: "ptid:bob",
				mutate: func(
					t *testing.T,
					fixture *privateContentServiceFixture,
					seed recoverableSeed,
				) {
					t.Helper()
					revokedAt := fixture.clock.now
					if err := fixture.database.Model(
						&dbmodel.SocialPrivateRecipientGrant{},
					).Where(
						"snapshot_id = ? AND recipient_ptid = ?",
						seed.snapshotID,
						"ptid:bob",
					).Update("revoked_at", revokedAt).Error; err != nil {
						t.Fatal(err)
					}
				},
			},
			{
				name:  "removed FRIENDS relationship",
				actor: "ptid:bob",
				mutate: func(
					t *testing.T,
					fixture *privateContentServiceFixture,
					_ recoverableSeed,
				) {
					t.Helper()
					if err := fixture.database.Exec(
						"DELETE FROM social_relationship_projections WHERE owner_ptid = ? AND peer_ptid = ?",
						"ptid:alice",
						"ptid:bob",
					).Error; err != nil {
						t.Fatal(err)
					}
				},
			},
			{
				name:  "deleted resource",
				actor: "ptid:bob",
				mutate: func(
					t *testing.T,
					fixture *privateContentServiceFixture,
					seed recoverableSeed,
				) {
					t.Helper()
					deletedAt := fixture.clock.now
					if err := fixture.database.Model(
						&dbmodel.SocialPrivateContentPost{},
					).Where(
						"content_id = ?",
						seed.contentID,
					).Update("deleted_at", deletedAt).Error; err != nil {
						t.Fatal(err)
					}
				},
			},
			{
				name:  "blocked relationship",
				actor: "ptid:bob",
				mutate: func(
					t *testing.T,
					fixture *privateContentServiceFixture,
					_ recoverableSeed,
				) {
					t.Helper()
					if err := fixture.database.Exec(`
INSERT INTO friend_chat_friendships (
  actor_ptid, peer_ptid, status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?)`,
						"ptid:alice",
						"ptid:bob",
						3,
						fixture.clock.now,
						fixture.clock.now,
					).Error; err != nil {
						t.Fatal(err)
					}
				},
			},
		}
		for _, testCase := range testCases {
			t.Run(testCase.name, func(t *testing.T) {
				fixture := newPrivateContentServiceFixture(t)
				seed := seedRecoverablePrivateMoment(
					t,
					fixture,
					"denial-"+testCase.name,
				)
				if testCase.mutate != nil {
					testCase.mutate(t, fixture, seed)
				}

				response := listRecoverablePrivateContent(
					t,
					fixture,
					testCase.actor,
					"",
					10,
				)
				if len(response.GetResources()) != 0 ||
					response.GetHasMore() ||
					response.GetNextCursor() != "" {
					t.Fatalf("denied recovery response = %+v", response)
				}
			})
		}
	})

	t.Run("malformed cursor and limits fail closed", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		for _, limit := range []uint32{0, 101} {
			_, err := fixture.service.ListRecoverablePrivateContent(
				context.Background(),
				"ptid:bob",
				&privatecontentpb.ListRecoverablePrivateContentRequest{
					Limit: limit,
				},
			)
			if !socialdomain.IsPrivateContentCode(
				err,
				socialdomain.PrivateContentInvalidArgument,
			) {
				t.Fatalf("limit %d error = %v", limit, err)
			}
		}
		_, err := fixture.service.ListRecoverablePrivateContent(
			context.Background(),
			"ptid:bob",
			&privatecontentpb.ListRecoverablePrivateContentRequest{
				Cursor: "malformed!",
				Limit:  1,
			},
		)
		if !socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentInvalidArgument,
		) {
			t.Fatalf("malformed cursor error = %v", err)
		}
	})

	t.Run("cursor is bound to actor", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		for index := 0; index < 2; index++ {
			seedRecoverablePrivateMoment(
				t,
				fixture,
				"actor-cursor-"+string(rune('a'+index)),
			)
			fixture.clock.now = fixture.clock.now.Add(time.Second)
		}
		first := listRecoverablePrivateContent(
			t,
			fixture,
			"ptid:bob",
			"",
			1,
		)
		_, err := fixture.service.ListRecoverablePrivateContent(
			context.Background(),
			"ptid:eve",
			&privatecontentpb.ListRecoverablePrivateContentRequest{
				Cursor: first.GetNextCursor(),
				Limit:  1,
			},
		)
		if !socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentInvalidArgument,
		) {
			t.Fatalf("cross-actor cursor error = %v", err)
		}
	})

	t.Run("resource generation mismatch fails integrity validation", func(t *testing.T) {
		fixture := newPrivateContentServiceFixture(t)
		seed := seedRecoverablePrivateMoment(
			t,
			fixture,
			"generation-mismatch",
		)
		var row dbmodel.SocialPrivateContentEnvelope
		if err := fixture.database.Where(
			"content_id = ? AND key_kind = ? AND recipient_ptid = ?",
			seed.contentID,
			infrastructure.PrivateContentKeyKindActorRecovery,
			"ptid:bob",
		).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		envelope := &securecontentpb.PreparedContentKeyEnvelope{}
		if err := proto.Unmarshal(
			row.PreparedEnvelopeBytes,
			envelope,
		); err != nil {
			t.Fatal(err)
		}
		envelope.Binding.Resource.Generation++
		bindingHash, err := securecontentkernel.EnvelopeBindingSHA256(
			envelope.GetBinding(),
		)
		if err != nil {
			t.Fatal(err)
		}
		envelope.BindingSha256 = bindingHash[:]
		envelopeBytes, err := socialdomain.CanonicalProtoBytes(envelope)
		if err != nil {
			t.Fatal(err)
		}
		envelopeHash := sha256.Sum256(envelopeBytes)
		if err := fixture.database.Model(
			&dbmodel.SocialPrivateContentEnvelope{},
		).Where(
			"content_id = ? AND key_kind = ? AND recipient_ptid = ?",
			seed.contentID,
			infrastructure.PrivateContentKeyKindActorRecovery,
			"ptid:bob",
		).Updates(map[string]any{
			"prepared_envelope_bytes": envelopeBytes,
			"binding_sha256":          bindingHash[:],
			"envelope_sha256":         envelopeHash[:],
		}).Error; err != nil {
			t.Fatal(err)
		}

		_, err = fixture.service.ListRecoverablePrivateContent(
			context.Background(),
			"ptid:bob",
			&privatecontentpb.ListRecoverablePrivateContentRequest{
				Limit: 10,
			},
		)
		if !socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentIntegrityFailed,
		) {
			t.Fatalf("generation mismatch error = %v", err)
		}
	})
}

type recoverableSeed struct {
	contentID               string
	postID                  string
	commentID               string
	snapshotID              string
	payloadCiphertextSHA256 []byte
}

func seedRecoverablePrivateMoment(
	t *testing.T,
	fixture *privateContentServiceFixture,
	label string,
) recoverableSeed {
	t.Helper()
	prepared, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		privateMomentPrepareRequest("prepare-"+label, label),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-"+label,
		"ciphertext-"+label,
	)
	response, err := fixture.service.SubmitPrivateMoment(
		context.Background(),
		fixture.author.Endpoint,
		submit,
	)
	if err != nil {
		t.Fatal(err)
	}
	var plan dbmodel.SocialPrivateContentPlan
	if err := fixture.database.Where(
		"content_id = ?",
		prepared.GetPlan().GetResource().GetContentId(),
	).Take(&plan).Error; err != nil {
		t.Fatal(err)
	}

	return recoverableSeed{
		contentID:  prepared.GetPlan().GetResource().GetContentId(),
		postID:     response.GetPost().GetMetadata().GetPostId(),
		snapshotID: plan.AudienceSnapshotID,
		payloadCiphertextSHA256: clonePrivateTestBytes(
			submit.GetPayload().GetCiphertextSha256(),
		),
	}
}

func seedRecoverablePrivateComment(
	t *testing.T,
	fixture *privateContentServiceFixture,
	postID string,
	label string,
) recoverableSeed {
	t.Helper()
	prepared, err := fixture.service.PreparePrivateComment(
		context.Background(),
		fixture.author,
		&privatecontentpb.PreparePrivateCommentRequest{
			PostId:           postID,
			CommentContentId: privateTestContentID(label),
			CommandId:        "prepare-" + label,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	momentSubmit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-"+label,
		"ciphertext-"+label,
	)
	submit := &privatecontentpb.SubmitPrivateCommentRequest{
		Plan:      momentSubmit.GetPlan(),
		Payload:   momentSubmit.GetPayload(),
		Envelopes: momentSubmit.GetEnvelopes(),
		Objects:   momentSubmit.GetObjects(),
		CommandId: momentSubmit.GetCommandId(),
	}
	response, err := fixture.service.SubmitPrivateComment(
		context.Background(),
		fixture.author.Endpoint,
		submit,
	)
	if err != nil {
		t.Fatal(err)
	}
	var plan dbmodel.SocialPrivateContentPlan
	if err := fixture.database.Where(
		"content_id = ?",
		prepared.GetPlan().GetResource().GetContentId(),
	).Take(&plan).Error; err != nil {
		t.Fatal(err)
	}

	return recoverableSeed{
		contentID:  prepared.GetPlan().GetResource().GetContentId(),
		postID:     response.GetComment().GetMetadata().GetPostId(),
		commentID:  response.GetComment().GetMetadata().GetCommentId(),
		snapshotID: plan.AudienceSnapshotID,
		payloadCiphertextSHA256: clonePrivateTestBytes(
			submit.GetPayload().GetCiphertextSha256(),
		),
	}
}

func listRecoverablePrivateContent(
	t *testing.T,
	fixture *privateContentServiceFixture,
	actorPTID string,
	cursor string,
	limit uint32,
) *privatecontentpb.ListRecoverablePrivateContentResponse {
	t.Helper()
	response, err := fixture.service.ListRecoverablePrivateContent(
		context.Background(),
		actorPTID,
		&privatecontentpb.ListRecoverablePrivateContentRequest{
			Cursor: cursor,
			Limit:  limit,
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	return response
}
