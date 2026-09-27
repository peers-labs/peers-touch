package application

import (
	"context"
	"fmt"
	"testing"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
)

func TestProjectPublicCommentResourcePreservesHydratedAuthorIdentity(
	t *testing.T,
) {
	const authorPTID = "ptid:v1:actor:peers:p:alice:stable-fingerprint"
	resource := ProjectPublicCommentResource(&actormodel.Comment{
		Id:         "101",
		PostId:     "202",
		AuthorPtid: authorPTID,
		Author: &actormodel.PostAuthor{
			Id:              authorPTID,
			FederatedHandle: "@alice@station.example",
		},
		Content: "public Comment",
	})

	author := resource.GetMetadata().GetAuthor()
	if author.GetPtid() != authorPTID ||
		author.GetAcct() != "alice@station.example" {
		t.Fatalf(
			"public Comment author = %+v, want stable PTID and canonical acct",
			author,
		)
	}
}

func TestPrivateContentServiceCommentPointReadAndBoundedList(t *testing.T) {
	fixture := newPrivateContentServiceFixture(t)
	ctx := context.Background()
	postID := publishPrivateCommentParent(t, fixture, "read-list")
	commentIDs := make([]string, 0, 3)
	for index := range 3 {
		fixture.clock.now = fixture.clock.now.Add(time.Minute)
		commentIDs = append(
			commentIDs,
			publishPrivateComment(
				t,
				fixture,
				postID,
				fmt.Sprintf("read-list-%d", index),
			),
		)
	}
	viewer := privateCommentBobViewer()

	point, err := fixture.service.GetPrivateComment(
		ctx,
		viewer,
		postID,
		commentIDs[2],
	)
	if err != nil {
		t.Fatal(err)
	}
	if point.GetComment().GetMetadata().GetCommentId() != commentIDs[2] ||
		point.GetComment().GetMetadata().GetPostId() != postID ||
		point.GetComment().GetPrivateContent().GetViewerEnvelope() == nil {
		t.Fatalf("private Comment point read = %+v", point)
	}
	if !proto.Equal(
		point.GetComment().GetMetadata().GetAuthor(),
		point.GetComment().GetPrivateContent().GetVerification().
			GetCommitProof().GetAuthor().GetActor(),
	) {
		t.Fatal("private Comment read metadata does not preserve the proven author identity")
	}

	first, err := fixture.service.ListPrivateComments(
		ctx,
		viewer,
		&privatecontentpb.ListMomentCommentsRequest{
			PostId: postID,
			Limit:  2,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !first.GetHasMore() ||
		first.GetNextCursor() == "" ||
		len(first.GetComments()) != 2 ||
		first.GetComments()[0].GetMetadata().GetCommentId() != commentIDs[2] ||
		first.GetComments()[1].GetMetadata().GetCommentId() != commentIDs[1] {
		t.Fatalf("first private Comment page = %+v", first)
	}
	second, err := fixture.service.ListPrivateComments(
		ctx,
		viewer,
		&privatecontentpb.ListMomentCommentsRequest{
			PostId: postID,
			Cursor: first.GetNextCursor(),
			Limit:  2,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if second.GetHasMore() ||
		second.GetNextCursor() != "" ||
		len(second.GetComments()) != 1 ||
		second.GetComments()[0].GetMetadata().GetCommentId() != commentIDs[0] {
		t.Fatalf("second private Comment page = %+v", second)
	}

	for _, limit := range []uint32{0, 101} {
		_, err := fixture.service.ListPrivateComments(
			ctx,
			viewer,
			&privatecontentpb.ListMomentCommentsRequest{
				PostId: postID,
				Limit:  limit,
			},
		)
		if !socialdomain.IsPrivateContentCode(
			err,
			socialdomain.PrivateContentInvalidArgument,
		) {
			t.Fatalf("limit %d error = %v", limit, err)
		}
	}
}

func TestPrivateContentServiceParentAuthorCannotBypassCommentBlocks(
	t *testing.T,
) {
	for _, testCase := range []struct {
		name    string
		blocker string
		blocked string
	}{
		{
			name:    "Comment author blocks Post author",
			blocker: "ptid:bob",
			blocked: "ptid:alice",
		},
		{
			name:    "Post author blocks Comment author",
			blocker: "ptid:alice",
			blocked: "ptid:bob",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newPrivateContentServiceFixture(t)
			postID := publishPrivateCommentParent(
				t,
				fixture,
				"parent-author-block-"+testCase.name,
			)
			fixture.clock.now = fixture.clock.now.Add(time.Minute)
			commentID := publishPrivateComment(
				t,
				fixture,
				postID,
				"parent-author-block-"+testCase.name,
			)
			if err := fixture.database.Model(
				&dbmodel.SocialPrivateContentComment{},
			).Where(
				"comment_id = ?",
				commentID,
			).UpdateColumn("author_ptid", "ptid:bob").Error; err != nil {
				t.Fatal(err)
			}
			if err := fixture.database.Exec(`
INSERT INTO friend_chat_friendships (
  actor_ptid, peer_ptid, status, created_at, updated_at
) VALUES (?, ?, ?, ?, ?)`,
				testCase.blocker,
				testCase.blocked,
				3,
				fixture.clock.now,
				fixture.clock.now,
			).Error; err != nil {
				t.Fatal(err)
			}

			_, pointErr := fixture.service.GetPrivateComment(
				context.Background(),
				fixture.author.Endpoint,
				postID,
				commentID,
			)
			if !socialdomain.IsPrivateContentCode(
				pointErr,
				socialdomain.PrivateContentNotFound,
			) {
				t.Fatalf("blocked point-read error = %v", pointErr)
			}
			list, listErr := fixture.service.ListPrivateComments(
				context.Background(),
				fixture.author.Endpoint,
				&privatecontentpb.ListMomentCommentsRequest{
					PostId: postID,
					Limit:  10,
				},
			)
			if listErr != nil {
				t.Fatalf("blocked list error = %v", listErr)
			}
			if len(list.GetComments()) != 0 ||
				list.GetHasMore() ||
				list.GetNextCursor() != "" {
				t.Fatalf("blocked list exposed Comment: %+v", list)
			}
		})
	}
}

func TestPrivateContentServiceCommentReadsFailClosed(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		invalidate func(*testing.T, *privateContentServiceFixture, string)
	}{
		{
			name: "parent deleted",
			invalidate: func(
				t *testing.T,
				fixture *privateContentServiceFixture,
				postID string,
			) {
				t.Helper()
				deletedAt := fixture.clock.now.Add(time.Minute)
				if err := fixture.database.Model(
					&dbmodel.SocialPrivateContentPost{},
				).Where(
					"post_id = ?",
					postID,
				).UpdateColumn("deleted_at", deletedAt).Error; err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "parent inactive",
			invalidate: func(
				t *testing.T,
				fixture *privateContentServiceFixture,
				postID string,
			) {
				t.Helper()
				if err := fixture.database.Model(
					&dbmodel.SocialPrivateContentPost{},
				).Where(
					"post_id = ?",
					postID,
				).UpdateColumn("lifecycle_state", "INVALIDATED").Error; err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "current friendship removed",
			invalidate: func(
				t *testing.T,
				fixture *privateContentServiceFixture,
				_ string,
			) {
				t.Helper()
				if err := fixture.database.Exec(
					`DELETE FROM social_relationship_projections
					 WHERE owner_ptid = ? AND peer_ptid = ?`,
					"ptid:alice",
					"ptid:bob",
				).Error; err != nil {
					t.Fatal(err)
				}
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newPrivateContentServiceFixture(t)
			ctx := context.Background()
			postID := publishPrivateCommentParent(
				t,
				fixture,
				"fail-closed-"+testCase.name,
			)
			fixture.clock.now = fixture.clock.now.Add(time.Minute)
			commentID := publishPrivateComment(
				t,
				fixture,
				postID,
				"fail-closed-"+testCase.name,
			)
			viewer := privateCommentBobViewer()
			if _, err := fixture.service.GetPrivateComment(
				ctx,
				viewer,
				postID,
				commentID,
			); err != nil {
				t.Fatalf("baseline point read: %v", err)
			}

			testCase.invalidate(t, fixture, postID)
			_, pointErr := fixture.service.GetPrivateComment(
				ctx,
				viewer,
				postID,
				commentID,
			)
			if !socialdomain.IsPrivateContentCode(
				pointErr,
				socialdomain.PrivateContentNotFound,
			) {
				t.Fatalf("invalidated point-read error = %v", pointErr)
			}
			_, listErr := fixture.service.ListPrivateComments(
				ctx,
				viewer,
				&privatecontentpb.ListMomentCommentsRequest{
					PostId: postID,
					Limit:  10,
				},
			)
			if !socialdomain.IsPrivateContentCode(
				listErr,
				socialdomain.PrivateContentNotFound,
			) {
				t.Fatalf("invalidated list error = %v", listErr)
			}
		})
	}
}

func TestPrivateContentServiceCommentSubmitRejectsInvalidatedParent(
	t *testing.T,
) {
	for _, testCase := range []struct {
		name       string
		invalidate func(*testing.T, *privateContentServiceFixture, string)
	}{
		{
			name: "deleted",
			invalidate: func(
				t *testing.T,
				fixture *privateContentServiceFixture,
				postID string,
			) {
				t.Helper()
				deletedAt := fixture.clock.now.Add(time.Minute)
				if err := fixture.database.Model(
					&dbmodel.SocialPrivateContentPost{},
				).Where(
					"post_id = ?",
					postID,
				).UpdateColumn("deleted_at", deletedAt).Error; err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "inactive",
			invalidate: func(
				t *testing.T,
				fixture *privateContentServiceFixture,
				postID string,
			) {
				t.Helper()
				if err := fixture.database.Model(
					&dbmodel.SocialPrivateContentPost{},
				).Where(
					"post_id = ?",
					postID,
				).UpdateColumn("lifecycle_state", "INVALIDATED").Error; err != nil {
					t.Fatal(err)
				}
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newPrivateContentServiceFixture(t)
			postID := publishPrivateCommentParent(
				t,
				fixture,
				"submit-invalid-parent-"+testCase.name,
			)
			prepared, err := fixture.service.PreparePrivateComment(
				context.Background(),
				fixture.author,
				&privatecontentpb.PreparePrivateCommentRequest{
					PostId: postID,
					CommentContentId: privateTestContentID(
						"invalid-parent-comment-" + testCase.name,
					),
					CommandId: "prepare-invalid-parent-comment-" +
						testCase.name,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			testCase.invalidate(t, fixture, postID)
			submit := privateTextSubmitRequest(
				t,
				prepared.GetPlan(),
				fixture.author.Endpoint,
				fixture.authorPrivateKey,
				"submit-invalid-parent-comment-"+testCase.name,
				"must not persist",
			)
			request := &privatecontentpb.SubmitPrivateCommentRequest{
				Plan:      submit.GetPlan(),
				Payload:   submit.GetPayload(),
				Envelopes: submit.GetEnvelopes(),
				Objects:   submit.GetObjects(),
				CommandId: submit.GetCommandId(),
			}
			for attempt := 1; attempt <= 2; attempt++ {
				_, err = fixture.service.SubmitPrivateComment(
					context.Background(),
					fixture.author.Endpoint,
					request,
				)
				if !socialdomain.IsPrivateContentCode(
					err,
					socialdomain.PrivateContentStalePlan,
				) {
					t.Fatalf(
						"invalidated parent submit attempt %d error = %v",
						attempt,
						err,
					)
				}
			}
			var plan dbmodel.SocialPrivateContentPlan
			if err := fixture.database.First(
				&plan,
				"plan_id = ?",
				prepared.GetPlan().GetPlanId(),
			).Error; err != nil {
				t.Fatal(err)
			}
			if plan.State != dbmodel.SocialPrivatePlanStateRejectedStale ||
				plan.DomainCommitID != "" ||
				plan.ConsumedAt != nil {
				t.Fatalf("invalidated parent plan state = %+v", plan)
			}
			assertPrivateContentCount(
				t,
				fixture.database,
				&dbmodel.SocialPrivateContentComment{},
				0,
			)
			var receiptCount int64
			if err := fixture.database.Model(
				&dbmodel.SocialPrivateCommandReceipt{},
			).Where(
				"command_id = ?",
				request.GetCommandId(),
			).Count(&receiptCount).Error; err != nil {
				t.Fatal(err)
			}
			if receiptCount != 0 {
				t.Fatalf(
					"invalidated parent receipt count = %d, want 0",
					receiptCount,
				)
			}
		})
	}
}

func TestPrivateContentServiceCommentRateAdmissionTransactionBoundaries(
	t *testing.T,
) {
	for _, testCase := range []struct {
		name       string
		key        string
		limit      int
		authorPTID func(int) string
	}{
		{
			name:  "actor per Post",
			key:   "actor",
			limit: int(privateCommentActorLimit),
			authorPTID: func(int) string {
				return "ptid:alice"
			},
		},
		{
			name:  "Post total",
			key:   "post",
			limit: int(privateCommentPostLimit),
			authorPTID: func(index int) string {
				return fmt.Sprintf("ptid:other-%d", index)
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newPrivateContentServiceFixture(t)
			postID := publishPrivateCommentParent(
				t,
				fixture,
				"rate-"+testCase.key,
			)
			seedPrivateCommentRateWindow(
				t,
				fixture,
				postID,
				testCase.limit-1,
				testCase.authorPTID,
			)
			admittedCommentID := publishPrivateComment(
				t,
				fixture,
				postID,
				"rate-boundary-"+testCase.key,
			)
			var admittedPlan dbmodel.SocialPrivateContentPlan
			if err := fixture.database.First(
				&admittedPlan,
				"content_id = ?",
				admittedCommentID,
			).Error; err != nil {
				t.Fatal(err)
			}
			if admittedPlan.State != dbmodel.SocialPrivatePlanStateConsumed {
				t.Fatalf(
					"%dth Comment plan state = %s, want CONSUMED",
					testCase.limit,
					admittedPlan.State,
				)
			}

			prepared, err := fixture.service.PreparePrivateComment(
				context.Background(),
				fixture.author,
				&privatecontentpb.PreparePrivateCommentRequest{
					PostId: postID,
					CommentContentId: privateTestContentID(
						"rate-next-" + testCase.key,
					),
					CommandId: "prepare-rate-" + testCase.key,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			submit := privateTextSubmitRequest(
				t,
				prepared.GetPlan(),
				fixture.author.Endpoint,
				fixture.authorPrivateKey,
				"submit-rate-"+testCase.key,
				"rate-limit-comment",
			)
			_, err = fixture.service.SubmitPrivateComment(
				context.Background(),
				fixture.author.Endpoint,
				&privatecontentpb.SubmitPrivateCommentRequest{
					Plan:      submit.GetPlan(),
					Payload:   submit.GetPayload(),
					Envelopes: submit.GetEnvelopes(),
					Objects:   submit.GetObjects(),
					CommandId: submit.GetCommandId(),
				},
			)
			if !socialdomain.IsPrivateContentCode(
				err,
				socialdomain.PrivateContentRateLimited,
			) {
				t.Fatalf("rate-limit error = %v", err)
			}
			retryAfter := socialdomain.PrivateContentRetryAfter(err)
			if retryAfter < 59*time.Minute ||
				retryAfter > 59*time.Minute+time.Second {
				t.Fatalf("retry after = %s, want about 59m", retryAfter)
			}

			assertPrivateContentCount(
				t,
				fixture.database,
				&dbmodel.SocialPrivateContentComment{},
				int64(testCase.limit),
			)
			var parent dbmodel.SocialPrivateContentPost
			if err := fixture.database.First(
				&parent,
				"post_id = ?",
				postID,
			).Error; err != nil {
				t.Fatal(err)
			}
			if parent.CommentsCount != int64(testCase.limit) {
				t.Fatalf(
					"parent CommentsCount = %d, want %d",
					parent.CommentsCount,
					testCase.limit,
				)
			}
			var plan dbmodel.SocialPrivateContentPlan
			if err := fixture.database.First(
				&plan,
				"plan_id = ?",
				prepared.GetPlan().GetPlanId(),
			).Error; err != nil {
				t.Fatal(err)
			}
			if plan.State != dbmodel.SocialPrivatePlanStatePrepared ||
				plan.DomainCommitID != "" ||
				plan.ConsumedAt != nil {
				t.Fatalf(
					"%dth Comment rate-limited plan was consumed: %+v",
					testCase.limit+1,
					plan,
				)
			}
		})
	}
}

func publishPrivateCommentParent(
	t *testing.T,
	fixture *privateContentServiceFixture,
	label string,
) string {
	t.Helper()
	prepared, err := fixture.service.PreparePrivateMoment(
		context.Background(),
		fixture.author,
		privateMomentPrepareRequest(
			"prepare-comment-parent-"+label,
			"comment-parent-"+label,
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-comment-parent-"+label,
		"private Comment parent",
	)
	response, err := fixture.service.SubmitPrivateMoment(
		context.Background(),
		fixture.author.Endpoint,
		submit,
	)
	if err != nil {
		t.Fatal(err)
	}
	return response.GetPost().GetMetadata().GetPostId()
}

func publishPrivateComment(
	t *testing.T,
	fixture *privateContentServiceFixture,
	postID string,
	label string,
) string {
	t.Helper()
	prepared, err := fixture.service.PreparePrivateComment(
		context.Background(),
		fixture.author,
		&privatecontentpb.PreparePrivateCommentRequest{
			PostId:           postID,
			CommentContentId: privateTestContentID("comment-" + label),
			CommandId:        "prepare-comment-" + label,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	submit := privateTextSubmitRequest(
		t,
		prepared.GetPlan(),
		fixture.author.Endpoint,
		fixture.authorPrivateKey,
		"submit-comment-"+label,
		"private Comment "+label,
	)
	response, err := fixture.service.SubmitPrivateComment(
		context.Background(),
		fixture.author.Endpoint,
		&privatecontentpb.SubmitPrivateCommentRequest{
			Plan:      submit.GetPlan(),
			Payload:   submit.GetPayload(),
			Envelopes: submit.GetEnvelopes(),
			Objects:   submit.GetObjects(),
			CommandId: submit.GetCommandId(),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return response.GetComment().GetMetadata().GetCommentId()
}

func seedPrivateCommentRateWindow(
	t *testing.T,
	fixture *privateContentServiceFixture,
	postID string,
	count int,
	authorPTID func(int) string,
) {
	t.Helper()
	oldestAt := fixture.clock.now.Add(-time.Minute)
	comments := make([]dbmodel.SocialPrivateContentComment, 0, count)
	for index := range count {
		contentID := privateTestContentID(
			fmt.Sprintf("rate-seed-%s-%d", postID, index),
		)
		comments = append(
			comments,
			dbmodel.SocialPrivateContentComment{
				CommentID:                 contentID,
				ContentID:                 contentID,
				PostID:                    postID,
				AuthorPTID:                authorPTID(index),
				Generation:                1,
				InteractionSnapshotID:     "rate-snapshot",
				EncryptedPayloadBytes:     []byte("rate-payload"),
				EncryptedPayloadSHA256:    privateDigest("rate-payload"),
				ObjectDescriptorSetSHA256: privateDigest("rate-objects"),
				LifecycleState:            privateContentActiveState,
				CreatedAt:                 oldestAt.Add(time.Duration(index)),
				UpdatedAt:                 oldestAt.Add(time.Duration(index)),
			},
		)
	}
	if err := fixture.database.CreateInBatches(comments, 100).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.database.Model(
		&dbmodel.SocialPrivateContentPost{},
	).Where(
		"post_id = ?",
		postID,
	).UpdateColumn("comments_count", count).Error; err != nil {
		t.Fatal(err)
	}
}

func privateCommentBobViewer() *actormodel.ActorDeviceRef {
	return &actormodel.ActorDeviceRef{
		Actor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		DeviceId: "bob-device",
	}
}
