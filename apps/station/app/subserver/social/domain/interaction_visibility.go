package domain

// InteractionVisibility decides whether a viewer may see an interaction
// (comment / reaction) actor on a readable Moment.
//
// WeChat-style privacy differs from post visibility: being able to read
// the parent Moment does not imply seeing every third-party interaction
// under it. The post author sees all interactions; each actor sees their
// own interaction; ordinary viewers only see interactions from actors
// they are mutually connected with. The post author's own replies /
// reactions stay visible to every readable viewer because they are part
// of the publisher-authored conversation.
type InteractionVisibility struct {
	ViewerPTID       string
	PostAuthorPTID   string
	MutualActorPTIDs map[string]struct{}
}

func (v InteractionVisibility) CanSeeActor(actorPTID string) bool {
	if actorPTID == "" {
		return false
	}
	if v.ViewerPTID != "" && v.ViewerPTID == v.PostAuthorPTID {
		return true
	}
	if v.ViewerPTID != "" && actorPTID == v.ViewerPTID {
		return true
	}
	if actorPTID == v.PostAuthorPTID {
		return true
	}
	if _, ok := v.MutualActorPTIDs[actorPTID]; ok {
		return true
	}
	return false
}
