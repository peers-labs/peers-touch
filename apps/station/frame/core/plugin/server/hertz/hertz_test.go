package hertz

import (
	"testing"

	"github.com/cloudwego/hertz/pkg/app"
)

func TestRequestLogPathUsesMatchedRouteTemplate(t *testing.T) {
	ctx := &app.RequestContext{}
	ctx.Request.SetRequestURI(
		"/conversation/attachments/uploads/private-upload/chunks/7",
	)
	ctx.SetFullPath(
		"/conversation/attachments/uploads/:upload_id/chunks/:chunk_index",
	)

	if got := requestLogPath(ctx); got !=
		"/conversation/attachments/uploads/:upload_id/chunks/:chunk_index" {
		t.Fatalf("request log path = %q", got)
	}
}

func TestRequestLogPathFallsBackForUnmatchedRoute(t *testing.T) {
	ctx := &app.RequestContext{}
	ctx.Request.SetRequestURI("/missing")

	if got := requestLogPath(ctx); got != "/missing" {
		t.Fatalf("request log path = %q", got)
	}
}
