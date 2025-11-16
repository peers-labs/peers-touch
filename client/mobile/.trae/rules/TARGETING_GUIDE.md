# Guide to Creating Target-Specific Rules

This guide explains how to create rules that target specific modules, files, or components in your project using the new directory structure.

## Directory Structure for Targeted Rules

The rules directory is organized into two main categories:

### Global Rules

- **architecture/** - Rules that apply to the entire codebase's architecture
- **code_quality/** - Rules that enforce code quality standards across the codebase
- **components/** - Rules for all components in the application
- **style/** - Rules for styling, colors, typography, and layout that apply globally

### Customized Rules

- **pages/** - Rules that target specific pages
- **modules/** - Rules that target specific modules or directories
- **special_components/** - Rules for specific components that require special handling

When creating a new rule, place it in the appropriate directory based on its scope and target.

## Rule Targeting Methods

### 1. File-Specific Rules

To target specific files, use the `target.files` property in your rule definition:

```yaml
rules:
  - id: specific-file-rule
    name: "Specific File Rule"
    description: "Rule that applies only to a specific file"
    target:
      files:
        - "lib/pages/me/profile_page.dart"
    pattern: "your-pattern-here"
    message: "Your message here"
```

### 2. Directory/Module-Specific Rules

To target an entire module or directory, use the `target.directories` property with glob patterns:

```yaml
rules:
  - id: module-specific-rule
    name: "Module Specific Rule"
    description: "Rule that applies to an entire module"
    target:
      directories:
        - "lib/pages/home/**"
        - "lib/controller/home/**"
    pattern: "your-pattern-here"
    message: "Your message here"
```

### 3. Path Restrictions with allowedPaths/excludedPaths

Another approach is to use `allowedPaths` and `excludedPaths` properties:

```yaml
rules:
  - id: controller-placement-rule
    description: "Controllers should be in the controller directory"
    pattern: "class.*Controller extends GetxController"
    allowedPaths:
      - "lib/controller/**/*.dart"
    message: "Controllers must be placed in the 'lib/controller' directory"
```

Or exclude specific paths:

```yaml
rules:
  - id: no-print-statements
    description: "No print statements in production code"
    pattern: "print\("
    excludedPaths:
      - "lib/utils/logger.dart"
      - "test/**/*.dart"
    message: "Don't use print statements in production code"
```

## Best Practices for Using the Directory Structure

1. **Choose the Right Directory**:
   - Place global rules in the appropriate global directory (architecture, code_quality, components, style)
   - Place page-specific rules in the `pages/` directory
   - Place module-specific rules in the `modules/` directory
   - Place special component rules in the `special_components/` directory

2. **Naming Conventions**:
   - Name global rule files according to their purpose (e.g., `color_rules.yml`)
   - Name customized rule files according to their target (e.g., `home_page_rules.yml`)
   - Use descriptive names that clearly indicate the purpose or target of the rules

3. **Documentation**:
   - Include comments in rule files explaining their purpose and target
   - Update the README.md in each directory when adding new rules

4. **Configuration**:
   - Always add references to new rule files in the main `project_rules.yml` configuration
   - Group related rules together in the same file when they target the same component or page

## Examples

See the following examples for reference:

- `pages/me_profile_specific_rules.yml` - Rules specific to the me_profile.dart file
- `pages/avatar_page_specific_rule.yml` - Rules specific to the avatar_change_page.dart file
- `modules/module_specific_rule_example.yml` - Example of rules targeting specific modules

### 4. File-Specific Conditions

For more complex file-specific rules, use the `conditions` property:

```yaml
rules:
  - name: SpecificFileRule
    description: "Rule for a specific file with conditions"
    conditions:
      - file: "lib/controller/photo_controller.dart"
        patterns:
          - type: "regex"
            value: "your-regex-pattern"
            errorMessage: "Your error message"
    actions:
      - type: "warning"
```

### 5. Component-Specific Rules

To target specific components or classes, use patterns that match those components:

```yaml
rules:
  - id: button-component-rule
    name: "Button Component Rule"
    description: "Rules for custom button components"
    pattern: "class\s+.*Button\s+extends\s+StatelessWidget"
    message: "Custom buttons should follow the design system"
```

## Advanced Targeting

### Combining Multiple Targeting Methods

You can combine multiple targeting methods for more precise control:

```yaml
rules:
  - id: advanced-targeting-rule
    name: "Advanced Targeting Rule"
    description: "Complex targeting example"
    target:
      files:
        - "lib/pages/profile/**/*.dart"
      excludedFiles:
        - "lib/pages/profile/widgets/**/*.dart"
    pattern: "your-pattern-here"
    message: "Your message here"
```

### Context-Aware Rules

Some rules can be context-aware, applying differently based on the file content:

```yaml
rules:
  - id: context-aware-rule
    name: "Context Aware Rule"
    description: "Rule that changes behavior based on context"
    pattern: "setState\(\)"
    contextPatterns:
      - pattern: "extends StatefulWidget"
        required: true
    message: "Consider using a controller instead of setState"
```

## Best Practices

1. **Be Specific**: Target rules as specifically as possible to avoid false positives
2. **Document Purpose**: Always include clear descriptions of what the rule is enforcing
3. **Use Meaningful IDs**: Create rule IDs that clearly indicate their purpose and target
4. **Test Rules**: Test your rules on sample code to ensure they catch what you intend
5. **Group Related Rules**: Keep related rules in the same file for better organization

## Examples

See the `module_specific_rule_example.yml` file for complete examples of target-specific rules.