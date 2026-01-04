import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/launch/controller/search_controller.dart';

class SpotlightSearchBar extends StatelessWidget {
  const SpotlightSearchBar({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<LaunchSearchController>();
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(20),
      child: TextField(
        autofocus: true,
        style: theme.textTheme.titleLarge,
        decoration: InputDecoration(
          prefixIcon: const Icon(Icons.search, size: 28),
          hintText: 'Search everywhere...',
          hintStyle: theme.textTheme.titleLarge?.copyWith(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
              color: theme.colorScheme.outline.withValues(alpha: 0.3),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
              color: theme.colorScheme.outline.withValues(alpha: 0.3),
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
              color: theme.colorScheme.primary,
              width: 2,
            ),
          ),
          filled: true,
          fillColor: theme.colorScheme.surface,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 20,
            vertical: 16,
          ),
        ),
        onChanged: (value) => controller.searchQuery.value = value,
      ),
    );
  }
}
