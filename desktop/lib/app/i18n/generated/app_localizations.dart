import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('zh'),
  ];

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @general.
  ///
  /// In en, this message translates to:
  /// **'General'**
  String get general;

  /// No description provided for @selectFunction.
  ///
  /// In en, this message translates to:
  /// **'Please select a feature'**
  String get selectFunction;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @chooseSettingsSection.
  ///
  /// In en, this message translates to:
  /// **'Please choose a settings section'**
  String get chooseSettingsSection;

  /// No description provided for @generalSettings.
  ///
  /// In en, this message translates to:
  /// **'General Settings'**
  String get generalSettings;

  /// No description provided for @globalBusinessSettings.
  ///
  /// In en, this message translates to:
  /// **'Global Business Settings'**
  String get globalBusinessSettings;

  /// No description provided for @theme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get theme;

  /// No description provided for @colorScheme.
  ///
  /// In en, this message translates to:
  /// **'Color Scheme'**
  String get colorScheme;

  /// No description provided for @selectAppLanguage.
  ///
  /// In en, this message translates to:
  /// **'Select app language'**
  String get selectAppLanguage;

  /// No description provided for @selectAppTheme.
  ///
  /// In en, this message translates to:
  /// **'Select app theme'**
  String get selectAppTheme;

  /// No description provided for @selectColorScheme.
  ///
  /// In en, this message translates to:
  /// **'Select app color scheme'**
  String get selectColorScheme;

  /// No description provided for @backendUrl.
  ///
  /// In en, this message translates to:
  /// **'Backend URL'**
  String get backendUrl;

  /// No description provided for @backendUrlDescription.
  ///
  /// In en, this message translates to:
  /// **'Set backend service address'**
  String get backendUrlDescription;

  /// No description provided for @backendUrlPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter backend service address'**
  String get backendUrlPlaceholder;

  /// No description provided for @authToken.
  ///
  /// In en, this message translates to:
  /// **'Auth Token'**
  String get authToken;

  /// No description provided for @authTokenDescription.
  ///
  /// In en, this message translates to:
  /// **'Set API authentication token'**
  String get authTokenDescription;

  /// No description provided for @authTokenPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter authentication token'**
  String get authTokenPlaceholder;

  /// No description provided for @aiProviderHeader.
  ///
  /// In en, this message translates to:
  /// **'AI Provider'**
  String get aiProviderHeader;

  /// No description provided for @openaiApiKey.
  ///
  /// In en, this message translates to:
  /// **'OpenAI API Key'**
  String get openaiApiKey;

  /// No description provided for @openaiApiKeyDescription.
  ///
  /// In en, this message translates to:
  /// **'Set OpenAI API access key'**
  String get openaiApiKeyDescription;

  /// No description provided for @openaiApiKeyPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter OpenAI API key'**
  String get openaiApiKeyPlaceholder;

  /// No description provided for @openaiBaseUrl.
  ///
  /// In en, this message translates to:
  /// **'OpenAI Base URL'**
  String get openaiBaseUrl;

  /// No description provided for @openaiBaseUrlDescription.
  ///
  /// In en, this message translates to:
  /// **'Set OpenAI API base URL (optional)'**
  String get openaiBaseUrlDescription;

  /// No description provided for @openaiBaseUrlPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter OpenAI base URL'**
  String get openaiBaseUrlPlaceholder;

  /// No description provided for @defaultModel.
  ///
  /// In en, this message translates to:
  /// **'Default Model'**
  String get defaultModel;

  /// No description provided for @defaultModelDescription.
  ///
  /// In en, this message translates to:
  /// **'Choose the default AI model'**
  String get defaultModelDescription;

  /// No description provided for @chatSearchSessionsPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Search conversations'**
  String get chatSearchSessionsPlaceholder;

  /// No description provided for @chatNewConversation.
  ///
  /// In en, this message translates to:
  /// **'New Chat'**
  String get chatNewConversation;

  /// No description provided for @chatSessionActions.
  ///
  /// In en, this message translates to:
  /// **'Conversation actions'**
  String get chatSessionActions;

  /// No description provided for @rename.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get rename;

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @chatTopicHistory.
  ///
  /// In en, this message translates to:
  /// **'Topic History'**
  String get chatTopicHistory;

  /// No description provided for @chatAddTopic.
  ///
  /// In en, this message translates to:
  /// **'Add Topic'**
  String get chatAddTopic;

  /// No description provided for @chatTopicActions.
  ///
  /// In en, this message translates to:
  /// **'Topic actions'**
  String get chatTopicActions;

  /// No description provided for @aiModelLabel.
  ///
  /// In en, this message translates to:
  /// **'Model:'**
  String get aiModelLabel;

  /// No description provided for @toggleTopicPanel.
  ///
  /// In en, this message translates to:
  /// **'Show/Hide topic panel (Ctrl+Shift+T)'**
  String get toggleTopicPanel;

  /// No description provided for @sharePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Share (placeholder)'**
  String get sharePlaceholder;

  /// No description provided for @layoutTogglePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Layout toggle (placeholder)'**
  String get layoutTogglePlaceholder;

  /// No description provided for @moreMenuPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'More menu (placeholder)'**
  String get moreMenuPlaceholder;

  /// No description provided for @sendingIndicator.
  ///
  /// In en, this message translates to:
  /// **'Sending...'**
  String get sendingIndicator;

  /// No description provided for @chatDefaultTitle.
  ///
  /// In en, this message translates to:
  /// **'Just Chat'**
  String get chatDefaultTitle;

  /// No description provided for @renameSessionTitle.
  ///
  /// In en, this message translates to:
  /// **'Rename Conversation'**
  String get renameSessionTitle;

  /// No description provided for @renameTopicTitle.
  ///
  /// In en, this message translates to:
  /// **'Rename Topic'**
  String get renameTopicTitle;

  /// No description provided for @inputNewNamePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter new name'**
  String get inputNewNamePlaceholder;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get confirm;

  /// No description provided for @deleteSessionTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete Conversation'**
  String get deleteSessionTitle;

  /// No description provided for @deleteSessionConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete conversation {sessionTitle} and all messages?'**
  String deleteSessionConfirm(String sessionTitle);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'zh'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
