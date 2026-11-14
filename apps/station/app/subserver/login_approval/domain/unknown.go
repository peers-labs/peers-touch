package domain

import "google.golang.org/protobuf/reflect/protoreflect"

func hasUnknown(message protoreflect.Message) bool {
	if len(message.GetUnknown()) != 0 {
		return true
	}
	found := false
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.Message() == nil {
			return true
		}
		if field.IsList() {
			list := value.List()
			for i := 0; i < list.Len(); i++ {
				if hasUnknown(list.Get(i).Message()) {
					found = true
					return false
				}
			}
		} else if !field.IsMap() && hasUnknown(value.Message()) {
			found = true
		}
		return !found
	})
	return found
}
