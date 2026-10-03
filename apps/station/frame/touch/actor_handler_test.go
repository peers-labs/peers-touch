package touch

import (
	"reflect"
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	oauthbridge "github.com/peers-labs/peers-touch/station/frame/touch/model/oauthbridge"
	"google.golang.org/protobuf/proto"
)

func TestGetActorHandlersRegistersOAuthBridge(t *testing.T) {
	var matches []ActorHandlerInfo
	for _, handler := range GetActorHandlers() {
		if handler.RouterURL == RouterURLOAuthLogin {
			matches = append(matches, handler)
		}
	}

	if len(matches) != 1 {
		t.Fatalf("OAuth bridge registrations = %d, want 1", len(matches))
	}

	handler := matches[0]
	if handler.Method != server.POST {
		t.Fatalf("OAuth bridge method = %q, want POST", handler.Method)
	}
	if reflect.ValueOf(handler.Handler).Pointer() != reflect.ValueOf(OAuthLogin).Pointer() {
		t.Fatal("OAuth bridge route does not use OAuthLogin")
	}
	if len(handler.Wrappers) != 1 {
		t.Fatalf("OAuth bridge wrapper count = %d, want public common wrapper only", len(handler.Wrappers))
	}
}

func TestOAuthBridgeRequestAcceptsProtobuf(t *testing.T) {
	expected := &oauthbridge.BrokerOAuthBridgeRequest{
		Provider:       "github",
		ProviderUserId: "oauth-user",
		Email:          "oauth-user@test.invalid",
	}
	body, err := proto.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	ctx := &app.RequestContext{}
	ctx.Request.Header.Set("Content-Type", model.ContentTypeXProtobuf)
	ctx.Request.SetBody(body)

	var request oauthbridge.BrokerOAuthBridgeRequest
	if err := bindProtoOrJSON(ctx, &request); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(&request, expected) {
		t.Fatalf("decoded request = %v, want %v", &request, expected)
	}
}
