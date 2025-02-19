package registry

// Watcher is an interface that returns updates about the registry
type Watcher interface {
	Next() (*Result, error)
	Stop()
}

// Result is what is returned from the watcher
// it contains the service and the action that was performed, either create, update, delete
type Result struct {
	Service *Peer
	Action  string
}

// EventType defines registry event type.
type EventType int

func (t EventType) String() string {
	switch t {
	case Create:
		return "create"
	case Delete:
		return "delete"
	case Update:
		return "update"
	default:
		return "unknown"
	}
}

const (
	// Create is emitted when a new service is registered.
	Create EventType = iota
	// Delete is emitted when an existing service is deregsitered.
	Delete
	// Update is emitted when an existing servicec is updated.
	Update
)
