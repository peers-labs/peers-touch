package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"
)

func TestRelayCancellationFramesRoundTrip(t *testing.T) {
	tests := []struct {
		name  string
		write func(*bytes.Buffer) error
		check func(interface{}) bool
	}{
		{
			name:  "cancel",
			write: func(buf *bytes.Buffer) error { return WriteCancel(buf, 17) },
			check: func(frame interface{}) bool {
				got, ok := frame.(*CancelFrame)
				return ok && got.RequestID == 17
			},
		},
		{
			name:  "cancelled",
			write: func(buf *bytes.Buffer) error { return WriteCancelled(buf, 17) },
			check: func(frame interface{}) bool {
				got, ok := frame.(*CancelledFrame)
				return ok && got.RequestID == 17
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var buf bytes.Buffer
			if err := test.write(&buf); err != nil {
				t.Fatal(err)
			}
			frame, err := ReadFrame(&buf)
			if err != nil {
				t.Fatal(err)
			}
			if !test.check(frame) {
				t.Fatalf("unexpected frame: %#v", frame)
			}
		})
	}
}

func TestFederatedPrivateObjectRelayRejectsOversizedFrameBeforeAllocation(t *testing.T) {
	var wire bytes.Buffer
	header := make([]byte, HeaderLen)
	header[0] = FrameVersion
	header[1] = TypeResponse
	binary.BigEndian.PutUint32(header[2:6], 1)
	binary.BigEndian.PutUint32(
		header[6:10],
		MaxPrivateObjectResponsePayloadLen+1,
	)
	wire.Write(header)

	envelope, err := ReadEnvelope(&wire)
	if err != nil {
		t.Fatal(err)
	}
	before := wire.Len()
	if _, err := ReadFramePayload(
		&wire,
		envelope,
		MaxPrivateObjectResponsePayloadLen,
	); err == nil {
		t.Fatal("expected route payload limit error")
	}
	if wire.Len() != before {
		t.Fatal("oversized payload was read before the route cap was checked")
	}
}

func TestFederatedPrivateObjectRelayDescriptorMetadata(t *testing.T) {
	policy, ok := RoutePolicyForPath(
		"/federation/social/private/objects/object-01/read",
	)
	if !ok {
		t.Fatal("private object route was not classified")
	}
	if policy.MaxResponsePayloadLen != 1_056_780 {
		t.Fatalf(
			"unexpected response payload cap: %d",
			policy.MaxResponsePayloadLen,
		)
	}

	metadata := base64.RawURLEncoding.EncodeToString(make([]byte, 69))
	headers := map[string]string{
		"Content-Type":              "application/octet-stream",
		PrivateObjectMetadataHeader: metadata,
	}
	if err := policy.ValidateResponse(206, headers, make([]byte, 1024*1024)); err != nil {
		t.Fatalf("valid bounded response rejected: %v", err)
	}

	headers[PrivateObjectMetadataHeader] = metadata + "="
	if err := policy.ValidateResponse(206, headers, nil); err == nil {
		t.Fatal("padded base64url metadata was accepted")
	}
	headers[PrivateObjectMetadataHeader] = "AB"
	if err := policy.ValidateResponse(206, headers, nil); err == nil {
		t.Fatal("non-canonical base64url metadata was accepted")
	}
	delete(headers, PrivateObjectMetadataHeader)
	if err := policy.ValidateResponse(404, headers, []byte("not found")); err != nil {
		t.Fatalf("bounded error response should not require metadata: %v", err)
	}
}

func TestRelayRequestIDsMustBeNonzero(t *testing.T) {
	var buf bytes.Buffer
	if err := WriteRequestFrame(&buf, 0, "GET", "/", nil, nil); err == nil {
		t.Fatal("zero request ID was accepted")
	}
	if err := WriteResponseFrame(&buf, 0, 200, nil, nil); err == nil {
		t.Fatal("zero response request ID was accepted")
	}
	if err := WriteCancel(&buf, 0); err == nil {
		t.Fatal("zero cancel request ID was accepted")
	}
	if err := WriteCancelled(&buf, 0); err == nil {
		t.Fatal("zero cancelled request ID was accepted")
	}
}

func TestPrivateObjectRouteClassifierRejectsAliases(t *testing.T) {
	paths := []string{
		"/federation/social/private/objects//read",
		"/federation/social/private/objects/object-01/read/extra",
		"/federation/social/private/objects/a/b/read",
		strings.ToUpper(
			"/federation/social/private/objects/object-01/read",
		),
	}
	for _, path := range paths {
		if _, ok := RoutePolicyForPath(path); ok {
			t.Fatalf("unexpected private object route alias: %q", path)
		}
	}
}
