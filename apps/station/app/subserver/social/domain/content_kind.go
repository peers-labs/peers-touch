package domain

import (
	"fmt"

	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// contentColumns are the four flattened JSON-or-string columns a public post
// body is projected into. They are the stable boundary between each
// ContentKindHandler's encode/decode pair and the persistence schema.
type contentColumns struct {
	Text         string
	Attachments  string
	LinkPreview  string
	RepostRef    string
}

// ContentKindHandler owns the proto oneof <-> flattened-column translation for
// exactly one PostType. The kernel (PostConverter) dispatches through the
// registry instead of a closed type switch, so adding or removing a content
// kind no longer edits the conversion kernel.
type ContentKindHandler interface {
	// Type returns the single PostType this handler serves.
	Type() model.PostType
	// Encode flattens a typed create request into the DB columns.
	Encode(req *model.CreatePostRequest) (contentColumns, error)
	// Decode rebuilds the proto oneof variant on out from a persisted Post.
	Decode(out *model.Post, p *Post) error
}

// ContentKindRegistry is an immutable, process-lifetime map of PostType to
// handler. It is constructed once at wiring time; duplicate registration and
// lookups of unknown types fail explicitly so a missing variant can never be
// silently dropped on the write or read path.
type ContentKindRegistry struct {
	handlers map[model.PostType]ContentKindHandler
}

// NewContentKindRegistry builds a registry and rejects empty/duplicate
// registrations, which would otherwise mask a wiring conflict.
func NewContentKindRegistry(handlers ...ContentKindHandler) (*ContentKindRegistry, error) {
	r := &ContentKindRegistry{handlers: make(map[model.PostType]ContentKindHandler, len(handlers))}
	for _, h := range handlers {
		if h == nil {
			return nil, fmt.Errorf("nil content kind handler")
		}
		t := h.Type()
		if _, exists := r.handlers[t]; exists {
			return nil, fmt.Errorf("duplicate content kind handler for %s", t)
		}
		r.handlers[t] = h
	}
	return r, nil
}

// Get returns the handler for t or an error when no handler is registered.
func (r *ContentKindRegistry) Get(t model.PostType) (ContentKindHandler, error) {
	h, ok := r.handlers[t]
	if !ok {
		return nil, fmt.Errorf("unsupported post type: %s", t)
	}
	return h, nil
}

// DefaultContentKindRegistry wires every supported public PostType. Removing a
// content kind means deleting its handler file and its entry here; the
// conversion kernel and all other handlers stay untouched.
func DefaultContentKindRegistry() *ContentKindRegistry {
	registry, err := NewContentKindRegistry(
		textContentHandler{},
		imageContentHandler{},
		videoContentHandler{},
		linkContentHandler{},
		pollContentHandler{},
		repostContentHandler{},
		locationContentHandler{},
	)
	if err != nil {
		// Static handler set; a duplicate is a compile-time wiring mistake.
		panic(err)
	}
	return registry
}
