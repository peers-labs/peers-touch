import 'package:flutter/material.dart';
import 'package:peers_touch_base/widgets/avatar.dart';

/// A mosaic avatar composed of multiple member avatars (like WeChat group avatars)
class GroupAvatarMosaic extends StatelessWidget {
  final List<String> memberIds;
  final List<String?> memberAvatarUrls;
  final List<String>? memberNames;
  final double size;
  final Color? backgroundColor;

  const GroupAvatarMosaic({
    super.key,
    required this.memberIds,
    required this.memberAvatarUrls,
    this.memberNames,
    this.size = 40,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bgColor = backgroundColor ?? theme.colorScheme.surfaceContainerHighest;
    final count = memberIds.length.clamp(1, 9);

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(size * 0.2),
      ),
      clipBehavior: Clip.antiAlias,
      child: _buildMosaic(count),
    );
  }

  Widget _buildMosaic(int count) {
    if (count == 1) {
      return _buildSingleAvatar(0, size);
    }

    if (count == 2) {
      return Row(
        children: [
          Expanded(child: _buildSingleAvatar(0, size / 2)),
          Expanded(child: _buildSingleAvatar(1, size / 2)),
        ],
      );
    }

    if (count == 3) {
      return Column(
        children: [
          Expanded(
            child: Center(child: _buildSingleAvatar(0, size / 2)),
          ),
          Expanded(
            child: Row(
              children: [
                Expanded(child: _buildSingleAvatar(1, size / 2)),
                Expanded(child: _buildSingleAvatar(2, size / 2)),
              ],
            ),
          ),
        ],
      );
    }

    if (count == 4) {
      return Column(
        children: [
          Expanded(
            child: Row(
              children: [
                Expanded(child: _buildSingleAvatar(0, size / 2)),
                Expanded(child: _buildSingleAvatar(1, size / 2)),
              ],
            ),
          ),
          Expanded(
            child: Row(
              children: [
                Expanded(child: _buildSingleAvatar(2, size / 2)),
                Expanded(child: _buildSingleAvatar(3, size / 2)),
              ],
            ),
          ),
        ],
      );
    }

    // 5-9 members: 3x3 grid layout
    return _buildGridLayout(count);
  }

  Widget _buildGridLayout(int count) {
    final rows = (count / 3).ceil();
    final itemSize = size / rows;

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(rows, (row) {
        final startIdx = row * 3;
        final endIdx = (startIdx + 3).clamp(0, count);
        final itemsInRow = endIdx - startIdx;

        return Expanded(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(itemsInRow, (col) {
              final idx = startIdx + col;
              return Expanded(child: _buildSingleAvatar(idx, itemSize));
            }),
          ),
        );
      }),
    );
  }

  Widget _buildSingleAvatar(int index, double avatarSize) {
    if (index >= memberIds.length) {
      return const SizedBox.shrink();
    }

    final id = memberIds[index];
    final url = index < memberAvatarUrls.length ? memberAvatarUrls[index] : null;
    final name = memberNames != null && index < memberNames!.length
        ? memberNames![index]
        : null;

    return Padding(
      padding: const EdgeInsets.all(0.5),
      child: Avatar(
        actorId: id,
        avatarUrl: url,
        fallbackName: name ?? id.substring(0, 2),
        size: avatarSize - 1,
      ),
    );
  }
}
