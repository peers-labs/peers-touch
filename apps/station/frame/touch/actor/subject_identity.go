package actor

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/frame/touch/activitypub/identity"
)

func ResolveSubjectPTID(ctx context.Context, subjectID string) (string, error) {
	_ = ctx
	subjectID = strings.TrimSpace(subjectID)
	ptid, err := identity.Parse(subjectID)
	if err != nil {
		return "", fmt.Errorf("subject is not a valid PTID: %w", err)
	}
	return ptid.String(), nil
}
