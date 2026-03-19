package util

import (
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

var protoJSONUnmarshal = &protojson.UnmarshalOptions{DiscardUnknown: true}
var protoJSONMarshal = &protojson.MarshalOptions{EmitUnpopulated: true, UseProtoNames: true}

func ProtoUnmarshal(b []byte, m proto.Message) error { return protoJSONUnmarshal.Unmarshal(b, m) }
func ProtoMarshal(m proto.Message) ([]byte, error)   { return protoJSONMarshal.Marshal(m) }
