import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// @人候选项
class MentionCandidate {
  const MentionCandidate({
    required this.id,
    required this.displayName,
    this.avatarUrl,
    this.username,
  });

  final String id;
  final String displayName;
  final String? avatarUrl;
  final String? username;
}

/// @人输入组件
///
/// 支持在输入框中通过 @ 触发成员选择。
class MentionInput extends StatefulWidget {
  const MentionInput({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.onMentionQuery,
    required this.onMentionSelected,
    this.candidates = const [],
    this.decoration,
    this.maxLines = 5,
    this.minLines = 1,
    this.onSubmitted,
    this.enabled = true,
  });

  /// 文本控制器
  final TextEditingController controller;

  /// 焦点节点
  final FocusNode focusNode;

  /// @触发时的查询回调（返回空字符串表示清除候选列表）
  final void Function(String query) onMentionQuery;

  /// 选中某人的回调
  final void Function(MentionCandidate candidate) onMentionSelected;

  /// 候选人列表
  final List<MentionCandidate> candidates;

  /// 输入框装饰
  final InputDecoration? decoration;

  /// 最大行数
  final int maxLines;

  /// 最小行数
  final int minLines;

  /// 提交回调
  final void Function(String text)? onSubmitted;

  /// 是否启用
  final bool enabled;

  @override
  State<MentionInput> createState() => _MentionInputState();
}

class _MentionInputState extends State<MentionInput> {
  final LayerLink _layerLink = LayerLink();
  OverlayEntry? _overlayEntry;
  String _currentMentionQuery = '';
  int _mentionStartIndex = -1;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onTextChanged);
    widget.focusNode.addListener(_onFocusChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    widget.focusNode.removeListener(_onFocusChanged);
    _removeOverlay();
    super.dispose();
  }

  @override
  void didUpdateWidget(MentionInput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.candidates != oldWidget.candidates) {
      if (widget.candidates.isNotEmpty && _mentionStartIndex >= 0) {
        _showOverlay();
      } else {
        _removeOverlay();
      }
    }
  }

  void _onTextChanged() {
    final text = widget.controller.text;
    final selection = widget.controller.selection;

    if (!selection.isValid || !selection.isCollapsed) {
      _cancelMention();
      return;
    }

    final cursorPos = selection.baseOffset;
    if (cursorPos <= 0) {
      _cancelMention();
      return;
    }

    // 检查是否在 @ 之后输入
    final beforeCursor = text.substring(0, cursorPos);
    final atIndex = beforeCursor.lastIndexOf('@');

    if (atIndex >= 0) {
      // 确保 @ 前面是空格或行首
      if (atIndex == 0 || beforeCursor[atIndex - 1] == ' ' || beforeCursor[atIndex - 1] == '\n') {
        final query = beforeCursor.substring(atIndex + 1);
        // 确保查询中没有空格（空格表示 @ 已结束）
        if (!query.contains(' ') && !query.contains('\n')) {
          _mentionStartIndex = atIndex;
          _currentMentionQuery = query;
          widget.onMentionQuery(query);
          return;
        }
      }
    }

    _cancelMention();
  }

  void _onFocusChanged() {
    if (!widget.focusNode.hasFocus) {
      _removeOverlay();
    }
  }

  void _cancelMention() {
    if (_mentionStartIndex >= 0) {
      _mentionStartIndex = -1;
      _currentMentionQuery = '';
      widget.onMentionQuery('');
      _removeOverlay();
    }
  }

  void _selectCandidate(MentionCandidate candidate) {
    if (_mentionStartIndex < 0) return;

    final text = widget.controller.text;
    final cursorPos = widget.controller.selection.baseOffset;

    // 替换 @query 为 @displayName
    final beforeMention = text.substring(0, _mentionStartIndex);
    final afterMention = text.substring(cursorPos);
    final mentionText = '@${candidate.displayName} ';

    final newText = beforeMention + mentionText + afterMention;
    final newCursorPos = _mentionStartIndex + mentionText.length;

    widget.controller.text = newText;
    widget.controller.selection = TextSelection.collapsed(offset: newCursorPos);

    widget.onMentionSelected(candidate);
    _cancelMention();
  }

  void _showOverlay() {
    _removeOverlay();

    _overlayEntry = OverlayEntry(
      builder: (context) {
        return Positioned(
          width: 300,
          child: CompositedTransformFollower(
            link: _layerLink,
            showWhenUnlinked: false,
            offset: const Offset(0, -8),
            followerAnchor: Alignment.bottomLeft,
            targetAnchor: Alignment.topLeft,
            child: _buildCandidatesList(),
          ),
        );
      },
    );

    Overlay.of(context).insert(_overlayEntry!);
  }

  void _removeOverlay() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  Widget _buildCandidatesList() {
    final theme = Theme.of(context);

    return Material(
      elevation: 8,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        constraints: const BoxConstraints(maxHeight: 200),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.dividerColor),
        ),
        child: ListView.builder(
          shrinkWrap: true,
          padding: const EdgeInsets.symmetric(vertical: 4),
          itemCount: widget.candidates.length,
          itemBuilder: (context, index) {
            final candidate = widget.candidates[index];
            return InkWell(
              onTap: () => _selectCandidate(candidate),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundImage: candidate.avatarUrl != null
                          ? NetworkImage(candidate.avatarUrl!)
                          : null,
                      child: candidate.avatarUrl == null
                          ? Text(
                              candidate.displayName.isNotEmpty
                                  ? candidate.displayName[0].toUpperCase()
                                  : '?',
                              style: const TextStyle(fontSize: 14),
                            )
                          : null,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            candidate.displayName,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          if (candidate.username != null)
                            Text(
                              '@${candidate.username}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return CompositedTransformTarget(
      link: _layerLink,
      child: TextField(
        controller: widget.controller,
        focusNode: widget.focusNode,
        decoration: widget.decoration ?? const InputDecoration(
          hintText: 'Type a message...',
          border: InputBorder.none,
        ),
        maxLines: widget.maxLines,
        minLines: widget.minLines,
        enabled: widget.enabled,
        textInputAction: TextInputAction.newline,
        onSubmitted: widget.onSubmitted,
      ),
    );
  }
}
