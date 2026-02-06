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

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
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
  /// **'Search assistants'**
  String get chatSearchSessionsPlaceholder;

  /// No description provided for @chatNewConversation.
  ///
  /// In en, this message translates to:
  /// **'New Chat'**
  String get chatNewConversation;

  /// No description provided for @chatSessionActions.
  ///
  /// In en, this message translates to:
  /// **'Assistant actions'**
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
  /// **'Rename Assistant'**
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
  /// **'Delete Assistant'**
  String get deleteSessionTitle;

  /// No description provided for @deleteSessionConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete assistant {sessionTitle} and all messages?'**
  String deleteSessionConfirm(String sessionTitle);

  /// No description provided for @saveAsTopic.
  ///
  /// In en, this message translates to:
  /// **'Save as topic'**
  String get saveAsTopic;

  /// No description provided for @topicSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved as a topic'**
  String get topicSaved;

  /// No description provided for @topicAlreadySaved.
  ///
  /// In en, this message translates to:
  /// **'Already saved for this conversation'**
  String get topicAlreadySaved;

  /// No description provided for @signupValidationErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Please fill in all information, and passwords must match and be at least 8 characters.'**
  String get signupValidationErrorMessage;

  /// No description provided for @error.
  ///
  /// In en, this message translates to:
  /// **'Error'**
  String get error;

  /// No description provided for @yourPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Your Privacy'**
  String get yourPrivacy;

  /// No description provided for @next.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get next;

  /// No description provided for @createAccount.
  ///
  /// In en, this message translates to:
  /// **'Create Account'**
  String get createAccount;

  /// No description provided for @serverUrl.
  ///
  /// In en, this message translates to:
  /// **'Server URL'**
  String get serverUrl;

  /// No description provided for @displayName.
  ///
  /// In en, this message translates to:
  /// **'Display Name'**
  String get displayName;

  /// No description provided for @username.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get username;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @confirmPassword.
  ///
  /// In en, this message translates to:
  /// **'Confirm Password'**
  String get confirmPassword;

  /// No description provided for @passwordMinLengthHint.
  ///
  /// In en, this message translates to:
  /// **'Your password needs at least eight characters'**
  String get passwordMinLengthHint;

  /// No description provided for @success.
  ///
  /// In en, this message translates to:
  /// **'Success'**
  String get success;

  /// No description provided for @providerLoadError.
  ///
  /// In en, this message translates to:
  /// **'Failed to load providers: {error}'**
  String providerLoadError(Object error);

  /// No description provided for @providerUpdateSuccess.
  ///
  /// In en, this message translates to:
  /// **'Provider updated successfully'**
  String get providerUpdateSuccess;

  /// No description provided for @providerUpdateError.
  ///
  /// In en, this message translates to:
  /// **'Failed to update provider: {error}'**
  String providerUpdateError(Object error);

  /// No description provided for @providerDeleteSuccess.
  ///
  /// In en, this message translates to:
  /// **'Provider deleted successfully'**
  String get providerDeleteSuccess;

  /// No description provided for @providerDeleteError.
  ///
  /// In en, this message translates to:
  /// **'Failed to delete provider: {error}'**
  String providerDeleteError(Object error);

  /// No description provided for @nameUpdated.
  ///
  /// In en, this message translates to:
  /// **'Name updated'**
  String get nameUpdated;

  /// No description provided for @nameUpdateError.
  ///
  /// In en, this message translates to:
  /// **'Failed to update name: {error}'**
  String nameUpdateError(Object error);

  /// No description provided for @providerSwitched.
  ///
  /// In en, this message translates to:
  /// **'Current provider switched'**
  String get providerSwitched;

  /// No description provided for @providerSwitchError.
  ///
  /// In en, this message translates to:
  /// **'Failed to switch provider: {error}'**
  String providerSwitchError(Object error);

  /// No description provided for @languageDescription.
  ///
  /// In en, this message translates to:
  /// **'Select application language'**
  String get languageDescription;

  /// No description provided for @themeDescription.
  ///
  /// In en, this message translates to:
  /// **'Select application theme'**
  String get themeDescription;

  /// No description provided for @colorSchemeDescription.
  ///
  /// In en, this message translates to:
  /// **'Select application color scheme'**
  String get colorSchemeDescription;

  /// No description provided for @backendNodeAddress.
  ///
  /// In en, this message translates to:
  /// **'Backend Node Address'**
  String get backendNodeAddress;

  /// No description provided for @backendNodeAddressDescription.
  ///
  /// In en, this message translates to:
  /// **'Set backend service address'**
  String get backendNodeAddressDescription;

  /// No description provided for @enterBackendAddress.
  ///
  /// In en, this message translates to:
  /// **'Enter backend service address'**
  String get enterBackendAddress;

  /// No description provided for @securityAuth.
  ///
  /// In en, this message translates to:
  /// **'Security Auth'**
  String get securityAuth;

  /// No description provided for @securityAuthDescription.
  ///
  /// In en, this message translates to:
  /// **'Set API authentication token'**
  String get securityAuthDescription;

  /// No description provided for @enterAuthToken.
  ///
  /// In en, this message translates to:
  /// **'Enter authentication token'**
  String get enterAuthToken;

  /// No description provided for @advancedSettings.
  ///
  /// In en, this message translates to:
  /// **'Advanced Settings'**
  String get advancedSettings;

  /// No description provided for @storageDirectory.
  ///
  /// In en, this message translates to:
  /// **'Storage Directory'**
  String get storageDirectory;

  /// No description provided for @storageDirectoryDescription.
  ///
  /// In en, this message translates to:
  /// **'Application data storage location'**
  String get storageDirectoryDescription;

  /// No description provided for @openDirectory.
  ///
  /// In en, this message translates to:
  /// **'Open Directory'**
  String get openDirectory;

  /// No description provided for @clearData.
  ///
  /// In en, this message translates to:
  /// **'Clear Data'**
  String get clearData;

  /// No description provided for @clearDataDescription.
  ///
  /// In en, this message translates to:
  /// **'Clear all local storage data'**
  String get clearDataDescription;

  /// No description provided for @clearDataConfirmation.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to clear all local data? This action is irreversible.'**
  String get clearDataConfirmation;

  /// No description provided for @dataClearedSuccess.
  ///
  /// In en, this message translates to:
  /// **'All local data cleared.'**
  String get dataClearedSuccess;

  /// No description provided for @searchSettings.
  ///
  /// In en, this message translates to:
  /// **'Search Settings'**
  String get searchSettings;

  /// No description provided for @noSettingsFound.
  ///
  /// In en, this message translates to:
  /// **'No relevant settings found'**
  String get noSettingsFound;

  /// No description provided for @test.
  ///
  /// In en, this message translates to:
  /// **'Test'**
  String get test;

  /// No description provided for @addressTest.
  ///
  /// In en, this message translates to:
  /// **'Address Test'**
  String get addressTest;

  /// No description provided for @successWithData.
  ///
  /// In en, this message translates to:
  /// **'Success: {data}'**
  String successWithData(Object data);

  /// No description provided for @failedWithData.
  ///
  /// In en, this message translates to:
  /// **'Failed: {error}'**
  String failedWithData(Object error);

  /// No description provided for @loginTab.
  ///
  /// In en, this message translates to:
  /// **'Login'**
  String get loginTab;

  /// No description provided for @registerTab.
  ///
  /// In en, this message translates to:
  /// **'Register'**
  String get registerTab;

  /// No description provided for @yourGroup.
  ///
  /// In en, this message translates to:
  /// **'YOUR GROUP'**
  String get yourGroup;

  /// No description provided for @friends.
  ///
  /// In en, this message translates to:
  /// **'FRIENDS'**
  String get friends;

  /// No description provided for @noItemsFound.
  ///
  /// In en, this message translates to:
  /// **'No items found'**
  String get noItemsFound;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @signUp.
  ///
  /// In en, this message translates to:
  /// **'Sign up'**
  String get signUp;

  /// No description provided for @forgotPassword.
  ///
  /// In en, this message translates to:
  /// **'Forgot your password?'**
  String get forgotPassword;

  /// No description provided for @required.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get required;

  /// No description provided for @requiredMinChars.
  ///
  /// In en, this message translates to:
  /// **'Required (min 6 chars)'**
  String get requiredMinChars;

  /// No description provided for @emailOrUsername.
  ///
  /// In en, this message translates to:
  /// **'Email or username'**
  String get emailOrUsername;

  /// No description provided for @serverUrlExample.
  ///
  /// In en, this message translates to:
  /// **'Example: http://localhost:18080'**
  String get serverUrlExample;

  /// No description provided for @aiChat.
  ///
  /// In en, this message translates to:
  /// **'AI Chat'**
  String get aiChat;

  /// No description provided for @chatRtc.
  ///
  /// In en, this message translates to:
  /// **'RTC Chat'**
  String get chatRtc;

  /// No description provided for @discovery.
  ///
  /// In en, this message translates to:
  /// **'Discovery'**
  String get discovery;

  /// No description provided for @expand.
  ///
  /// In en, this message translates to:
  /// **'Expand'**
  String get expand;

  /// No description provided for @collapse.
  ///
  /// In en, this message translates to:
  /// **'Collapse'**
  String get collapse;

  /// No description provided for @createCustomAIProvider.
  ///
  /// In en, this message translates to:
  /// **'Create Custom AI Provider'**
  String get createCustomAIProvider;

  /// No description provided for @basicInformation.
  ///
  /// In en, this message translates to:
  /// **'Basic Information'**
  String get basicInformation;

  /// No description provided for @providerId.
  ///
  /// In en, this message translates to:
  /// **'Provider ID'**
  String get providerId;

  /// No description provided for @providerIdPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Suggested all lowercase, e.g., openai, cann...'**
  String get providerIdPlaceholder;

  /// No description provided for @providerName.
  ///
  /// In en, this message translates to:
  /// **'Provider Name'**
  String get providerName;

  /// No description provided for @providerNamePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Please enter the display name of the provider'**
  String get providerNamePlaceholder;

  /// No description provided for @providerDescription.
  ///
  /// In en, this message translates to:
  /// **'Provider Description'**
  String get providerDescription;

  /// No description provided for @providerDescriptionPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Provider description (optional)'**
  String get providerDescriptionPlaceholder;

  /// No description provided for @providerLogo.
  ///
  /// In en, this message translates to:
  /// **'Provider Logo (URL or SVG)'**
  String get providerLogo;

  /// No description provided for @providerLogoPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter logo URL or select preset SVG'**
  String get providerLogoPlaceholder;

  /// No description provided for @presetSvg.
  ///
  /// In en, this message translates to:
  /// **'Preset SVG'**
  String get presetSvg;

  /// No description provided for @configurationInformation.
  ///
  /// In en, this message translates to:
  /// **'Configuration Information'**
  String get configurationInformation;

  /// No description provided for @requestFormat.
  ///
  /// In en, this message translates to:
  /// **'Request Format'**
  String get requestFormat;

  /// No description provided for @requestFormatPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'OpenAI / Ollama'**
  String get requestFormatPlaceholder;

  /// No description provided for @proxyUrl.
  ///
  /// In en, this message translates to:
  /// **'Proxy URL'**
  String get proxyUrl;

  /// No description provided for @proxyUrlPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'https://xxxx-proxy.com/v1'**
  String get proxyUrlPlaceholder;

  /// No description provided for @apiKey.
  ///
  /// In en, this message translates to:
  /// **'API Key'**
  String get apiKey;

  /// No description provided for @apiKeyPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Please enter your API Key'**
  String get apiKeyPlaceholder;

  /// No description provided for @create.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get create;

  /// No description provided for @fieldRequired.
  ///
  /// In en, this message translates to:
  /// **'This field is required'**
  String get fieldRequired;

  /// No description provided for @addModel.
  ///
  /// In en, this message translates to:
  /// **'Add Model'**
  String get addModel;

  /// No description provided for @modelId.
  ///
  /// In en, this message translates to:
  /// **'Model ID'**
  String get modelId;

  /// No description provided for @modelIdPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'e.g. gpt-4o-mini or llama3.1:8b'**
  String get modelIdPlaceholder;

  /// No description provided for @modelNamePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'e.g. GPT-4o Mini'**
  String get modelNamePlaceholder;

  /// No description provided for @description.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get description;

  /// No description provided for @descriptionPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Optional description'**
  String get descriptionPlaceholder;

  /// No description provided for @organization.
  ///
  /// In en, this message translates to:
  /// **'Organization'**
  String get organization;

  /// No description provided for @organizationPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'e.g. OpenAI / Ollama'**
  String get organizationPlaceholder;

  /// No description provided for @contextWindow.
  ///
  /// In en, this message translates to:
  /// **'Context Window'**
  String get contextWindow;

  /// No description provided for @contextWindowPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'e.g. 128000'**
  String get contextWindowPlaceholder;

  /// No description provided for @maxOutputTokens.
  ///
  /// In en, this message translates to:
  /// **'Max Output Tokens'**
  String get maxOutputTokens;

  /// No description provided for @maxOutputTokensPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'e.g. 4096'**
  String get maxOutputTokensPlaceholder;

  /// No description provided for @inputPrice.
  ///
  /// In en, this message translates to:
  /// **'Input \$ /1k tokens'**
  String get inputPrice;

  /// No description provided for @inputPricePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'e.g. 0.03'**
  String get inputPricePlaceholder;

  /// No description provided for @outputPrice.
  ///
  /// In en, this message translates to:
  /// **'Output \$ /1k tokens'**
  String get outputPrice;

  /// No description provided for @outputPricePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'e.g. 0.06'**
  String get outputPricePlaceholder;

  /// No description provided for @aliases.
  ///
  /// In en, this message translates to:
  /// **'Aliases'**
  String get aliases;

  /// No description provided for @aliasesPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'comma separated e.g. gpt-4o-mini-2024-07-18'**
  String get aliasesPlaceholder;

  /// No description provided for @type.
  ///
  /// In en, this message translates to:
  /// **'Type'**
  String get type;

  /// No description provided for @enabled.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get enabled;

  /// No description provided for @capabilities.
  ///
  /// In en, this message translates to:
  /// **'Capabilities'**
  String get capabilities;

  /// No description provided for @capText.
  ///
  /// In en, this message translates to:
  /// **'Text'**
  String get capText;

  /// No description provided for @capImage.
  ///
  /// In en, this message translates to:
  /// **'Image'**
  String get capImage;

  /// No description provided for @capAudio.
  ///
  /// In en, this message translates to:
  /// **'Audio'**
  String get capAudio;

  /// No description provided for @capFile.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get capFile;

  /// No description provided for @add.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get add;

  /// No description provided for @notice.
  ///
  /// In en, this message translates to:
  /// **'Notice'**
  String get notice;

  /// No description provided for @modelIdAndNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Model ID and Display Name are required'**
  String get modelIdAndNameRequired;

  /// No description provided for @modelIdInvalid.
  ///
  /// In en, this message translates to:
  /// **'ID only allows letters, numbers, dots, colons, underscores and dashes'**
  String get modelIdInvalid;

  /// No description provided for @modelAdded.
  ///
  /// In en, this message translates to:
  /// **'Model added'**
  String get modelAdded;

  /// No description provided for @selectProviderToConfigure.
  ///
  /// In en, this message translates to:
  /// **'Select a provider to configure'**
  String get selectProviderToConfigure;

  /// No description provided for @providerSettings.
  ///
  /// In en, this message translates to:
  /// **'Provider Settings'**
  String get providerSettings;

  /// No description provided for @providerSettingsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Configure API Key, Proxy URL and models'**
  String get providerSettingsSubtitle;

  /// No description provided for @refresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get refresh;

  /// No description provided for @searchProviders.
  ///
  /// In en, this message translates to:
  /// **'Search Providers...'**
  String get searchProviders;

  /// No description provided for @addProvider.
  ///
  /// In en, this message translates to:
  /// **'Add Provider'**
  String get addProvider;

  /// No description provided for @enabledGroup.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get enabledGroup;

  /// No description provided for @disabledGroup.
  ///
  /// In en, this message translates to:
  /// **'Disabled'**
  String get disabledGroup;

  /// No description provided for @noProvidersConfigured.
  ///
  /// In en, this message translates to:
  /// **'No AI providers configured'**
  String get noProvidersConfigured;

  /// No description provided for @addFirstProvider.
  ///
  /// In en, this message translates to:
  /// **'Add your first AI service provider to get started'**
  String get addFirstProvider;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @renameProvider.
  ///
  /// In en, this message translates to:
  /// **'Rename Provider'**
  String get renameProvider;

  /// No description provided for @deleteProvider.
  ///
  /// In en, this message translates to:
  /// **'Delete Provider'**
  String get deleteProvider;

  /// No description provided for @enterProviderApiKey.
  ///
  /// In en, this message translates to:
  /// **'Please enter your {provider} API Key'**
  String enterProviderApiKey(String provider);

  /// No description provided for @apiProxyUrl.
  ///
  /// In en, this message translates to:
  /// **'API Proxy URL'**
  String get apiProxyUrl;

  /// No description provided for @mustIncludeHttp.
  ///
  /// In en, this message translates to:
  /// **'Must include http(s)://'**
  String get mustIncludeHttp;

  /// No description provided for @connectivityCheck.
  ///
  /// In en, this message translates to:
  /// **'Connectivity Check'**
  String get connectivityCheck;

  /// No description provided for @connectivityCheckSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Test if the API Key and proxy URL are correctly filled'**
  String get connectivityCheckSubtitle;

  /// No description provided for @check.
  ///
  /// In en, this message translates to:
  /// **'Check'**
  String get check;

  /// No description provided for @encryptionNotice.
  ///
  /// In en, this message translates to:
  /// **'Your key and proxy URL will be encrypted using AES-GCM encryption algorithm'**
  String get encryptionNotice;

  /// No description provided for @networkTypeTooltip.
  ///
  /// In en, this message translates to:
  /// **'This indicates which network the current server belongs to.'**
  String get networkTypeTooltip;

  /// No description provided for @unknownNetwork.
  ///
  /// In en, this message translates to:
  /// **'Unknown Network'**
  String get unknownNetwork;

  /// No description provided for @networkCheckingLabel.
  ///
  /// In en, this message translates to:
  /// **'Checking'**
  String get networkCheckingLabel;

  /// No description provided for @networkUnreachableLabel.
  ///
  /// In en, this message translates to:
  /// **'Unreachable'**
  String get networkUnreachableLabel;

  /// No description provided for @networkNotFoundLabel.
  ///
  /// In en, this message translates to:
  /// **'Not Found'**
  String get networkNotFoundLabel;

  /// No description provided for @networkCheckingTooltip.
  ///
  /// In en, this message translates to:
  /// **'Detecting server network type'**
  String get networkCheckingTooltip;

  /// No description provided for @networkUnreachableTooltip.
  ///
  /// In en, this message translates to:
  /// **'Network unreachable, please check address or connectivity'**
  String get networkUnreachableTooltip;

  /// No description provided for @networkNotFoundTooltip.
  ///
  /// In en, this message translates to:
  /// **'Node interface not found (404), please verify server address'**
  String get networkNotFoundTooltip;

  /// No description provided for @networkUnknownTooltip.
  ///
  /// In en, this message translates to:
  /// **'Unknown network type'**
  String get networkUnknownTooltip;

  /// No description provided for @clientRequestMode.
  ///
  /// In en, this message translates to:
  /// **'Use Client Request Mode'**
  String get clientRequestMode;

  /// No description provided for @clientRequestModeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Client will initiate session requests directly from the browser, which can improve response speed'**
  String get clientRequestModeSubtitle;

  /// No description provided for @modelList.
  ///
  /// In en, this message translates to:
  /// **'Model List'**
  String get modelList;

  /// No description provided for @searchModels.
  ///
  /// In en, this message translates to:
  /// **'Search Models...'**
  String get searchModels;

  /// No description provided for @fetchModels.
  ///
  /// In en, this message translates to:
  /// **'Fetch models'**
  String get fetchModels;

  /// No description provided for @allModelsCount.
  ///
  /// In en, this message translates to:
  /// **'All ({count})'**
  String allModelsCount(int count);

  /// No description provided for @enabledModelsCount.
  ///
  /// In en, this message translates to:
  /// **'Enabled ({count})'**
  String enabledModelsCount(int count);

  /// No description provided for @moreModelsComing.
  ///
  /// In en, this message translates to:
  /// **'More models are planned to be added, stay tuned'**
  String get moreModelsComing;

  /// No description provided for @yesterday.
  ///
  /// In en, this message translates to:
  /// **'Yesterday'**
  String get yesterday;

  /// No description provided for @emptyChatNoModels.
  ///
  /// In en, this message translates to:
  /// **'No models available. Please configure an AI provider.'**
  String get emptyChatNoModels;

  /// No description provided for @goToSettings.
  ///
  /// In en, this message translates to:
  /// **'Go to Settings'**
  String get goToSettings;

  /// No description provided for @inputHintEnterToSend.
  ///
  /// In en, this message translates to:
  /// **'Press Enter to send, Ctrl+Enter to new line'**
  String get inputHintEnterToSend;

  /// No description provided for @inputHintCtrlEnterToSend.
  ///
  /// In en, this message translates to:
  /// **'Press Ctrl+Enter to send, Enter to new line'**
  String get inputHintCtrlEnterToSend;

  /// No description provided for @selectModel.
  ///
  /// In en, this message translates to:
  /// **'Select Model'**
  String get selectModel;

  /// No description provided for @addImage.
  ///
  /// In en, this message translates to:
  /// **'Add Image'**
  String get addImage;

  /// No description provided for @modelDoesNotSupportImage.
  ///
  /// In en, this message translates to:
  /// **'Current model does not support image input'**
  String get modelDoesNotSupportImage;

  /// No description provided for @addFile.
  ///
  /// In en, this message translates to:
  /// **'Add File'**
  String get addFile;

  /// No description provided for @modelDoesNotSupportFile.
  ///
  /// In en, this message translates to:
  /// **'Current model does not support file input'**
  String get modelDoesNotSupportFile;

  /// No description provided for @addAudio.
  ///
  /// In en, this message translates to:
  /// **'Add Audio'**
  String get addAudio;

  /// No description provided for @modelDoesNotSupportAudio.
  ///
  /// In en, this message translates to:
  /// **'Current model does not support audio input'**
  String get modelDoesNotSupportAudio;

  /// No description provided for @clearInput.
  ///
  /// In en, this message translates to:
  /// **'Clear Input'**
  String get clearInput;

  /// No description provided for @sendSettings.
  ///
  /// In en, this message translates to:
  /// **'Send Settings'**
  String get sendSettings;

  /// No description provided for @pressEnterToSend.
  ///
  /// In en, this message translates to:
  /// **'Press Enter to send'**
  String get pressEnterToSend;

  /// No description provided for @pressCtrlEnterToSend.
  ///
  /// In en, this message translates to:
  /// **'Press Ctrl+Enter to send'**
  String get pressCtrlEnterToSend;

  /// No description provided for @connectionStatusOnlineP2P.
  ///
  /// In en, this message translates to:
  /// **'Online (P2P)'**
  String get connectionStatusOnlineP2P;

  /// No description provided for @connectionStatusOnlineRelay.
  ///
  /// In en, this message translates to:
  /// **'Online (Relay)'**
  String get connectionStatusOnlineRelay;

  /// No description provided for @connectionStatusOffline.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get connectionStatusOffline;

  /// No description provided for @connectionStatusConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting...'**
  String get connectionStatusConnecting;

  /// No description provided for @scrollToLatest.
  ///
  /// In en, this message translates to:
  /// **'Back to latest'**
  String get scrollToLatest;
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
