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
	ViewerID       uint64
	PostAuthorID   uint64
	MutualActorIDs map[uint64]struct{}
}

func (v InteractionVisibility) CanSeeActor(actorID uint64) bool {
	if actorID == 0 {
		return false
	}
	if v.ViewerID != 0 && v.ViewerID == v.PostAuthorID {
		return true
	}
	if v.ViewerID != 0 && actorID == v.ViewerID {
		return true
	}
	if actorID == v.PostAuthorID {
		return true
	}
	if _, ok := v.MutualActorIDs[actorID]; ok {
		return true
	}
	return false
}
