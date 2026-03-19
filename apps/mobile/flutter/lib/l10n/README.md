# Internationalization (i18n) Guide

This directory contains the internationalization files for the Peers Touch app.

## Overview

The app uses Flutter's built-in internationalization support with ARB (Application Resource Bundle) files to manage translations.

## Current Supported Languages

- English (en) - `app_en.arb`
- Spanish (es) - `app_es.arb`

## How to Use Localized Strings

### Method 1: Using AppLocalizationsHelper (Recommended)

```dart
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';

// Simple usage with fallback
Text(AppLocalizationsHelper.getLocalizedString(
  (l10n) => l10n.userName, 
  'User Name' // fallback
))

// Using the global getter (when context is available)
Text(l10n.userName)
```

### Method 2: Using Context Extension

```dart
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';

// In a widget with BuildContext
Text(context.l10n.userName)
```

### Method 3: Direct Usage

```dart
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

// In a widget with BuildContext
Text(AppLocalizations.of(context)!.userName)
```

## Adding New Languages

1. Create a new ARB file in this directory following the naming convention `app_[locale].arb`
   - Example: `app_fr.arb` for French

2. Copy the structure from `app_en.arb` and translate all the values

3. Add the new locale to the `supportedLocales` list in `main.dart`:
   ```dart
   supportedLocales: const [
     Locale('en'), // English
     Locale('es'), // Spanish
     Locale('fr'), // French (new)
   ],
   ```

4. Run `flutter packages get` to regenerate the localization files

## Adding New Strings

1. Add the new string to `app_en.arb` (the template file):
   ```json
   "newStringKey": "New String Value",
   "@newStringKey": {
     "description": "Description of what this string is used for"
   }
   ```

2. Add the same key with translated values to all other ARB files

3. Run `flutter packages get` to regenerate the localization files

4. Use the new string in your code:
   ```dart
   Text(AppLocalizationsHelper.getLocalizedString(
     (l10n) => l10n.newStringKey, 
     'Fallback Value'
   ))
   ```

## Strings with Parameters

For strings that need dynamic values, use placeholders:

```json
"welcomeMessage": "Welcome, {userName}!",
"@welcomeMessage": {
  "description": "Welcome message with user name",
  "placeholders": {
    "userName": {
      "type": "String",
      "description": "The user's name"
    }
  }
}
```

Usage:
```dart
Text(l10n.welcomeMessage('John'))
```

## Best Practices

1. **Always provide fallbacks** when using `AppLocalizationsHelper.getLocalizedString()`
2. **Use descriptive keys** that indicate where the string is used
3. **Add descriptions** to help translators understand the context
4. **Keep strings short and simple** when possible
5. **Test with different languages** to ensure UI layouts work properly
6. **Use parameters** for dynamic content instead of string concatenation

## File Structure

```
lib/l10n/
├── app_en.arb          # English (template)
├── app_es.arb          # Spanish
├── README.md           # This file
└── (future language files)
```

## Configuration Files

- `l10n.yaml` - Configuration for the localization generation
- `pubspec.yaml` - Dependencies for internationalization
- `main.dart` - App configuration with supported locales

## Troubleshooting

### Localization files not generating
- Run `flutter clean` then `flutter packages get`
- Check that `l10n.yaml` is in the project root
- Ensure ARB files have valid JSON syntax

### Missing translations
- Check that all ARB files have the same keys
- Verify the locale codes match the file names
- Run `flutter packages get` after adding new strings

### Context not available errors
- Use `AppLocalizationsHelper.getLocalizedString()` with fallbacks
- Ensure the widget tree has access to `MaterialApp` with localization delegates