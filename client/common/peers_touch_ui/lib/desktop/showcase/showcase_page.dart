import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

import 'sections/tokens_section.dart';
import 'sections/foundation_section.dart';
import 'sections/layout_section.dart';
import 'sections/chat_section.dart';
import 'sections/settings_section.dart';
import 'sections/playground_section.dart';

class DesktopShowcasePage extends StatefulWidget {
  const DesktopShowcasePage({super.key});

  @override
  State<DesktopShowcasePage> createState() => _DesktopShowcasePageState();
}

class _DesktopShowcasePageState extends State<DesktopShowcasePage> {
  bool _isDarkMode = false;

  void _toggleTheme() {
    setState(() {
      _isDarkMode = !_isDarkMode;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        scaffoldBackgroundColor: AppColors.background,
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: AppDarkColors.background,
      ),
      themeMode: _isDarkMode ? ThemeMode.dark : ThemeMode.light,
      home: Builder(
        builder: (context) {
          return Scaffold(
            appBar: AppBar(
              title: Text(
                'Peers-Touch UI Showcase (Desktop)',
                style: TextStyle(
                  fontFamily: AppTypography.fontFamily,
                  fontSize: AppTypography.fontSizeLg,
                  fontWeight: AppTypography.fontWeightSemibold,
                  color: _isDarkMode ? AppDarkColors.textPrimary : AppColors.textPrimary,
                ),
              ),
              backgroundColor: _isDarkMode ? AppDarkColors.background : AppColors.background,
              elevation: 0,
              actions: [
                IconButton(
                  icon: Icon(
                    _isDarkMode ? Icons.light_mode : Icons.dark_mode,
                    color: _isDarkMode ? AppDarkColors.textPrimary : AppColors.textPrimary,
                  ),
                  onPressed: _toggleTheme,
                ),
              ],
            ),
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TokensSection(),
                  const SizedBox(height: AppSpacing.lg),
                  FoundationSection(),
                  const SizedBox(height: AppSpacing.lg),
                  LayoutSection(),
                  const SizedBox(height: AppSpacing.lg),
                  ChatSection(),
                  const SizedBox(height: AppSpacing.lg),
                  SettingsSection(),
                  const SizedBox(height: AppSpacing.lg),
                  PlaygroundSection(),
                  const SizedBox(height: AppSpacing.xxl),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
