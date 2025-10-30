# Quick Reference: Targeting Rules to Specific Files or Modules

## Theme Implementation

### Dark Theme Pages

- **Me Profile Page** (`lib/pages/me/me_profile.dart`)
  - Black background (`Colors.black`)
  - White text (`Colors.white`)
  - Semi-transparent white dividers (`Colors.white.withOpacity(0.1)`)
  - Horizontal layout with labels on left, values on right
  - Right-aligned values with chevron icons
  - No container decorations (flat design)

### Implementation Example

```dart
// Scaffold setup
Scaffold(
  backgroundColor: Colors.black,
  appBar: AppBar(
    backgroundColor: Colors.black,
    elevation: 0,
    // ...
  ),
  // ...
)

// Profile field
Row(
  children: [
    Text("Label", style: TextStyle(color: Colors.white)),
    Spacer(),
    Text("Value", style: TextStyle(color: Colors.white)),
    Icon(Icons.chevron_right, color: Colors.white54),
  ],
)

// Divider
Divider(
  height: 1,
  thickness: 0.5,
  color: Colors.white.withOpacity(0.1),
)
```

### File Locations

- Dark theme rules: `.trae/rules/pages/me/me_profile_dark_theme.yml`
- Implementation guide: `.trae/rules/pages/me/me_profile_implementation_guide.md`
- Dark theme colors: `.trae/rules/style/dark_theme_color_rules.yml`
- Theme selection guide: `.trae/rules/style/theme_selection_guide.md`

## File-Specific Rules

```yaml
rules:
  - id: my-file-specific-rule
    target:
      files:
        - "lib/pages/specific_file.dart"
    pattern: "your-pattern"
    message: "Your message"
```

## Module/Directory Rules

```yaml
rules:
  - id: my-module-rule
    target:
      directories:
        - "lib/pages/module_name/**"
    pattern: "your-pattern"
    message: "Your message"
```

## Path Restrictions

```yaml
rules:
  - id: my-path-restricted-rule
    pattern: "your-pattern"
    allowedPaths:
      - "lib/allowed/path/**"
    excludedPaths:
      - "lib/excluded/path/**"
    message: "Your message"
```

## File-Specific Conditions

```yaml
rules:
  - name: my-conditional-rule
    conditions:
      - file: "lib/specific/file.dart"
        patterns:
          - type: "regex"
            value: "your-pattern"
            errorMessage: "Your message"
    actions:
      - type: "warning"
```

## Component-Specific Rules

```yaml
rules:
  - id: my-component-rule
    pattern: "class\s+MyComponent\s+extends"
    message: "Your message"
```

## Adding to project_rules.yml

After creating your targeted rule file, add it to `project_rules.yml`:

```yaml
includes:
  # Your category
  - "./rules/your_category/your_specific_rule.yml"
```