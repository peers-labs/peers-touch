package social

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/handler"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/repository"
	"github.com/peers-labs/peers-touch/station/frame/touch/social/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

type TestContext struct {
	ctx     context.Context
	db      *gorm.DB
	repo    *repository.FollowRepository
	service *service.RelationshipService
	handler *handler.RelationshipHandler
	user1   *db.User
	user2   *db.User
	user3   *db.User
}

func setupTestContext(t *testing.T) *TestContext {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	rds, err := store.GetRDS(ctx)
	require.NoError(t, err, "Failed to get database connection")

	repo := repository.NewFollowRepository(rds)
	svc := service.NewRelationshipService(repo)
	hdl := handler.NewRelationshipHandler(svc)

	tc := &TestContext{
		ctx:     ctx,
		db:      rds,
		repo:    repo,
		service: svc,
		handler: hdl,
	}

	tc.createTestUsers(t)
	return tc
}

func (tc *TestContext) createTestUsers(t *testing.T) {
	now := time.Now()

	tc.user1 = &db.User{
		Username:  fmt.Sprintf("test_user_1_%d", now.Unix()),
		Email:     fmt.Sprintf("test1_%d@example.com", now.Unix()),
		Name:      "Test User 1",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, tc.db.Create(tc.user1).Error)

	tc.user2 = &db.User{
		Username:  fmt.Sprintf("test_user_2_%d", now.Unix()),
		Email:     fmt.Sprintf("test2_%d@example.com", now.Unix()),
		Name:      "Test User 2",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, tc.db.Create(tc.user2).Error)

	tc.user3 = &db.User{
		Username:  fmt.Sprintf("test_user_3_%d", now.Unix()),
		Email:     fmt.Sprintf("test3_%d@example.com", now.Unix()),
		Name:      "Test User 3",
		CreatedAt: now,
		UpdatedAt: now,
	}
	require.NoError(t, tc.db.Create(tc.user3).Error)
}

func (tc *TestContext) cleanup(t *testing.T) {
	if tc.user1 != nil {
		tc.db.Unscoped().Delete(tc.user1)
	}
	if tc.user2 != nil {
		tc.db.Unscoped().Delete(tc.user2)
	}
	if tc.user3 != nil {
		tc.db.Unscoped().Delete(tc.user3)
	}

	tc.db.Where("follower_id IN (?, ?, ?)", tc.user1.ID, tc.user2.ID, tc.user3.ID).
		Unscoped().Delete(&db.Follow{})
	tc.db.Where("following_id IN (?, ?, ?)", tc.user1.ID, tc.user2.ID, tc.user3.ID).
		Unscoped().Delete(&db.Follow{})
}

func TestFollowUnfollowEndToEnd(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Follow and Unfollow workflow", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)

		t.Log("Step 1: User1 follows User2")
		err := tc.service.Follow(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)

		t.Log("Step 2: Verify follow relationship in database")
		var follow db.Follow
		err = tc.db.Where("follower_id = ? AND following_id = ?", tc.user1.ID, tc.user2.ID).
			First(&follow).Error
		require.NoError(t, err)
		assert.Equal(t, tc.user1.ID, follow.FollowerID)
		assert.Equal(t, tc.user2.ID, follow.FollowingID)

		t.Log("Step 3: Get relationship status")
		rel, err := tc.service.GetRelationship(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)
		assert.True(t, rel.Following, "User1 should be following User2")
		assert.False(t, rel.FollowedBy, "User2 should not be following User1")

		t.Log("Step 4: User1 unfollows User2")
		err = tc.service.Unfollow(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)

		t.Log("Step 5: Verify unfollow in database")
		err = tc.db.Where("follower_id = ? AND following_id = ?", tc.user1.ID, tc.user2.ID).
			First(&follow).Error
		assert.Error(t, err)
		assert.Equal(t, gorm.ErrRecordNotFound, err)

		t.Log("Step 6: Verify relationship status after unfollow")
		rel, err = tc.service.GetRelationship(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)
		assert.False(t, rel.Following)
		assert.False(t, rel.FollowedBy)
	})
}

func TestMutualFollowRelationship(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Mutual follow creates bidirectional relationship", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)

		t.Log("User1 follows User2")
		err := tc.service.Follow(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)

		t.Log("User2 follows User1")
		err = tc.service.Follow(tc.ctx, user2ID, user1ID)
		require.NoError(t, err)

		t.Log("Verify mutual follow from User1's perspective")
		rel, err := tc.service.GetRelationship(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)
		assert.True(t, rel.Following, "User1 should be following User2")
		assert.True(t, rel.FollowedBy, "User1 should be followed by User2")

		t.Log("Verify mutual follow from User2's perspective")
		rel, err = tc.service.GetRelationship(tc.ctx, user2ID, user1ID)
		require.NoError(t, err)
		assert.True(t, rel.Following, "User2 should be following User1")
		assert.True(t, rel.FollowedBy, "User2 should be followed by User1")
	})
}

