# Targeting Rules to Specific Files - Examples

## 1. Direct File Targeting

This is the simplest way to specify that a rule applies to a specific file:

```yaml
# Target a specific file
target:
  files:
    - "lib/pages/me/me_profile.dart"

# Rule content follows
rule_content:
  # ...
```

## 2. Multiple Files Targeting

You can target multiple specific files:

```yaml
target:
  files:
    - "lib/pages/me/me_profile.dart"
    - "lib/pages/me/me_settings.dart"
    - "lib/pages/me/me_avatar.dart"

rule_content:
  # ...
```

## 3. Directory/Module Targeting

Target all files in a specific directory or module:

```yaml
target:
  directories:
    - "lib/pages/me/**"

rule_content:
  # ...
```

## 4. Path Restrictions

Specify allowed paths where the rule should apply:

```yaml
rules:
  - id: my-rule
    pattern: "pattern-to-match"
    allowedPaths:
      - "lib/pages/me/**/*.dart"
    message: "Rule message"
```

Or exclude specific paths:

```yaml
rules:
  - id: my-rule
    pattern: "pattern-to-match"
    excludedPaths:
      - "lib/pages/home/**"
      - "test/**"
    message: "Rule message"
```

## 5. File-Specific Conditions

For more complex targeting with conditions:

```yaml
rules:
  - name: SpecificFileRule
    conditions:
      - file: "lib/pages/me/me_profile.dart"
        patterns:
          - type: "regex"
            value: "class MeProfilePage"
            errorMessage: "Error in MeProfilePage"
    actions:
      - type: "warning"
```

## 6. Combined Targeting

Combine multiple targeting methods:

```yaml
target:
  files:
    - "lib/pages/me/me_profile.dart"
  directories:
    - "lib/controller/me/**"
  excludedFiles:
    - "lib/controller/me/deprecated/**"

rule_content:
  # ...
```

## 7. Real-World Example

Here's a complete example for a rule targeting the me_profile.dart file:

```yaml
# Profile Page Layout Rules
target:
  files:
    - "lib/pages/me/me_profile.dart"

rules:
  - id: profile-page-container
    pattern: "Container\(\s*width:\s*MediaQuery"
    message: "Use responsive sizing for profile page containers"
    severity: "warning"
  
  - id: profile-page-avatar
    pattern: "Image\.asset\(\s*['\"]assets/avatars/"
    message: "Use NetworkImage with caching for avatars"
    severity: "info"
```

## 8. Targeting with File Content Context

Target based on file content patterns:

```yaml
rules:
  - id: getx-controller-rule
    contextPatterns:
      - pattern: "extends GetxController"
        required: true
    pattern: "final\s+\w+\s+=\s+\w+\.obs"
    message: "Use RxType for observable variables in GetX controllers"
```