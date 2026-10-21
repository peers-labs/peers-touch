package pluginlark

import (
	"encoding/json"
	"strings"

	larkevent "github.com/larksuite/oapi-sdk-go/v3/event"
	larkdrive "github.com/larksuite/oapi-sdk-go/v3/service/drive/v1"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/model"
)

func normalizeDocumentEvent(
	bindingID string,
	base *larkevent.EventV2Base,
	eventName, fileToken, fileType, operatorOpenID string,
	payload any,
) *model.NormalizedInboundEvent {
	fileToken = strings.TrimSpace(fileToken)
	if base == nil || base.Header == nil || fileToken == "" {
		return nil
	}
	content, _ := json.Marshal(payload)
	eventID := strings.TrimSpace(base.Header.EventID)
	return &model.NormalizedInboundEvent{
		BindingId: bindingID, ProviderKind: "lark",
		EventId: eventID, MessageId: "document-event:" + eventID,
		ChatId: "document:" + fileToken, ChatType: "private",
		SenderId: operatorOpenID, MessageType: "document_event",
		Text:        "Lark document event: " + eventName,
		ContentJson: string(content), TenantKey: base.Header.TenantKey,
		SenderTenantKey: base.Header.TenantKey,
		Metadata: map[string]string{
			"document_event": eventName,
			"file_token":     fileToken,
			"file_type":      strings.TrimSpace(fileType),
		},
	}
}

func firstDriveUserID(users ...*larkdrive.UserId) string {
	for _, user := range users {
		if user == nil {
			continue
		}
		if value := valueOf(user.OpenId); value != "" {
			return value
		}
		if value := valueOf(user.UserId); value != "" {
			return value
		}
		if value := valueOf(user.UnionId); value != "" {
			return value
		}
	}
	return ""
}
