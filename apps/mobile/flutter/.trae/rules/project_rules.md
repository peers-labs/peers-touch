# 项目主规则入口

## Rule Priority

- `component_rules > layout_rules > base_style_rules`
- `undefined_elements_inherit_from: closest_defined_type`

## Global Rules

### Style Rules (Global)

- [Page Global CSS](./style/page_global_css.yml)
- [Color Rules Standard](./style/color_rules_standard.yml)
- [Dark Theme Color Rules](./style/dark_theme_color_rules.yml)
- [Typography Rules Standard](./style/typography_rules_standard.yml)
- [Layout Spacing Rules Standard](./style/layout_spacing_rules_standard.yml)
- [Theme Selection Guide Standard](./style/theme_selection_guide_standard.yml)

### Component Rules (Global)

- [Button Style Rules](./components/button_style_rules.yml)

### Architecture Rules (Global)

- [Page Structure Rules Standard](./architecture/page_structure_rules_standard.yml)

### Code Quality Rules (Global)

- [Interaction Rules Standard](./code_quality/interaction_rules_standard.yml)
- [Validation Rules Standard](./code_quality/validation_rules_standard.yml)
- [No Deprecated APIs Standard](./code_quality/no_deprecated_apis_standard.yml)
- [No Stateful Widget Standard](./code_quality/no_stateful_widget_standard.yml)

## Lib-Based Rules (Following project structure)

### Controller Rules

- [Controller Location Rule](./lib/controller/controller_location_rule.yml)
- [Controller Management Rule](./lib/controller/controller_management_rule.yml)
- [Photo Controller Management Rule](./lib/controller/photo_controller_management_rule.yml)
- [Controller In Controller Dir](./lib/controller/controller_in_controller_dir.yml)
- [Controller Management In Controller](./lib/controller/controller_management_in_controller.yml)

### Component Rules

- [Button Style Rules](./lib/components/button_style_rules.yml)
- [Component Rules Standard](./lib/components/component_rules_standard.yml)

### Page Rules - Me Section

- [Me Profile Layout Rules](./lib/pages/me/me_profile_layout_rules.yml) - Layout rules for me_profile.dart
- [Me Profile Controller Rules](./lib/pages/me/me_profile_controller_rules.yml) - Rules specific to me_profile.dart
- [Avatar Page Rules](./lib/pages/me/avatar_page_rules.yml) - Rules specific to avatar_change_page.dart
- [Me Profile Implementation Guide](./pages/me/me_profile_implementation_guide.md) - Implementation guide for me_profile.dart

### Page Rules - General

- [General Page Rules](./lib/pages/general_page_rules.yml) - General page rules