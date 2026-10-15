package publishing

import "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"

type Outcome uint8

const (
	OutcomeAccepted Outcome = iota + 1
	OutcomeReplayed
)

type Attachment struct {
	ObjectID  string
	Filename  string
	MediaType string
	Size      uint64
}

type MaterializedMessage struct {
	Payload              []byte
	FallbackText         string
	NotificationType     int32
	NotificationCategory int32
	NotificationGroupKey string
}

type Message interface {
	AttachmentObjectIDs() []string
	Materialize(
		sourceNamespace string,
		attachments []Attachment,
	) (MaterializedMessage, error)
}

type Request struct {
	CommandID     string
	Target        valueobject.ConversationID
	IdentityBytes []byte
	Message       Message
}

type Response struct {
	CommandID           string
	MessageID           valueobject.MessageID
	ConversationID      valueobject.ConversationID
	ConversationEventID valueobject.EventID
	EventSequence       valueobject.Sequence
	Outcome             Outcome
}
