// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get language => 'Language';

  @override
  String get general => 'General';

  @override
  String get selectFunction => 'Please select a feature';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get chooseSettingsSection => 'Please choose a settings section';

  @override
  String get generalSettings => 'General Settings';

  @override
  String get globalBusinessSettings => 'Global Business Settings';

  @override
  String get theme => 'Theme';

  @override
  String get colorScheme => 'Color Scheme';

  @override
  String get selectAppLanguage => 'Select app language';

  @override
  String get selectAppTheme => 'Select app theme';

  @override
  String get selectColorScheme => 'Select app color scheme';

  @override
  String get backendUrl => 'Backend URL';

  @override
  String get backendUrlDescription => 'Set backend service address';

  @override
  String get backendUrlPlaceholder => 'Enter backend service address';

  @override
  String get authToken => 'Auth Token';

  @override
  String get authTokenDescription => 'Set API authentication token';

  @override
  String get authTokenPlaceholder => 'Enter authentication token';

  @override
  String get aiProviderHeader => 'AI Provider';

  @override
  String get openaiApiKey => 'OpenAI API Key';

  @override
  String get openaiApiKeyDescription => 'Set OpenAI API access key';

  @override
  String get openaiApiKeyPlaceholder => 'Enter OpenAI API key';

  @override
  String get openaiBaseUrl => 'OpenAI Base URL';

  @override
  String get openaiBaseUrlDescription => 'Set OpenAI API base URL (optional)';

  @override
  String get openaiBaseUrlPlaceholder => 'Enter OpenAI base URL';

  @override
  String get defaultModel => 'Default Model';

  @override
  String get defaultModelDescription => 'Choose the default AI model';

  @override
  String get chatSearchSessionsPlaceholder => 'Search conversations';

  @override
  String get chatNewConversation => 'New Chat';

  @override
  String get chatSessionActions => 'Conversation actions';

  @override
  String get rename => 'Rename';

  @override
  String get delete => 'Delete';

  @override
  String get chatTopicHistory => 'Topic History';

  @override
  String get chatAddTopic => 'Add Topic';

  @override
  String get chatTopicActions => 'Topic actions';

  @override
  String get aiModelLabel => 'Model:';

  @override
  String get toggleTopicPanel => 'Show/Hide topic panel (Ctrl+Shift+T)';

  @override
  String get sharePlaceholder => 'Share (placeholder)';

  @override
  String get layoutTogglePlaceholder => 'Layout toggle (placeholder)';

  @override
  String get moreMenuPlaceholder => 'More menu (placeholder)';

  @override
  String get sendingIndicator => 'Sending...';

  @override
  String get chatDefaultTitle => 'Just Chat';

  @override
  String get renameSessionTitle => 'Rename Conversation';

  @override
  String get renameTopicTitle => 'Rename Topic';

  @override
  String get inputNewNamePlaceholder => 'Enter new name';

  @override
  String get cancel => 'Cancel';

  @override
  String get confirm => 'Confirm';

  @override
  String get deleteSessionTitle => 'Delete Conversation';

  @override
  String deleteSessionConfirm(String sessionTitle) {
    return 'Delete conversation $sessionTitle and all messages?';
  }
}
