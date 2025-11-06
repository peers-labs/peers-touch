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
}
