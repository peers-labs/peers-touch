package client

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

func TestInboundTunnelDrainsBufferedDataBeforeTerminalState(t *testing.T) {
	owner := New(Config{})
	tunnel := newInboundTunnel(
		context.Background(),
		owner,
		&protocol.TunnelOpenFrame{TunnelID: 1},
		16,
	)
	tunnel.accepted.Store(true)
	if err := tunnel.acceptData(&protocol.TunnelDataFrame{
		TunnelID: 1,
		Sequence: 1,
		Data:     []byte("final"),
	}); err != nil {
		t.Fatal(err)
	}
	tunnel.finish()

	buffer := make([]byte, 16)
	count, err := tunnel.Read(buffer)
	if err != nil || string(buffer[:count]) != "final" {
		t.Fatalf("buffered terminal data=%q err=%v", buffer[:count], err)
	}
	if _, err := tunnel.Read(buffer); !errors.Is(err, io.EOF) {
		t.Fatalf("terminal read error = %v", err)
	}
}
