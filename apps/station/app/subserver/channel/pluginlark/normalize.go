package pluginlark

import (
	"encoding/json"
	"fmt"
	"strings"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

// normalizeMessage converts a P2 im.message.receive_v1 event into the typed
// channel-neutral contract. Provider resource keys stay opaque until the host
// explicitly requests their bytes through resourceFetch.
func normalizeMessage(bindingID, providerKind string, event *larkim.P2MessageReceiveV1) *model.NormalizedInboundEvent {
	if event == nil || event.Event == nil || event.Event.Message == nil {
		return nil
	}
	msg := event.Event.Message
	out := &model.NormalizedInboundEvent{
		BindingId:    bindingID,
		ProviderKind: providerKind,
		EventId:      strings.TrimSpace(event.EventV2Base.Header.EventID),
		MessageId:    valueOf(msg.MessageId),
		ChatId:       valueOf(msg.ChatId),
		ChatType:     normalizeChatType(valueOf(msg.ChatType)),
		MessageType:  valueOf(msg.MessageType),
		ContentJson:  valueOf(msg.Content),
		Metadata:     map[string]string{},
	}
	if event.Event.Sender != nil && event.Event.Sender.SenderId != nil {
		out.SenderId = valueOf(event.Event.Sender.SenderId.OpenId)
		out.SenderUserId = valueOf(event.Event.Sender.SenderId.UserId)
		out.SenderUnionId = valueOf(event.Event.Sender.SenderId.UnionId)
		out.SenderIsBot = valueOf(event.Event.Sender.SenderType) == "bot"
		out.SenderTenantKey = valueOf(event.Event.Sender.TenantKey)
	}
	out.ParentId = valueOf(msg.ParentId)
	out.RootId = valueOf(msg.RootId)
	out.ThreadId = valueOf(msg.ThreadId)
	if out.ParentId != "" {
		out.Metadata["parent_id"] = out.ParentId
	}
	if out.RootId != "" {
		out.Metadata["root_id"] = out.RootId
	}
	if out.ThreadId != "" {
		out.Metadata["thread_id"] = out.ThreadId
	}
	for _, mention := range msg.Mentions {
		if mention == nil {
			continue
		}
		item := &model.ChannelMention{
			Key: valueOf(mention.Key), Name: valueOf(mention.Name),
			TenantKey: valueOf(mention.TenantKey),
			IsBot:     valueOf(mention.MentionedType) == "bot",
		}
		if mention.Id != nil {
			item.OpenId = valueOf(mention.Id.OpenId)
			item.UserId = valueOf(mention.Id.UserId)
			item.UnionId = valueOf(mention.Id.UnionId)
		}
		out.Mentions = append(out.Mentions, item)
	}
	out.Text, out.Resources = extractContent(out.MessageType, out.ContentJson)
	out.Text = replaceMentionKeys(out.Text, out.Mentions)
	return out
}

func normalizeChatType(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "p2p":
		return "private"
	case "group":
		return "group"
	default:
		return strings.ToLower(strings.TrimSpace(raw))
	}
}

func extractText(messageType, content string) string {
	text, _ := extractContent(messageType, content)
	return text
}

func extractContent(messageType, content string) (string, []*model.ChannelResourceRef) {
	messageType = strings.ToLower(strings.TrimSpace(messageType))
	var payload any
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return "", nil
	}
	var text []string
	var resources []*model.ChannelResourceRef
	switch messageType {
	case "text":
		if body, ok := payload.(map[string]any); ok {
			appendText(&text, body["text"])
		}
	case "image":
		if body, ok := payload.(map[string]any); ok {
			appendResource(&resources, "image", stringField(body, "image_key"), "", "image/png")
		}
	case "file":
		if body, ok := payload.(map[string]any); ok {
			appendResource(&resources, "file", stringField(body, "file_key"), stringField(body, "file_name"), mimeFromName(stringField(body, "file_name")))
		}
	case "audio", "media", "video", "sticker":
		text = append(text, fmt.Sprintf(
			"[Unsupported Lark message type: %s]", messageType,
		))
	case "post":
		walkPost(payload, &text, &resources)
	case "merge_forward":
		text = append(text, "[Forwarded messages could not be loaded]")
	default:
		text = append(text, fmt.Sprintf("[Unsupported Lark message type: %s]", messageType))
	}
	return strings.TrimSpace(strings.Join(compactStrings(text), "\n")), resources
}

func walkPost(value any, text *[]string, resources *[]*model.ChannelResourceRef) {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			walkPost(item, text, resources)
		}
	case map[string]any:
		tag := strings.ToLower(stringField(typed, "tag"))
		switch tag {
		case "text", "a", "at":
			appendText(text, typed["text"])
			appendText(text, typed["name"])
			appendText(text, typed["href"])
		case "img":
			appendResource(resources, "image", stringField(typed, "image_key"), "", "image/png")
		case "media":
			appendResource(resources, "file", stringField(typed, "file_key"), stringField(typed, "file_name"), mimeFromName(stringField(typed, "file_name")))
		}
		if title := stringField(typed, "title"); title != "" {
			*text = append(*text, title)
		}
		for key, item := range typed {
			if key == "tag" || key == "text" || key == "name" || key == "href" ||
				key == "title" || key == "image_key" || key == "file_key" ||
				key == "file_name" {
				continue
			}
			walkPost(item, text, resources)
		}
	}
}

func replaceMentionKeys(text string, mentions []*model.ChannelMention) string {
	for _, mention := range mentions {
		if mention == nil || mention.GetKey() == "" {
			continue
		}
		name := strings.TrimSpace(mention.GetName())
		if name == "" {
			name = "member"
		}
		text = strings.ReplaceAll(text, mention.GetKey(), "@"+name)
	}
	return strings.TrimSpace(text)
}

func appendText(target *[]string, value any) {
	text, _ := value.(string)
	if text = strings.TrimSpace(text); text != "" {
		*target = append(*target, text)
	}
}

func appendResource(
	target *[]*model.ChannelResourceRef,
	kind, key, name, mime string,
) {
	if key = strings.TrimSpace(key); key == "" {
		return
	}
	*target = append(*target, &model.ChannelResourceRef{
		ProviderKey: key, Kind: kind, FileName: strings.TrimSpace(name),
		MimeType: strings.TrimSpace(mime),
	})
}

func compactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func stringField(value map[string]any, key string) string {
	text, _ := value[key].(string)
	return strings.TrimSpace(text)
}

func mimeFromName(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	switch {
	case strings.HasSuffix(lower, ".pdf"):
		return "application/pdf"
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".txt"), strings.HasSuffix(lower, ".md"):
		return "text/plain"
	default:
		return "application/octet-stream"
	}
}

func valueOf(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}
