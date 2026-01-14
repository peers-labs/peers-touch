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
  String get chatSearchSessionsPlaceholder => 'Search assistants';

  @override
  String get chatNewConversation => 'New Chat';

  @override
  String get chatSessionActions => 'Assistant actions';

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
  String get renameSessionTitle => 'Rename Assistant';

  @override
  String get renameTopicTitle => 'Rename Topic';

  @override
  String get inputNewNamePlaceholder => 'Enter new name';

  @override
  String get cancel => 'Cancel';

  @override
  String get confirm => 'Confirm';

  @override
  String get deleteSessionTitle => 'Delete Assistant';

  @override
  String deleteSessionConfirm(String sessionTitle) {
    return 'Delete assistant $sessionTitle and all messages?';
  }

  @override
  String get saveAsTopic => 'Save as topic';

  @override
  String get topicSaved => 'Saved as a topic';

  @override
  String get topicAlreadySaved => 'Already saved for this conversation';

  @override
  String get signupValidationErrorMessage =>
      'Please fill in all information, and passwords must match and be at least 8 characters.';

  @override
  String get error => 'Error';

  @override
  String get yourPrivacy => 'Your Privacy';

  @override
  String get next => 'Next';

  @override
  String get createAccount => 'Create Account';

  @override
  String get serverUrl => 'Server URL';

  @override
  String get displayName => 'Display Name';

  @override
  String get username => 'Username';

  @override
  String get email => 'Email';

  @override
  String get password => 'Password';

  @override
  String get confirmPassword => 'Confirm Password';

  @override
  String get passwordMinLengthHint =>
      'Your password needs at least eight characters';

  @override
  String get success => 'Success';

  @override
  String providerLoadError(Object error) {
    return 'Failed to load providers: $error';
  }

  @override
  String get providerUpdateSuccess => 'Provider updated successfully';

  @override
  String providerUpdateError(Object error) {
    return 'Failed to update provider: $error';
  }

  @override
  String get providerDeleteSuccess => 'Provider deleted successfully';

  @override
  String providerDeleteError(Object error) {
    return 'Failed to delete provider: $error';
  }

  @override
  String get nameUpdated => 'Name updated';

  @override
  String nameUpdateError(Object error) {
    return 'Failed to update name: $error';
  }

  @override
  String get providerSwitched => 'Current provider switched';

  @override
  String providerSwitchError(Object error) {
    return 'Failed to switch provider: $error';
  }

  @override
  String get languageDescription => 'Select application language';

  @override
  String get themeDescription => 'Select application theme';

  @override
  String get colorSchemeDescription => 'Select application color scheme';

  @override
  String get backendNodeAddress => 'Backend Node Address';

  @override
  String get backendNodeAddressDescription => 'Set backend service address';

  @override
  String get enterBackendAddress => 'Enter backend service address';

  @override
  String get securityAuth => 'Security Auth';

  @override
  String get securityAuthDescription => 'Set API authentication token';

  @override
  String get enterAuthToken => 'Enter authentication token';

  @override
  String get advancedSettings => 'Advanced Settings';

  @override
  String get storageDirectory => 'Storage Directory';

  @override
  String get storageDirectoryDescription => 'Application data storage location';

  @override
  String get openDirectory => 'Open Directory';

  @override
  String get clearData => 'Clear Data';

  @override
  String get clearDataDescription => 'Clear all local storage data';

  @override
  String get clearDataConfirmation =>
      'Are you sure you want to clear all local data? This action is irreversible.';

  @override
  String get dataClearedSuccess => 'All local data cleared.';

  @override
  String get searchSettings => 'Search Settings';

  @override
  String get noSettingsFound => 'No relevant settings found';

  @override
  String get test => 'Test';

  @override
  String get addressTest => 'Address Test';

  @override
  String successWithData(Object data) {
    return 'Success: $data';
  }

  @override
  String failedWithData(Object error) {
    return 'Failed: $error';
  }

  @override
  String get loginTab => 'Login';

  @override
  String get registerTab => 'Register';

  @override
  String get yourGroup => 'YOUR GROUP';

  @override
  String get friends => 'FRIENDS';

  @override
  String get noItemsFound => 'No items found';

  @override
  String get signIn => 'Sign in';

  @override
  String get signUp => 'Sign up';

  @override
  String get forgotPassword => 'Forgot your password?';

  @override
  String get required => 'Required';

  @override
  String get requiredMinChars => 'Required (min 6 chars)';

  @override
  String get emailOrUsername => 'Email or username';

  @override
  String get serverUrlExample => 'Example: http://localhost:18080';

  @override
  String get aiChat => 'AI Chat';

  @override
  String get chatRtc => 'RTC Chat';

  @override
  String get discovery => 'Discovery';

  @override
  String get expand => 'Expand';

  @override
  String get collapse => 'Collapse';

  @override
  String get createCustomAIProvider => 'Create Custom AI Provider';

  @override
  String get basicInformation => 'Basic Information';

  @override
  String get providerId => 'Provider ID';

  @override
  String get providerIdPlaceholder =>
      'Suggested all lowercase, e.g., openai, cann...';

  @override
  String get providerName => 'Provider Name';

  @override
  String get providerNamePlaceholder =>
      'Please enter the display name of the provider';

  @override
  String get providerDescription => 'Provider Description';

  @override
  String get providerDescriptionPlaceholder =>
      'Provider description (optional)';

  @override
  String get providerLogo => 'Provider Logo (URL or SVG)';

  @override
  String get providerLogoPlaceholder => 'Enter logo URL or select preset SVG';

  @override
  String get presetSvg => 'Preset SVG';

  @override
  String get configurationInformation => 'Configuration Information';

  @override
  String get requestFormat => 'Request Format';

  @override
  String get requestFormatPlaceholder => 'OpenAI / Ollama';

  @override
  String get proxyUrl => 'Proxy URL';

  @override
  String get proxyUrlPlaceholder => 'https://xxxx-proxy.com/v1';

  @override
  String get apiKey => 'API Key';

  @override
  String get apiKeyPlaceholder => 'Please enter your API Key';

  @override
  String get create => 'Create';

  @override
  String get fieldRequired => 'This field is required';

  @override
  String get addModel => 'Add Model';

  @override
  String get modelId => 'Model ID';

  @override
  String get modelIdPlaceholder => 'e.g. gpt-4o-mini or llama3.1:8b';

  @override
  String get modelNamePlaceholder => 'e.g. GPT-4o Mini';

  @override
  String get description => 'Description';

  @override
  String get descriptionPlaceholder => 'Optional description';

  @override
  String get organization => 'Organization';

  @override
  String get organizationPlaceholder => 'e.g. OpenAI / Ollama';

  @override
  String get contextWindow => 'Context Window';

  @override
  String get contextWindowPlaceholder => 'e.g. 128000';

  @override
  String get maxOutputTokens => 'Max Output Tokens';

  @override
  String get maxOutputTokensPlaceholder => 'e.g. 4096';

  @override
  String get inputPrice => 'Input \$ /1k tokens';

  @override
  String get inputPricePlaceholder => 'e.g. 0.03';

  @override
  String get outputPrice => 'Output \$ /1k tokens';

  @override
  String get outputPricePlaceholder => 'e.g. 0.06';

  @override
  String get aliases => 'Aliases';

  @override
  String get aliasesPlaceholder =>
      'comma separated e.g. gpt-4o-mini-2024-07-18';

  @override
  String get type => 'Type';

  @override
  String get enabled => 'Enabled';

  @override
  String get capabilities => 'Capabilities';

  @override
  String get capText => 'Text';

  @override
  String get capImage => 'Image';

  @override
  String get capAudio => 'Audio';

  @override
  String get capFile => 'File';

  @override
  String get add => 'Add';

  @override
  String get notice => 'Notice';

  @override
  String get modelIdAndNameRequired => 'Model ID and Display Name are required';

  @override
  String get modelIdInvalid =>
      'ID only allows letters, numbers, dots, colons, underscores and dashes';

  @override
  String get modelAdded => 'Model added';

  @override
  String get selectProviderToConfigure => 'Select a provider to configure';

  @override
  String get providerSettings => 'Provider Settings';

  @override
  String get providerSettingsSubtitle =>
      'Configure API Key, Proxy URL and models';

  @override
  String get refresh => 'Refresh';

  @override
  String get searchProviders => 'Search Providers...';

  @override
  String get addProvider => 'Add Provider';

  @override
  String get enabledGroup => 'Enabled';

  @override
  String get disabledGroup => 'Disabled';

  @override
  String get noProvidersConfigured => 'No AI providers configured';

  @override
  String get addFirstProvider =>
      'Add your first AI service provider to get started';

  @override
  String get save => 'Save';

  @override
  String get renameProvider => 'Rename Provider';

  @override
  String get deleteProvider => 'Delete Provider';

  @override
  String enterProviderApiKey(String provider) {
    return 'Please enter your $provider API Key';
  }

  @override
  String get apiProxyUrl => 'API Proxy URL';

  @override
  String get mustIncludeHttp => 'Must include http(s)://';

  @override
  String get connectivityCheck => 'Connectivity Check';

  @override
  String get connectivityCheckSubtitle =>
      'Test if the API Key and proxy URL are correctly filled';

  @override
  String get check => 'Check';

  @override
  String get encryptionNotice =>
      'Your key and proxy URL will be encrypted using AES-GCM encryption algorithm';

  @override
  String get networkTypeTooltip =>
      'This indicates which network the current server belongs to.';

  @override
  String get unknownNetwork => 'Unknown Network';

  @override
  String get networkCheckingLabel => 'Checking';

  @override
  String get networkUnreachableLabel => 'Unreachable';

  @override
  String get networkNotFoundLabel => 'Not Found';

  @override
  String get networkCheckingTooltip => 'Detecting server network type';

  @override
  String get networkUnreachableTooltip =>
      'Network unreachable, please check address or connectivity';

  @override
  String get networkNotFoundTooltip =>
      'Node interface not found (404), please verify server address';

  @override
  String get networkUnknownTooltip => 'Unknown network type';

  @override
  String get clientRequestMode => 'Use Client Request Mode';

  @override
  String get clientRequestModeSubtitle =>
      'Client will initiate session requests directly from the browser, which can improve response speed';

  @override
  String get modelList => 'Model List';

  @override
  String get searchModels => 'Search Models...';

  @override
  String get fetchModels => 'Fetch models';

  @override
  String allModelsCount(int count) {
    return 'All ($count)';
  }

  @override
  String enabledModelsCount(int count) {
    return 'Enabled ($count)';
  }

  @override
  String get moreModelsComing =>
      'More models are planned to be added, stay tuned';

  @override
  String get yesterday => 'Yesterday';

  @override
  String get emptyChatNoModels =>
      'No models available. Please configure an AI provider.';

  @override
  String get goToSettings => 'Go to Settings';

  @override
  String get inputHintEnterToSend =>
      'Press Enter to send, Ctrl+Enter to new line';

  @override
  String get inputHintCtrlEnterToSend =>
      'Press Ctrl+Enter to send, Enter to new line';

  @override
  String get selectModel => 'Select Model';

  @override
  String get addImage => 'Add Image';

  @override
  String get modelDoesNotSupportImage =>
      'Current model does not support image input';

  @override
  String get addFile => 'Add File';

  @override
  String get modelDoesNotSupportFile =>
      'Current model does not support file input';

  @override
  String get addAudio => 'Add Audio';

  @override
  String get modelDoesNotSupportAudio =>
      'Current model does not support audio input';

  @override
  String get clearInput => 'Clear Input';

  @override
  String get sendSettings => 'Send Settings';

  @override
  String get pressEnterToSend => 'Press Enter to send';

  @override
  String get pressCtrlEnterToSend => 'Press Ctrl+Enter to send';
}