func TestBatchGetRelationships(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Get multiple relationships at once", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)
		user3ID := fmt.Sprintf("%d", tc.user3.ID)

		t.Log("Setup: User1 follows User2 and User3")
		require.NoError(t, tc.service.Follow(tc.ctx, user1ID, user2ID))
		require.NoError(t, tc.service.Follow(tc.ctx, user1ID, user3ID))

		t.Log("Setup: User2 follows User1")
		require.NoError(t, tc.service.Follow(tc.ctx, user2ID, user1ID))

		t.Log("Get relationships for User1 with User2 and User3")
		relationships, err := tc.service.GetRelationships(tc.ctx, user1ID, []string{user2ID, user3ID})
		require.NoError(t, err)
		require.Len(t, relationships, 2)

		t.Log("Verify User1 -> User2 relationship")
		rel2 := relationships[user2ID]
		assert.True(t, rel2.Following, "User1 should be following User2")
		assert.True(t, rel2.FollowedBy, "User1 should be followed by User2")

		t.Log("Verify User1 -> User3 relationship")
		rel3 := relationships[user3ID]
		assert.True(t, rel3.Following, "User1 should be following User3")
		assert.False(t, rel3.FollowedBy, "User1 should not be followed by User3")
	})
}

func TestFollowersAndFollowingLists(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Get followers and following lists", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)
		user3ID := fmt.Sprintf("%d", tc.user3.ID)

		t.Log("Setup: User2 and User3 follow User1")
		require.NoError(t, tc.service.Follow(tc.ctx, user2ID, user1ID))
		require.NoError(t, tc.service.Follow(tc.ctx, user3ID, user1ID))

		t.Log("Setup: User1 follows User2")
		require.NoError(t, tc.service.Follow(tc.ctx, user1ID, user2ID))

		t.Log("Get User1's followers")
		followers, nextCursor, total, err := tc.service.GetFollowers(tc.ctx, user1ID, "", 10)
		require.NoError(t, err)
		assert.Len(t, followers, 2, "User1 should have 2 followers")
		assert.Equal(t, int64(2), total)
		assert.Empty(t, nextCursor, "Should not have next cursor with only 2 followers")

		followerIDs := make(map[string]bool)
		for _, f := range followers {
			followerIDs[f.ActorId] = true
		}
		assert.True(t, followerIDs[user2ID], "User2 should be in followers")
		assert.True(t, followerIDs[user3ID], "User3 should be in followers")

		t.Log("Get User1's following list")
		following, nextCursor, total, err := tc.service.GetFollowing(tc.ctx, user1ID, "", 10)
		require.NoError(t, err)
		assert.Len(t, following, 1, "User1 should be following 1 user")
		assert.Equal(t, int64(1), total)
		assert.Empty(t, nextCursor)
		assert.Equal(t, user2ID, following[0].ActorId)
	})
}

func TestFollowCounters(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Follower and following counts are accurate", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)
		user3ID := fmt.Sprintf("%d", tc.user3.ID)

		t.Log("Setup relationships")
		require.NoError(t, tc.service.Follow(tc.ctx, user1ID, user2ID))
		require.NoError(t, tc.service.Follow(tc.ctx, user1ID, user3ID))
		require.NoError(t, tc.service.Follow(tc.ctx, user2ID, user1ID))

		t.Log("Check User1's counts")
		followerCount, err := tc.repo.GetFollowerCount(tc.ctx, tc.user1.ID)
		require.NoError(t, err)
		assert.Equal(t, int64(1), followerCount, "User1 should have 1 follower")

		followingCount, err := tc.repo.GetFollowingCount(tc.ctx, tc.user1.ID)
		require.NoError(t, err)
		assert.Equal(t, int64(2), followingCount, "User1 should be following 2 users")

		t.Log("Check User2's counts")
		followerCount, err = tc.repo.GetFollowerCount(tc.ctx, tc.user2.ID)
		require.NoError(t, err)
		assert.Equal(t, int64(1), followerCount, "User2 should have 1 follower")

		followingCount, err = tc.repo.GetFollowingCount(tc.ctx, tc.user2.ID)
		require.NoError(t, err)
		assert.Equal(t, int64(1), followingCount, "User2 should be following 1 user")
	})
}

func TestDuplicateFollowPrevention(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Cannot follow the same user twice", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)

		t.Log("First follow should succeed")
		err := tc.service.Follow(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)

		t.Log("Second follow should be idempotent (no error)")
		err = tc.service.Follow(tc.ctx, user1ID, user2ID)
		require.NoError(t, err)

		t.Log("Verify only one follow record exists")
		var count int64
		err = tc.db.Model(&db.Follow{}).
			Where("follower_id = ? AND following_id = ?", tc.user1.ID, tc.user2.ID).
			Count(&count).Error
		require.NoError(t, err)
		assert.Equal(t, int64(1), count, "Should have exactly 1 follow record")
	})
}

