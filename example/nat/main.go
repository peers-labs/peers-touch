package main

import (
	"log"
	"net"
)

func main() {
	// Start TCP server on port 3333
	listener, err := net.Listen("tcp", ":33333")
	if err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
	defer listener.Close()
	log.Println("Server listening on :3333")

	for {
		// Accept incoming connections
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Connection error: %v", err)
			continue
		}

		// Add connection logging
		log.Printf("New connection from %s", conn.RemoteAddr().String())

		go handleConnection(conn)
	}
}

func handleConnection(conn net.Conn) {
	// Add disconnection logging

	defer func() {
		log.Printf("Connection closed by %s", conn.RemoteAddr().String())
		conn.Close()
	}()

	buf := make([]byte, 1024)

	for {
		n, err := conn.Read(buf)
		if err != nil {
			log.Printf("Read error: %v", err)
			return
		}

		// Echo back the message
		_, err = conn.Write(buf[:n])
		if err != nil {
			log.Printf("Write error: %v", err)
			return
		}
	}
}
