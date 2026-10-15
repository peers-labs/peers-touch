package publishing

import (
	"fmt"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
)

func invalid(field, reason string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeInvalidArgument,
		"publishing.validate",
		field,
		fmt.Sprintf("%s", reason),
	)
}

func unauthorized() error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		"publishing.authenticate",
		"credential",
		"publishing credential is invalid",
	)
}

func conflict(field, message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeCommandConflict,
		"publishing.publish",
		field,
		message,
	)
}
