package touch

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCommentRepliesEndToEnd 端到端测试：从数据库到API的完整流程
func TestCommentRepliesEndToEnd(t *testing.T) {
	// 跳过如果没有数据库连接
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	rds, err := store.GetRDS(ctx)
	require.NoError(t, err, "Failed to get database connection")

	// 清理测试数据
	defer func() {
		rds.Where("activity_pub_id LIKE ?", "http://test.example.com/%").Delete(&db.ActivityPubObject{})
	}()

	t.Run("Database has comment but API returns empty", func(t *testing.T) {
		// 1. 创建父帖子
		parent := &db.ActivityPubObject{
			ActivityPubID: "http://test.example.com/user/objects/parent-1",
			Type:          "Note",
			Content:       "Parent post",
			AttributedTo:  "http://test.example.com/user/actor",
			RepliesCount:  1,
		}
		err := rds.Create(parent).Error
		require.NoError(t, err, "Failed to create parent object")

		// 2. 创建评论
		reply := &db.ActivityPubObject{
			ActivityPubID: "http://test.example.com/user/objects/reply-1",
			Type:          "Note",
			Content:       "This is a reply",
			AttributedTo:  "http://test.example.com/user/actor",
			InReplyTo:     parent.ID,
		}
		err = rds.Create(reply).Error
		require.NoError(t, err, "Failed to create reply object")

		// 3. 验证数据库中确实有评论
		var count int64
		err = rds.Model(&db.ActivityPubObject{}).
			Where("in_reply_to = ?", parent.ID).
			Count(&count).Error
		require.NoError(t, err)
		assert.Equal(t, int64(1), count, "Database should have 1 reply")

		// 4. 调用API获取评论
		replies, err := activitypub.FetchObjectReplies(
			ctx,
			parent.ActivityPubID,
			"http://test.example.com",
			true, // page=true
			0,    // afterID
			10,   // limit
		)
		require.NoError(t, err, "API should not return error")

		// 5. 验证API返回的数据
		repliesJSON, err := json.Marshal(replies)
		require.NoError(t, err)

		var result map[string]interface{}
		err = json.Unmarshal(repliesJSON, &result)
		require.NoError(t, err)

		// 6. 关键断言：API必须返回评论！
		orderedItems, ok := result["orderedItems"].([]interface{})
		require.True(t, ok, "orderedItems must exist")
		assert.NotEmpty(t, orderedItems, "CRITICAL: Database has 1 comment but API returned 0!")
		assert.Len(t, orderedItems, 1, "Should return exactly 1 comment")

		// 7. 验证评论内容
		firstComment := orderedItems[0].(map[string]interface{})
		assert.Equal(t, "This is a reply", firstComment["content"])
	})

	t.Run("CommentsCount matches actual replies", func(t *testing.T) {
		// 1. 创建父帖子
		parent := &db.ActivityPubObject{
			ActivityPubID: "http://test.example.com/user/objects/parent-2",
			Type:          "Note",
			Content:       "Parent post with multiple replies",
			AttributedTo:  "http://test.example.com/user/actor",
			RepliesCount:  3, // 声称有3条评论
		}
		err := rds.Create(parent).Error
		require.NoError(t, err)

		// 2. 创建3条评论
		for i := 1; i <= 3; i++ {
			reply := &db.ActivityPubObject{
				ActivityPubID: fmt.Sprintf("http://test.example.com/user/objects/reply-2-%d", i),
				Type:          "Note",
				Content:       fmt.Sprintf("Reply %d", i),
				AttributedTo:  "http://test.example.com/user/actor",
				InReplyTo:     parent.ID,
			}
			err = rds.Create(reply).Error
			require.NoError(t, err)
		}

		// 3. 调用API
		replies, err := activitypub.FetchObjectReplies(
			ctx,
			parent.ActivityPubID,
			"http://test.example.com",
			true,
			0,
			10,
		)
		require.NoError(t, err)

		// 4. 验证数量一致
		repliesJSON, _ := json.Marshal(replies)
		var result map[string]interface{}
		json.Unmarshal(repliesJSON, &result)

		orderedItems := result["orderedItems"].([]interface{})
		assert.Len(t, orderedItems, 3, "Should return all 3 comments")

		totalItems := int(result["totalItems"].(float64))
		assert.Equal(t, 3, totalItems, "totalItems should match actual count")
		assert.Equal(t, int(parent.RepliesCount), totalItems, "totalItems should match RepliesCount")
	})

	t.Run("URL encoding does not break objectId", func(t *testing.T) {
		// 测试带特殊字符的URL
		specialURLs := []string{
			"http://test.example.com/user-name/objects/123",
			"http://test.example.com/user/objects/123?param=value",
			"http://test.example.com/user/objects/123#section",
		}

		for _, objectID := range specialURLs {
			t.Run(objectID, func(t *testing.T) {
				// 创建对象
				parent := &db.ActivityPubObject{
					ActivityPubID: objectID,
					Type:          "Note",
					Content:       "Test post",
					AttributedTo:  "http://test.example.com/user/actor",
					RepliesCount:  0,
				}
				err := rds.Create(parent).Error
				require.NoError(t, err)

				// 调用API（objectId作为query参数传递）
				_, err = activitypub.FetchObjectReplies(
					ctx,
					objectID, // 直接传递，不编码
					"http://test.example.com",
					true,
					0,
					10,
				)

				// 不应该报错
				assert.NoError(t, err, "Should handle special characters in objectId")
			})
		}
	})
}

