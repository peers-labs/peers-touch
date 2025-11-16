# 多语言（i18n）使用规范

本文档旨在提供一个清晰、统一的指南，用于在 Peers Touch 桌面应用中添加、管理和使用多语言字符串。所有开发者都应严格遵守此规范。

## 核心原则

- **禁止硬编码**：应用中所有面向用户的UI文本都**必须**使用此i18n机制，严禁在代码中硬编码任何字符串（如 `Text('你好')`）。
- **Key命名规范**：`key` 采用小驼峰命名法（camelCase），应清晰、简洁地描述其用途。例如：`welcomeMessage`、`cancelButton`。
- **模板文件优先**：所有新的字符串键（key）**必须**首先添加到模板文件 `app_en.arb` 中。

## 文件结构

- `l10n.yaml`: Flutter国际化工具的配置文件。
- `lib/app/i18n/`: 存放所有`.arb`文件的目录。
- `lib/app/i18n/app_en.arb`: **英文模板文件**。所有新字符串的源头。
- `lib/app/i18n/app_zh.arb`: 中文翻译文件。
- `lib/app/i18n/generated/`: 由工具自动生成的Dart代码，**请勿手动修改**。

## 如何添加一个新的多语言字符串

**第1步：在模板文件中添加Key**

打开 `lib/app/i18n/app_en.arb` 文件，添加一个新的键值对。`key`是代码中使用的标识符，`value`是其对应的英文字符串。

```json
{
  "@@locale": "en",
  "appName": "Peers Touch Desktop",
  "selectFunction": "Please select a feature"
}
```

**第2步：在其他语言文件中添加翻译**

打开 `lib/app/i1un/app_zh.arb`（或其他语言文件），添加相同的 `key` 和对应的翻译。

```json
{
  "@@locale": "zh",
  "appName": "Peers Touch 桌面版",
  "selectFunction": "请选择功能"
}
```

**第3步：生成Dart代码**

在项目根目录下运行以下命令，Flutter工具会自动更新 `lib/app/i18n/generated/` 目录下的Dart代码。

```bash
flutter gen-l10n
```

**第4步：在UI代码中使用**

在你的Widget中，通过 `context` 来访问 `AppLocalizations`，然后调用你新添加的 `key`。

```dart
import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    // 正确的使用方式
    return Text(AppLocalizations.of(context)!.selectFunction);
  }
}
```

## 如何处理带参数的字符串

如果你的字符串需要包含动态参数，可以在 `.arb` 文件中使用占位符。

**`.arb` 文件示例 (`app_en.arb`)**：

```json
{
  "welcomeUser": "Welcome, {userName}!",
  "@welcomeUser": {
    "description": "A welcome message with a user's name",
    "placeholders": {
      "userName": {
        "type": "String",
        "example": "Alice"
      }
    }
  }
}
```

**Dart代码使用示例**：

```dart
// 带参数的调用
Text(AppLocalizations.of(context)!.welcomeUser('Bob'));
```