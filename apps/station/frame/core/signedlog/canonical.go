// Package signedlog owns portable protobuf signing primitives. Domain policy,
// sequencing, persistence and authorization belong to its consumers.
package signedlog

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const MaxMessageBytes = 1 << 20

// Canonical rejects unknown fields recursively and maps (which are deliberately
// absent from signed contracts) before deterministic serialization.
func Canonical(message proto.Message) ([]byte, error) {
	if message == nil || !message.ProtoReflect().IsValid() {
		return nil, errors.New("signed_log_invalid_message")
	}
	if err := validate(message.ProtoReflect()); err != nil {
		return nil, err
	}
	if proto.Size(message) > MaxMessageBytes {
		return nil, errors.New("signed_log_message_too_large")
	}
	return proto.MarshalOptions{Deterministic: true}.Marshal(message)
}

func validate(message protoreflect.Message) error {
	if len(message.GetUnknown()) != 0 {
		return errors.New("signed_log_unknown_fields")
	}
	var err error
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.IsMap() {
			err = errors.New("signed_log_map_field")
			return false
		}
		if field.Message() == nil {
			return true
		}
		if field.IsList() {
			list := value.List()
			for i := 0; i < list.Len() && err == nil; i++ {
				err = validate(list.Get(i).Message())
			}
		} else {
			err = validate(value.Message())
		}
		return err == nil
	})
	return err
}

// Decode requires one exact encoding, rejecting unknown fields, duplicate
// singular fields, reordered fields and alternative varints.
func Decode(wire []byte, message proto.Message) error {
	if len(wire) > MaxMessageBytes {
		return errors.New("signed_log_message_too_large")
	}
	if err := proto.Unmarshal(wire, message); err != nil {
		return err
	}
	canonical, err := Canonical(message)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, wire) {
		return errors.New("signed_log_noncanonical")
	}
	return nil
}

func SigningBytes(domain string, statement proto.Message) ([]byte, error) {
	canonical, err := Canonical(statement)
	if err != nil {
		return nil, err
	}
	return append([]byte(domain), canonical...), nil
}

func Hash(domain string, message proto.Message) ([]byte, error) {
	input, err := SigningBytes(domain, message)
	if err != nil {
		return nil, err
	}
	return HashBytes(input), nil
}

// HashBytes preserves existing domain wire contracts when extracting a kernel.
func HashBytes(input []byte) []byte {
	hash := sha256.Sum256(input)
	return append([]byte(nil), hash[:]...)
}

func SignBytes(privateKey ed25519.PrivateKey, input []byte) ([]byte, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("signed_log_invalid_private_key")
	}
	return ed25519.Sign(privateKey, input), nil
}

func VerifyBytes(publicKey, input, signature []byte) bool {
	return len(publicKey) == ed25519.PublicKeySize &&
		len(signature) == ed25519.SignatureSize &&
		ed25519.Verify(ed25519.PublicKey(publicKey), input, signature)
}

func Verify(domain string, statement proto.Message, publicKey, signature []byte) error {
	input, err := SigningBytes(domain, statement)
	if err != nil {
		return err
	}
	if !VerifyBytes(publicKey, input, signature) {
		return errors.New("signed_log_invalid_signature")
	}
	return nil
}
