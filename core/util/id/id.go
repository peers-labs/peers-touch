package id

import (
	"hash/fnv"
	"os"

	"github.com/sony/sonyflake"
)

var (
	flake *sonyflake.Sonyflake
)

func init() {
	// TODO: support to set the configuration.
	flake = sonyflake.NewSonyflake(sonyflake.Settings{
		// Provide a custom MachineID to avoid network interface issues
		MachineID: func() (uint16, error) {
			// Generate machine ID based on hostname hash
			hostname, err := os.Hostname()
			if err != nil {
				// Fallback to a default value if hostname is unavailable
				return 1, nil
			}
			
			// Hash the hostname to get a consistent machine ID
			h := fnv.New32a()
			h.Write([]byte(hostname))
			// Use lower 16 bits of the hash
			return uint16(h.Sum32() & 0xFFFF), nil
		},
	})
	if flake == nil {
		panic("failed to initialize sonyflake: NewSonyflake returned nil")
	}
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
