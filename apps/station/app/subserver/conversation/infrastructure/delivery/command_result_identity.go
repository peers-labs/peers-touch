package delivery

import (
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

// CommandResultItemID identifies the one canonical result item addressed to an endpoint.
func CommandResultItemID(
	recipient valueobject.Endpoint,
	conversationID valueobject.ConversationID,
	commandID valueobject.CommandID,
) (string, error) {
	if recipient.Validate() != nil || conversationID == "" || commandID == "" {
		return "", fmt.Errorf(
			"derive command-result item identity: endpoint, conversation, and command are required",
		)
	}
	return valueobject.HashBytes(valueobject.CanonicalTuple(
		[]byte("peers-touch/conversation-command-result"),
		[]byte{1},
		[]byte(recipient.Actor),
		[]byte(recipient.Device),
		[]byte(conversationID),
		[]byte(commandID),
	)).String(), nil
}
