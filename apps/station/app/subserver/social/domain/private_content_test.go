package domain

import (
	"testing"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
)

func TestPrivateContentRequiresCanonicalULID(t *testing.T) {
	request := &privatecontentpb.PreparePrivateMomentRequest{
		ContentId: "123",
		Audience:  &model.Audience{Kind: model.Audience_FRIENDS},
		CommandId: "prepare-command",
		Kind: privatecontentpb.
			PrivateMomentKind_PRIVATE_MOMENT_KIND_TEXT,
	}
	if _, err := CanonicalizePrivateMomentPrepare(request); !IsPrivateContentCode(
		err,
		PrivateContentInvalidArgument,
	) {
		t.Fatalf("numeric private content ID error = %v", err)
	}

	request.ContentId = ulid.Make().String()
	if _, err := CanonicalizePrivateMomentPrepare(request); err != nil {
		t.Fatalf("canonical ULID rejected: %v", err)
	}
}
