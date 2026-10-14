package securehttp

import (
	"net"

	"github.com/libp2p/go-libp2p/core/network"
)

type streamConn struct {
	network.Stream
}

func (c *streamConn) LocalAddr() net.Addr {
	return libp2pAddr{
		value: c.Stream.Conn().LocalMultiaddr().String(),
	}
}

func (c *streamConn) RemoteAddr() net.Addr {
	return libp2pAddr{
		value: c.Stream.Conn().RemoteMultiaddr().String(),
	}
}

type libp2pAddr struct {
	value string
}

func (libp2pAddr) Network() string {
	return "libp2p"
}

func (a libp2pAddr) String() string {
	return a.value
}