// TestCommentLoadingWorkflow 测试评论加载的完整工作流
func TestCommentLoadingWorkflow(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()
	rds, err := store.GetRDS(ctx)
	require.NoError(t, err)

	defer func() {
		rds.Where("activity_pub_id LIKE ?", "http://workflow.test.com/%").Delete(&db.ActivityPubObject{})
	}()

	// 模拟真实场景
	t.Run("User creates post, adds comment, views comment", func(t *testing.T) {
		// Step 1: 用户创建帖子
		post := &db.ActivityPubObject{
			ActivityPubID: "http://workflow.test.com/alice/objects/post-1",
			Type:          "Note",
			Content:       "Hi，这是第一个，有两张图",
			AttributedTo:  "http://workflow.test.com/alice/actor",
			RepliesCount:  0,
		}
		err := rds.Create(post).Error
		require.NoError(t, err, "Step 1 failed: Create post")

		// Step 2: 另一个用户添加评论
		comment := &db.ActivityPubObject{
			ActivityPubID: "http://workflow.test.com/bob/objects/comment-1",
			Type:          "Note",
			Content:       "hi",
			AttributedTo:  "http://workflow.test.com/bob/actor",
			InReplyTo:     post.ID,
		}
		err = rds.Create(comment).Error
		require.NoError(t, err, "Step 2 failed: Add comment")

		// Step 3: 更新父帖子的评论计数
		err = rds.Model(post).Update("replies_count", 1).Error
		require.NoError(t, err, "Step 3 failed: Update replies count")

		// Step 4: 前端请求评论列表
		replies, err := activitypub.FetchObjectReplies(
			ctx,
			post.ActivityPubID,
			"http://workflow.test.com",
			true,
			0,
			10,
		)
		require.NoError(t, err, "Step 4 failed: Fetch replies")

		// Step 5: 验证前端收到的数据
		repliesJSON, _ := json.Marshal(replies)
		var result map[string]interface{}
		json.Unmarshal(repliesJSON, &result)

		orderedItems := result["orderedItems"].([]interface{})
		
		// 关键验证：前端必须能看到评论！
		assert.NotEmpty(t, orderedItems, "CRITICAL: User cannot see comment in UI!")
		assert.Len(t, orderedItems, 1, "Should show exactly 1 comment")

		firstComment := orderedItems[0].(map[string]interface{})
		assert.Equal(t, "hi", firstComment["content"], "Comment content should match")
	})
}
