package touch

import (
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	gatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	"google.golang.org/protobuf/proto"
)

func TestBindProtoOrJSONPreservesJSONOneof(t *testing.T) {
	ctx := &app.RequestContext{}
	ctx.Request.Header.Set("Content-Type", model.ContentTypeJSON)
	ctx.Request.SetBodyString(`{
		"attempt_id": "attempt-1",
		"gate_id": "auth.login",
		"type": "ACCESS_GATE_TYPE_AUTH_LOGIN",
		"login": {
			"email": "alice@example.com",
			"password": "secret",
			"device_type": "desktop-native"
		}
	}`)

	var request gatepb.SubmitAccessGateRequest
	if err := bindProtoOrJSON(ctx, &request); err != nil {
		t.Fatal(err)
	}
	if request.GetLogin() == nil {
		t.Fatal("JSON login oneof was not decoded")
	}
	if request.GetLogin().GetEmail() != "alice@example.com" {
		t.Fatalf("email = %q", request.GetLogin().GetEmail())
	}
}

func TestBindProtoOrJSONAcceptsXProtobuf(t *testing.T) {
	expected := &gatepb.SubmitAccessGateRequest{
		AttemptId: "attempt-1",
		GateId:    "auth.login",
		Type:      gatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		ActionInput: &gatepb.SubmitAccessGateRequest_Login{
			Login: &model.LoginRequest{
				Email:      "alice@example.com",
				Password:   "secret",
				DeviceType: "mobile",
			},
		},
	}
	body, err := proto.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	ctx := &app.RequestContext{}
	ctx.Request.Header.Set("Content-Type", model.ContentTypeXProtobuf)
	ctx.Request.SetBody(body)

	var request gatepb.SubmitAccessGateRequest
	if err := bindProtoOrJSON(ctx, &request); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(&request, expected) {
		t.Fatalf("decoded request = %v, want %v", &request, expected)
	}
	if !shouldUseProto(ctx) {
		t.Fatal("application/x-protobuf must select a protobuf response")
	}
}
