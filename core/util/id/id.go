package id

import (
	"github.com/sony/sonyflake"
)

var (
	flake *sonyflake.Sonyflake
)

func init() {
	// TODO: support to set the configuration.
	flake = sonyflake.NewSonyflake(sonyflake.Settings{})
}

func NextID() uint64 {
	id, err := flake.NextID()
	if err != nil {
		// TODO: handle the error.
		// But it should not happen.
		panic(err)
	}
	return id
}
