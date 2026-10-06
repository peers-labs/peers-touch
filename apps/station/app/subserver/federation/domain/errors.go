package domain

import "errors"

var ErrInactiveStationPair = errors.New(
	"federation station pair is not active",
)
