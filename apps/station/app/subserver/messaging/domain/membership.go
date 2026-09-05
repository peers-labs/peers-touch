package domain

import "errors"

var (
	ErrMembershipNotActive = errors.New(
		"messaging: active conversation membership required",
	)
	ErrMembershipSourceConflict = errors.New(
		"messaging: conversation exists in both authority and follower stores",
	)
)
