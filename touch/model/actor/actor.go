package actor

import (
	o "github.com/peers-touch/peers-touch-go/object"
	"github.com/peers-touch/peers-touch-go/vendors/activitypub"
)

// Actor is an actor in the ActivityPub protocol.
// https://www.w3.org/TR/activitypub/#:~:text=of%20the%20implementation.-,4.1,-Actor%20objects
type Actor activitypub.Actor

type (
	// Application describes a software application.
	Application = activitypub.Actor

	// The Group represents a formal or informal collective of Actors.
	Group = activitypub.Actor

	// The Organization represents an organization.
	Organization = activitypub.Actor

	// Person represents an individual person.
	Person = activitypub.Actor

	// Service represents a service of any kind.
	Service = activitypub.Actor
)

// ActivityPubFacade provides the main interface for interacting with the ActivityPub protocol
type ActivityPubFacade interface {
	Facade
	ActivityFacade
	CollectionFacade
	DeliveryFacade
}

// Facade handles actor-related operations
type Facade interface {
	CreateActor(actorType o.ActivityVocabularyType, id o.ID) (*Actor, error)
	GetActor(id o.ID) (*Actor, error)
	UpdateActor(actor *Actor) error
	DeleteActor(id o.ID) error
	Follow(actorId o.ID, targetId o.ID) error
	Unfollow(actorId o.ID, targetId o.ID) error
}

// ActivityFacade handles activity-related operations
type ActivityFacade interface {
	CreateActivity(activityType o.ActivityVocabularyType, actorId o.ID, object o.Item) (*o.Activity, error)
	GetActivity(id o.ID) (*o.Activity, error)
	DeleteActivity(id o.ID) error
	Like(actorId o.ID, objectId o.ID) error
	Unlike(actorId o.ID, objectId o.ID) error
	Announce(actorId o.ID, objectId o.ID) error
}

// CollectionFacade handles collection-related operations
type CollectionFacade interface {
	GetInbox(actorId o.ID) (o.ItemCollection, error)
	GetOutbox(actorId o.ID) (o.ItemCollection, error)
	GetFollowers(actorId o.ID) (o.ItemCollection, error)
	GetFollowing(actorId o.ID) (o.ItemCollection, error)
	GetLiked(actorId o.ID) (o.ItemCollection, error)
}

// DeliveryFacade handles message delivery operations
type DeliveryFacade interface {
	SendActivity(activity *o.Activity, recipients o.ItemCollection) error
	ReceiveActivity(activity *o.Activity) error
	ForwardActivity(activity *o.Activity, targetId o.ID) error
}

// ChatFacade handles chatting message
type ChatFacade interface{}
