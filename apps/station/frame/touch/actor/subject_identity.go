package actor

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

func ResolveSubjectPTID(ctx context.Context, subjectID string) (string, error) {
	subjectID = strings.TrimSpace(subjectID)
	if strings.HasPrefix(subjectID, "ptid:") {
		return subjectID, nil
	}
	actorID, err := strconv.ParseUint(subjectID, 10, 64)
	if err != nil {
		return "", fmt.Errorf("subject %q is neither a PTID nor a numeric actor id", subjectID)
	}
	record, err := GetActorByID(ctx, actorID)
	if err != nil {
		return "", err
	}
	ptid := strings.TrimSpace(record.PTID)
	if ptid == "" {
		return "", fmt.Errorf("actor %d has no canonical PTID", actorID)
	}
	return ptid, nil
}
