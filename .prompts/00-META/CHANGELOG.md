# Prompt System Changelog

> **Evolution History of the Peers-Touch Prompt System**

---

## [2.0.0] - 2025-12-31

### 🎉 Major Restructuring

**Breaking Changes:**
- Complete reorganization of prompt directory structure
- Moved from scattered `PROMPTs/` folders to unified `.prompts/` system
- Introduced hierarchical numbering system (00-, 10-, 20-, 30-, 90-)

**Added:**
- `00-META/` layer with INDEX, GLOSSARY, and CHANGELOG
- `10-GLOBAL/` layer for cross-platform rules
- `21-DESKTOP/` and `22-MOBILE/` under `20-CLIENT/`
- `30-STATION/` for backend prompts
- `90-CONTEXT/` for historical context and ADRs

**Migrated:**
- Desktop prompts from `client/desktop/PROMPTs/` → `.prompts/20-CLIENT/21-DESKTOP/`
- Mobile prompts from `client/mobile/PROMPTs/` → `.prompts/20-CLIENT/22-MOBILE/`
- Global rules from `.trae/rules/project_rules.md` → `.prompts/10-GLOBAL/`

**Improved:**
- Clear AI reading strategy with priority levels (MUST/SHOULD/OPTIONAL)
- Separation of "what to do" (rules) vs "why we do it" (context)
- Single entry point (INDEX.md) for all prompt navigation

**Removed:**
- Duplicate content between BASE_PROMPT and SCAFFOLDING_PROMPT
- Scattered documentation in various `docs/` folders

---

## [1.x] - 2024-2025 (Legacy)

### Desktop Prompts (client/desktop/PROMPTs/)
- `SCAFFOLDING_PROMPT.md` - Directory structure guide
- `PROJECT_CORE_PROMPT.md` - Core architecture principles
- `PROJECT_BASE_PROMPT.zh.md` - Base architecture (Chinese)
- `TASK_PROMPT_TEMPLATE.md` - Task template
- Feature-specific prompts:
  - `ai_chat/FEATURE_PROMPT.md`
  - `settings/FEATURE_PROMPT.md`
  - `profile/FEATURE_PROMPT.md`

### Mobile Prompts (client/mobile/PROMPTs/)
- `PROJECT_BASE_PROMPT.zh.md` - Base architecture (Chinese)
- 6 UI-focused prompts:
  - `1.global_description.zh.md`
  - `2.global_ui_skeleton.zh.md`
  - `3.global_ui_components.zh.md`
  - `4.global_ui_kit_and_theme.zh.md`
  - `5.global_ui_animation_dimension.zh.md`
  - `6.global_ui_visual.zh.md`

### Global Rules (.trae/rules/)
- `project_rules.md` - Mixed global and Dart-specific rules

### Issues in v1.x:
- ❌ No clear entry point
- ❌ Duplicate content across files
- ❌ Unclear hierarchy (global vs platform-specific)
- ❌ No historical context (why decisions were made)
- ❌ Difficult for AI to determine reading priority

---

## Migration Notes

### For Developers:
- **Old location**: `client/desktop/PROMPTs/`
- **New location**: `.prompts/20-CLIENT/21-DESKTOP/`
- **Action**: Update any bookmarks or documentation links

### For AI:
- **Old entry**: `.trae/rules/project_rules.md`
- **New entry**: `.prompts/00-META/INDEX.md`
- **Reading strategy**: Follow the priority levels in INDEX.md

### Backward Compatibility:
- Old prompt files have been **removed** after migration
- `.trae/rules/project_rules.md` now **points to** `.prompts/`

---

## Future Plans

### [2.1.0] - Planned
- [ ] Add more ADRs to `90-CONTEXT/decisions/`
- [ ] Complete `30-STATION/subsystems/` prompts
- [ ] Add visual diagrams to architecture prompts
- [ ] Create quick-start guides for common tasks

### [3.0.0] - Future
- [ ] Interactive prompt navigator tool
- [ ] Automated prompt consistency checker
- [ ] Integration with IDE extensions

---

## Versioning Scheme

We follow semantic versioning for the prompt system:

- **Major (X.0.0)**: Structural changes, breaking reorganization
- **Minor (x.Y.0)**: New prompts added, significant content updates
- **Patch (x.y.Z)**: Minor corrections, clarifications, typo fixes

---

## Contributing

When updating prompts:
1. Update the relevant prompt file
2. Add an entry to this CHANGELOG
3. Update INDEX.md if navigation changes
4. Update GLOSSARY.md if new terms are introduced

---

*Maintained by the Peers-Touch Architecture Team*
