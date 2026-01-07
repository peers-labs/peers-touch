package touch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/cloudwego/hertz/pkg/app/server"
	"github.com/cloudwego/hertz/pkg/common/test/assert"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

func TestGetObjectRepliesQuery(t *testing.T) {
	h := server.Default()
	
	h.GET("/activitypub/object/replies", func(c context.Context, ctx *app.RequestContext) {
		GetObjectRepliesQuery(c, ctx)
	})

	tests := []struct {
		name           string
		objectID       string
		expectStatus   int
		expectError    bool
		setupDB        func()
	}{
		{
			name:         "Valid object ID with full URL",
			objectID:     "http://localhost:18080/activitypub/desktop-1/actor/objects/1767752347919249000",
			expectStatus: http.StatusOK,
			expectError:  false,
			setupDB: func() {
				// Setup test data in database
				rds, _ := store.GetRDS(context.Background())
				
				// Create parent object
				parent := &db.ActivityPubObject{
					ID:            318625416921235457,
					ActivityPubID: "http://localhost:18080/activitypub/desktop-1/actor/objects/1767752347919249000",
					Type:          "Note",
					Content:       "Parent post",
					RepliesCount:  1,
				}
				rds.Create(parent)
				
				// Create reply
				reply := &db.ActivityPubObject{
					ID:            318625439704694785,
					ActivityPubID: "http://localhost:18080/activitypub/desktop-1/actor/objects/1767752361489365000",
					Type:          "Note",
					Content:       "Reply comment",
					InReplyTo:     parent.ID,
					AttributedTo:  "http://localhost:18080/activitypub/desktop-1/actor",
				}
				rds.Create(reply)
			},
		},
		{
			name:         "Object ID with special characters",
			objectID:     "http://localhost:18080/activitypub/test-user/objects/123?param=value",
			expectStatus: http.StatusOK,
			expectError:  false,
		},
		{
			name:         "Missing object ID",
			objectID:     "",
			expectStatus: http.StatusBadRequest,
			expectError:  true,
		},
		{
			name:         "Non-existent object",
			objectID:     "http://localhost:18080/activitypub/fake/objects/999",
			expectStatus: http.StatusInternalServerError,
			expectError:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setupDB != nil {
				tt.setupDB()
			}

			req := httptest.NewRequest(http.MethodGet, "/activitypub/object/replies?objectId="+tt.objectID+"&page=true", nil)
			resp := httptest.NewRecorder()
			
			h.ServeHTTP(resp, req)

			assert.DeepEqual(t, tt.expectStatus, resp.Code)

			if !tt.expectError {
				var result map[string]interface{}
				err := json.Unmarshal(resp.Body.Bytes(), &result)
				assert.Nil(t, err)
				
				// Verify response structure
				if tt.expectStatus == http.StatusOK {
					assert.True(t, result["orderedItems"] != nil || result["first"] != nil)
				}
			}
		})
	}
}

func TestURLEncodingInReplies(t *testing.T) {
	testCases := []struct {
		name        string
		inputURL    string
		expectedURL string
	}{
		{
			name:        "URL with double slashes",
			inputURL:    "http://localhost:18080/activitypub/user/objects/123",
			expectedURL: "http://localhost:18080/activitypub/user/objects/123",
		},
		{
			name:        "URL with query parameters",
			inputURL:    "http://localhost:18080/activitypub/user/objects/123?foo=bar",
			expectedURL: "http://localhost:18080/activitypub/user/objects/123?foo=bar",
		},
		{
			name:        "URL with hash",
			inputURL:    "http://localhost:18080/activitypub/user/objects/123#section",
			expectedURL: "http://localhost:18080/activitypub/user/objects/123#section",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			h := server.Default()
			
			var receivedObjectID string
			h.GET("/activitypub/object/replies", func(c context.Context, ctx *app.RequestContext) {
				receivedObjectID = string(ctx.Query("objectId"))
				ctx.JSON(http.StatusOK, map[string]string{"received": receivedObjectID})
			})

			req := httptest.NewRequest(http.MethodGet, "/activitypub/object/replies?objectId="+tc.inputURL+"&page=true", nil)
			resp := httptest.NewRecorder()
			
			h.ServeHTTP(resp, req)

			assert.DeepEqual(t, tc.expectedURL, receivedObjectID, "URL should be preserved correctly")
		})
	}
}
