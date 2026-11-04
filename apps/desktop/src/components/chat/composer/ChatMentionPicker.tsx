import { theme } from "antd";
import { AtSign, Megaphone, User } from "lucide-react";

import type { MentionPickerRow } from "./useChatMentions";

interface ChatMentionPickerProps {
  rows: MentionPickerRow[];
  highlightedIndex: number;
  onSelect: (row: MentionPickerRow) => void;
  onHover: (index: number) => void;
}

export function ChatMentionPicker({
  rows,
  highlightedIndex,
  onSelect,
  onHover,
}: ChatMentionPickerProps) {
  const { token } = theme.useToken();
  return (
    <div
      data-chat-mention-picker
      role="listbox"
      style={{
        position: "absolute",
        left: 12,
        bottom: "100%",
        marginBottom: 6,
        zIndex: 20,
        width: 280,
        maxHeight: 264,
        overflowY: "auto",
        padding: 4,
        borderRadius: 10,
        background: token.colorBgElevated,
        boxShadow: token.boxShadowSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      {rows.map((row, index) => {
        const highlighted = index === highlightedIndex;
        const Icon = row.kind === "all" ? Megaphone : User;
        return (
          <button
            key={row.key}
            type="button"
            role="option"
            aria-selected={highlighted}
            data-chat-mention-row={row.key}
            data-chat-mention-highlighted={highlighted || undefined}
            onMouseDown={(event) => {
              // mousedown keeps textarea focus/caret for the token replacement.
              event.preventDefault();
              onSelect(row);
            }}
            onMouseEnter={() => onHover(index)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 10px",
              border: 0,
              borderRadius: 8,
              textAlign: "left",
              cursor: "pointer",
              background: highlighted ? token.colorPrimaryBg : "transparent",
              color: highlighted ? token.colorPrimaryText : token.colorText,
              fontSize: 13,
            }}
          >
            {row.kind === "all" ? (
              <AtSign
                size={15}
                style={{ flex: "0 0 auto", color: token.colorPrimary }}
              />
            ) : (
              <Icon
                size={15}
                style={{ flex: "0 0 auto", color: token.colorTextSecondary }}
              />
            )}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.displayName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