func TestUnfollowNonexistentRelationship(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Unfollowing non-existent relationship should not error", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)

		t.Log("Unfollow without prior follow")
		err := tc.service.Unfollow(tc.ctx, user1ID, user2ID)
		require.NoError(t, err, "Unfollow should be idempotent")
	})
}

func TestFollowAPIHandler(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Follow API endpoint with protobuf", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)

		req := &model.FollowRequest{
			TargetActorId: user2ID,
		}
		reqData, err := proto.Marshal(req)
		require.NoError(t, err)

		httpReq := httptest.NewRequest(http.MethodPost, "/api/v1/social/relationships/follow", bytes.NewReader(reqData))
		httpReq.Header.Set("Content-Type", "application/protobuf")

		ctx := context.WithValue(httpReq.Context(), "user_id", user1ID)
		httpReq = httpReq.WithContext(ctx)

		w := httptest.NewRecorder()

		tc.handler.Follow(w, httpReq)

		assert.Equal(t, http.StatusOK, w.Code)

		var resp model.FollowResponse
		err = proto.Unmarshal(w.Body.Bytes(), &resp)
		require.NoError(t, err)
		assert.True(t, resp.Success)
		assert.NotNil(t, resp.Relationship)
		assert.True(t, resp.Relationship.Following)
	})
}

func TestPaginationWithCursor(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Pagination works correctly", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)
		user2ID := fmt.Sprintf("%d", tc.user2.ID)
		user3ID := fmt.Sprintf("%d", tc.user3.ID)

		t.Log("Setup: User2 and User3 follow User1")
		require.NoError(t, tc.service.Follow(tc.ctx, user2ID, user1ID))
		require.NoError(t, tc.service.Follow(tc.ctx, user3ID, user1ID))

		t.Log("Get first page with limit=1")
		followers, nextCursor, total, err := tc.service.GetFollowers(tc.ctx, user1ID, "", 1)
		require.NoError(t, err)
		assert.Len(t, followers, 1)
		assert.Equal(t, int64(2), total)
		assert.NotEmpty(t, nextCursor, "Should have next cursor")

		t.Log("Get second page using cursor")
		followers2, nextCursor2, total2, err := tc.service.GetFollowers(tc.ctx, user1ID, nextCursor, 1)
		require.NoError(t, err)
		assert.Len(t, followers2, 1)
		assert.Equal(t, int64(2), total2)
		assert.Empty(t, nextCursor2, "Should not have next cursor on last page")

		t.Log("Verify different users returned")
		assert.NotEqual(t, followers[0].ActorId, followers2[0].ActorId)
	})
}

func TestErrorHandling(t *testing.T) {
	tc := setupTestContext(t)
	defer tc.cleanup(t)

	t.Run("Invalid actor IDs", func(t *testing.T) {
		t.Log("Follow with invalid target ID")
		err := tc.service.Follow(tc.ctx, fmt.Sprintf("%d", tc.user1.ID), "invalid")
		assert.Error(t, err)

		t.Log("Follow with invalid source ID")
		err = tc.service.Follow(tc.ctx, "invalid", fmt.Sprintf("%d", tc.user2.ID))
		assert.Error(t, err)

		t.Log("Get relationship with invalid ID")
		_, err = tc.service.GetRelationship(tc.ctx, "invalid", fmt.Sprintf("%d", tc.user2.ID))
		assert.Error(t, err)
	})

	t.Run("Self-follow prevention", func(t *testing.T) {
		user1ID := fmt.Sprintf("%d", tc.user1.ID)

		t.Log("User cannot follow themselves")
		err := tc.service.Follow(tc.ctx, user1ID, user1ID)
		assert.Error(t, err, "Should not allow self-follow")
	})
}

func BenchmarkFollowOperation(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping benchmark in short mode")
	}

	ctx := context.Background()
	rds, err := store.GetRDS(ctx)
	if err != nil {
		b.Fatal(err)
	}

	repo := repository.NewFollowRepository(rds)
	svc := service.NewRelationshipService(repo)

	now := time.Now()
	user1 := &db.User{
		Username:  fmt.Sprintf("bench_user_1_%d", now.Unix()),
		Email:     fmt.Sprintf("bench1_%d@example.com", now.Unix()),
		Name:      "Bench User 1",
		CreatedAt: now,
		UpdatedAt: now,
	}
	rds.Create(user1)
	defer rds.Unscoped().Delete(user1)

	user2 := &db.User{
		Username:  fmt.Sprintf("bench_user_2_%d", now.Unix()),
		Email:     fmt.Sprintf("bench2_%d@example.com", now.Unix()),
		Name:      "Bench User 2",
		CreatedAt: now,
		UpdatedAt: now,
	}
	rds.Create(user2)
	defer rds.Unscoped().Delete(user2)

	user1ID := fmt.Sprintf("%d", user1.ID)
	user2ID := fmt.Sprintf("%d", user2.ID)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		svc.Follow(ctx, user1ID, user2ID)
		svc.Unfollow(ctx, user1ID, user2ID)
	}
}
