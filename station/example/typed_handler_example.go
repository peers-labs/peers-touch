package example

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
)

// Example 1: Simple struct-based handler (JSON only)
type GreetingRequest struct {
	Name string `json:"name"`
}

type GreetingResponse struct {
	Message string `json:"message"`
}

func HandleGreeting(ctx context.Context, req *GreetingRequest) (*GreetingResponse, error) {
	if req.Name == "" {
		return nil, server.BadRequest("name is required")
	}

	return &GreetingResponse{
		Message: fmt.Sprintf("Hello, %s!", req.Name),
	}, nil
}

// Example 2: Proto-based handler (supports both JSON and Proto)
func HandleSendMessage(ctx context.Context, req *chat.SendMessageRequest) (*chat.SendMessageResponse, error) {
	// Get authenticated user from context
	subject := auth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	// Validate request
	if req.ReceiverDid == "" {
		return nil, server.BadRequest("receiver_did is required")
	}
	if req.Content == "" {
		return nil, server.BadRequest("content is required")
	}

	// Business logic here...
	// For demonstration, just return a mock response

	return &chat.SendMessageResponse{
		Message: &chat.FriendChatMessage{
			Ulid:        "01EXAMPLE000000000000",
			SessionUlid: req.SessionUlid,
			SenderDid:   subject.ID,
			ReceiverDid: req.ReceiverDid,
			Content:     req.Content,
			Type:        req.Type,
			Status:      chat.FriendMessageStatus_FRIEND_MESSAGE_STATUS_DELIVERED,
		},
		RelayStatus: "delivered",
	}, nil
}

// Example 3: Handler with error cases
type CalculateRequest struct {
	A int `json:"a"`
	B int `json:"b"`
}

type CalculateResponse struct {
	Result int `json:"result"`
}

func HandleDivide(ctx context.Context, req *CalculateRequest) (*CalculateResponse, error) {
	if req.B == 0 {
		return nil, server.BadRequest("division by zero")
	}

	return &CalculateResponse{
		Result: req.A / req.B,
	}, nil
}

// Example 4: Registering handlers
func RegisterExampleHandlers() []server.Handler {
	return []server.Handler{
		// Example 1: Simple JSON handler
		server.NewTypedHandler(
			"example-greeting",
			"/example/greeting",
			server.POST,
			HandleGreeting,
		),

		// Example 2: Proto handler with authentication
		server.NewTypedHandler(
			"example-send-message",
			"/example/message/send",
			server.POST,
			HandleSendMessage,
			// You would add auth wrapper here in real code:
			// serverwrapper.RequireAuth(),
		),

		// Example 3: Handler with error cases
		server.NewTypedHandler(
			"example-divide",
			"/example/divide",
			server.POST,
			HandleDivide,
		),
	}
}

/* Usage examples:

1. JSON Request to HandleGreeting:
   curl -X POST http://localhost:8080/example/greeting \
     -H "Content-Type: application/json" \
     -d '{"name": "Alice"}'
   
   Response (JSON):
   {"message": "Hello, Alice!"}

2. Proto Request to HandleSendMessage:
   (Client sends Proto binary)
   Content-Type: application/protobuf
   
   Response (Proto binary)

3. JSON Request to HandleSendMessage (also works!):
   curl -X POST http://localhost:8080/example/message/send \
     -H "Content-Type: application/json" \
     -d '{"session_ulid":"01ABC","receiver_did":"did:user:123","content":"Hi","type":1}'
   
   Response (JSON):
   {"message": {...}, "relay_status": "delivered"}

4. Error handling:
   curl -X POST http://localhost:8080/example/divide \
     -H "Content-Type: application/json" \
     -d '{"a": 10, "b": 0}'
   
   Response (JSON, 400 Bad Request):
   {"error": "division by zero", "code": 400}

Benefits:
- No manual serialization/deserialization code
- Automatic Content-Type negotiation
- Clean business logic without boilerplate
- Type-safe request/response handling
- Unified error handling
*/
