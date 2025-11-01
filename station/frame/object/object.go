package object

import (
	ap "github.com/peers-touch/peers-touch/station/frame/vendors/activitypub"
)

type (
	// ID provides the globally unique identifier
	ID ap.ID
	// Type provides the type of the ActivityPub object
	Type string

	ActivityVocabularyType ap.ActivityVocabularyType
)

// region LangRef is used for NaturalLanguage
// see https://www.w3.org/TR/activitystreams-core/#naturalLanguageValues
type (
	// LangRef is the type for a language reference code, should be an ISO639-1 language specifier.
	LangRef string
	Content []byte

	// LangRefValue is a type for storing per language values
	LangRefValue struct {
		Ref   LangRef
		Value Content
	}
	// NaturalLanguageValues is a mapping for multiple language values
	NaturalLanguageValues []LangRefValue
)

// endregion

type Object interface {
	ID() ID
	Type() Type
}
