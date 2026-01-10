package activitypub

import (
	"encoding/json"
	"fmt"

	ap "github.com/peers-labs/peers-touch/station/frame/vendors/activitypub"
)

// ParseObjectID 解析 Object URL 为数据库ID (废弃，仅为兼容旧代码)
// 新代码应该直接使用数据库ID
func ParseObjectID(urlStr string) (uint64, error) {
	return 0, fmt.Errorf("deprecated: use database ID directly")
}

// ParseActivityID 解析 Activity URL 为数据库ID (废弃，仅为兼容旧代码)
// 新代码应该直接使用数据库ID
func ParseActivityID(urlStr string) (uint64, error) {
	return 0, fmt.Errorf("deprecated: use database ID directly")
}

// buildPersonFromActor 从 Actor 构建 ActivityPub Person 对象
func buildPersonFromActor(actor interface{}, urlGen *URLGenerator) *ap.Actor {
	// 支持多种 actor 类型
	var username, name, icon string
	
	// 尝试从不同的结构中提取信息
	switch a := actor.(type) {
	case map[string]interface{}:
		if u, ok := a["preferred_username"].(string); ok {
			username = u
		}
		if n, ok := a["name"].(string); ok {
			name = n
		}
		if i, ok := a["icon"].(string); ok {
			icon = i
		}
	}
	
	if username == "" {
		return nil
	}
	
	actorURL := urlGen.ActorURL(username)
	person := ap.PersonNew(ap.ID(actorURL))
	
	if name != "" {
		person.Name = ap.NaturalLanguageValuesNew()
		person.Name.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(name)})
	}
	
	person.PreferredUsername = ap.NaturalLanguageValuesNew()
	person.PreferredUsername.Add(ap.LangRefValue{Ref: ap.NilLangRef, Value: ap.Content(username)})
	
	if icon != "" {
		ic := ap.ObjectNew(ap.ImageType)
		ic.URL = ap.IRI(icon)
		person.Icon = ic
	}
	
	return person
}

// extractContentText 从 ActivityPub Content 中提取文本
func extractContentText(content ap.NaturalLanguageValues) string {
	if content == nil {
		return ""
	}
	first := content.First()
	if first.Value == nil {
		return ""
	}
	return first.Value.String()
}

// buildNaturalLanguageContent 构建 NaturalLanguageValues
func buildNaturalLanguageContent(text string) ap.NaturalLanguageValues {
	content := ap.NaturalLanguageValuesNew()
	content.Set(ap.NilLangRef, ap.Content(text))
	return content
}

// marshalActivity 序列化 Activity 为 JSON
func marshalActivity(activity interface{}) ([]byte, error) {
	return json.Marshal(activity)
}

// unmarshalActivity 反序列化 JSON 为 Activity
func unmarshalActivity(data []byte) (*ap.Activity, error) {
	var activity ap.Activity
	if err := json.Unmarshal(data, &activity); err != nil {
		return nil, err
	}
	return &activity, nil
}
