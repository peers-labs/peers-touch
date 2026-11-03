# 公共候选逐项处置

> DRAFT / PROPOSED。来源导出是源码事实；target role 与转换处置是 Peers 提案，不证明现有上游行为或已完成迁移。

269 个候选逐个映射。完整控件、组合入口、状态 Root、Label/Icon/Content 槽、Portal/Positioner/Viewport、Provider 和平台 port 分别说明，不把所有名字计成独立控件。保留哪一项 Peers public API 须经合同接受；不要求复刻所有上游 atoms。

[逐项规范](./specs/README.md) · [源码全集](./component-catalog.md)

<a id="ui.spec.button"></a>
## Button / SplitButton

[完整合同](./specs/action.md#ui.spec.button)

- `Button`（[来源](./component-catalog.md#ui.family.button)）→ `single-command`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SplitButton`（[来源](./component-catalog.md#ui.family.button)）→ `default-command-and-alternative-menu`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.actionicon"></a>
## IconButton

[完整合同](./specs/action.md#ui.spec.actionicon)

- `ActionIcon`（[来源](./component-catalog.md#ui.family.actionicon)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.actionicongroup"></a>
## ActionGroup

[完整合同](./specs/action.md#ui.spec.actionicongroup)

- `ActionIconGroup`（[来源](./component-catalog.md#ui.family.actionicongroup)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.copybutton"></a>
## CopyAction

[完整合同](./specs/action.md#ui.spec.copybutton)

- `CopyButton`（[来源](./component-catalog.md#ui.family.copybutton)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.downloadbutton"></a>
## DownloadAction

[完整合同](./specs/action.md#ui.spec.downloadbutton)

- `DownloadButton`（[来源](./component-catalog.md#ui.family.downloadbutton)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.confirmaction"></a>
## ConfirmAction

[完整合同](./specs/action.md#ui.spec.confirmaction)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.overflowtoolbar"></a>
## OverflowToolbar

[完整合同](./specs/action.md#ui.spec.overflowtoolbar)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.input"></a>
## TextField / NumberField / PinField / PasswordField / TextArea

[完整合同](./specs/input.md#ui.spec.input)

- `Input`（[来源](./component-catalog.md#ui.family.input)）→ `text-value`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `InputNumber`（[来源](./component-catalog.md#ui.family.input)）→ `numeric-value`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `InputOTP`（[来源](./component-catalog.md#ui.family.input)）→ `pin-value`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `InputPassword`（[来源](./component-catalog.md#ui.family.input)）→ `secret-input`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TextArea`（[来源](./component-catalog.md#ui.family.input)）→ `multiline-value`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.autocomplete"></a>
## Autocomplete

[完整合同](./specs/input.md#ui.spec.autocomplete)

- `AutoComplete`（[来源](./component-catalog.md#ui.family.autocomplete)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.checkbox"></a>
## Checkbox / CheckboxGroup

[完整合同](./specs/input.md#ui.spec.checkbox)

- `Checkbox`（[来源](./component-catalog.md#ui.family.checkbox)）→ `boolean-input`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `CheckboxGroup`（[来源](./component-catalog.md#ui.family.checkbox)）→ `choice-set-and-legend`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.radio"></a>
## Radio / RadioGroup

[完整合同](./specs/input.md#ui.spec.radio)

- `Radio`（[来源](./component-catalog.md#ui.family.radio)）→ `exclusive-choice`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `RadioGroup`（[来源](./component-catalog.md#ui.family.radio)）→ `group-value-and-legend`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.switch"></a>
## Switch

[完整合同](./specs/input.md#ui.spec.switch)

- `Switch`（[来源](./component-catalog.md#ui.family.switch)）→ `immediate-setting`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SwitchIcon`（[来源](./component-catalog.md#ui.family.switch)）→ `value-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SwitchRoot`（[来源](./component-catalog.md#ui.family.switch)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SwitchThumb`（[来源](./component-catalog.md#ui.family.switch)）→ `value-thumb`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.select"></a>
## Select / MultiSelect

[完整合同](./specs/input.md#ui.spec.select)

- `Select`（[来源](./component-catalog.md#ui.family.select)）→ `choice-field-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectArrow`（[来源](./component-catalog.md#ui.family.select)）→ `popup-direction-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectBackdrop`（[来源](./component-catalog.md#ui.family.select)）→ `dismiss-layer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectGroup`（[来源](./component-catalog.md#ui.family.select)）→ `semantic-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectGroupLabel`（[来源](./component-catalog.md#ui.family.select)）→ `group-label`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectIcon`（[来源](./component-catalog.md#ui.family.select)）→ `trigger-glyph`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectItem`（[来源](./component-catalog.md#ui.family.select)）→ `option-item`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectItemIndicator`（[来源](./component-catalog.md#ui.family.select)）→ `selected-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectItemText`（[来源](./component-catalog.md#ui.family.select)）→ `option-label`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectList`（[来源](./component-catalog.md#ui.family.select)）→ `listbox`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectPopup`（[来源](./component-catalog.md#ui.family.select)）→ `popup-surface`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectPortal`（[来源](./component-catalog.md#ui.family.select)）→ `window-portal`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectPositioner`（[来源](./component-catalog.md#ui.family.select)）→ `anchor-collision`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectRoot`（[来源](./component-catalog.md#ui.family.select)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectScrollDownArrow`（[来源](./component-catalog.md#ui.family.select)）→ `overflow-scroll-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectScrollUpArrow`（[来源](./component-catalog.md#ui.family.select)）→ `overflow-scroll-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectSeparator`（[来源](./component-catalog.md#ui.family.select)）→ `semantic-separator`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectTrigger`（[来源](./component-catalog.md#ui.family.select)）→ `trigger`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SelectValue`（[来源](./component-catalog.md#ui.family.select)）→ `value-summary`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.searchbar"></a>
## SearchField

[完整合同](./specs/input.md#ui.spec.searchbar)

- `SearchBar`（[来源](./component-catalog.md#ui.family.searchbar)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.form"></a>
## Form / Field / FieldGroup

[完整合同](./specs/input.md#ui.spec.form)

- `Form`（[来源](./component-catalog.md#ui.family.form)）→ `draft-and-submit-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `FormDivider`（[来源](./component-catalog.md#ui.family.form)）→ `group-separator`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `FormField`（[来源](./component-catalog.md#ui.family.form)）→ `field-frame`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `FormFlatGroup`（[来源](./component-catalog.md#ui.family.form)）→ `field-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `FormFooter`（[来源](./component-catalog.md#ui.family.form)）→ `action-footer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `FormGroup`（[来源](./component-catalog.md#ui.family.form)）→ `field-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `FormSubmitFooter`（[来源](./component-catalog.md#ui.family.form)）→ `action-footer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `FormTitle`（[来源](./component-catalog.md#ui.family.form)）→ `group-title`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.editabletext"></a>
## InlineEdit

[完整合同](./specs/input.md#ui.spec.editabletext)

- `EditableText`（[来源](./component-catalog.md#ui.family.editabletext)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.colorpicker"></a>
## ColorPicker

[完整合同](./specs/input.md#ui.spec.colorpicker)

- `ColorPicker`（[来源](./component-catalog.md#ui.family.colorpicker)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.colorswatches"></a>
## ColorSwatches

[完整合同](./specs/input.md#ui.spec.colorswatches)

- `ColorSwatches`（[来源](./component-catalog.md#ui.family.colorswatches)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.datepicker"></a>
## DateField / DateRangeField

[完整合同](./specs/input.md#ui.spec.datepicker)

- `DatePicker`（[来源](./component-catalog.md#ui.family.datepicker)）→ `date-only`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DateRangePicker`（[来源](./component-catalog.md#ui.family.datepicker)）→ `date-range`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DayjsDatePicker`（[来源](./component-catalog.md#ui.family.datepicker)）→ `date-only`。Public values use Peers date-only semantics; Dayjs remains an audited internal conversion if adopted, never a public dependency.
- `DayjsDateRangePicker`（[来源](./component-catalog.md#ui.family.datepicker)）→ `date-range`。Convert Dayjs range values at the port boundary; inclusive/exclusive range meaning must follow DateField contract.

<a id="ui.spec.timefield"></a>
## TimeField

[完整合同](./specs/input.md#ui.spec.timefield)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.hotkeyinput"></a>
## ShortcutField

[完整合同](./specs/input.md#ui.spec.hotkeyinput)

- `HotkeyInput`（[来源](./component-catalog.md#ui.family.hotkeyinput)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.imageselect"></a>
## ImageChoice

[完整合同](./specs/input.md#ui.spec.imageselect)

- `ImageSelect`（[来源](./component-catalog.md#ui.family.imageselect)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.rate"></a>
## Rating

[完整合同](./specs/input.md#ui.spec.rate)

- `Rate`（[来源](./component-catalog.md#ui.family.rate)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.segmented"></a>
## SegmentedControl

[完整合同](./specs/input.md#ui.spec.segmented)

- `Segmented`（[来源](./component-catalog.md#ui.family.segmented)）→ `single-mode-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SegmentedIndicator`（[来源](./component-catalog.md#ui.family.segmented)）→ `selected-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SegmentedItem`（[来源](./component-catalog.md#ui.family.segmented)）→ `mode-item`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SegmentedItemIcon`（[来源](./component-catalog.md#ui.family.segmented)）→ `item-glyph`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SegmentedItemLabel`（[来源](./component-catalog.md#ui.family.segmented)）→ `item-label`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SegmentedRoot`（[来源](./component-catalog.md#ui.family.segmented)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.slider"></a>
## Slider / SliderField

[完整合同](./specs/input.md#ui.spec.slider)

- `Slider`（[来源](./component-catalog.md#ui.family.slider)）→ `range-editor`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SliderWithInput`（[来源](./component-catalog.md#ui.family.slider)）→ `range-and-precise-number-field`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.togglegroup"></a>
## ToggleButton / ToggleGroup

[完整合同](./specs/input.md#ui.spec.togglegroup)

- `ToggleGroup`（[来源](./component-catalog.md#ui.family.togglegroup)）→ `pressed-choice-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ToggleGroupItem`（[来源](./component-catalog.md#ui.family.togglegroup)）→ `toggle-item`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ToggleGroupItemIcon`（[来源](./component-catalog.md#ui.family.togglegroup)）→ `item-glyph`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ToggleGroupItemLabel`（[来源](./component-catalog.md#ui.family.togglegroup)）→ `item-label`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ToggleGroupRoot`（[来源](./component-catalog.md#ui.family.togglegroup)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.sortablelist"></a>
## ReorderableList

[完整合同](./specs/input.md#ui.spec.sortablelist)

- `SortableList`（[来源](./component-catalog.md#ui.family.sortablelist)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.upload"></a>
## FilePicker / FileDropzone

[完整合同](./specs/input.md#ui.spec.upload)

- `Upload`（[来源](./component-catalog.md#ui.family.upload)）→ `system-file-picker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `UploadDragger`（[来源](./component-catalog.md#ui.family.upload)）→ `equivalent-file-dropzone`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.editorslashmenu"></a>
## SlashCommandMenu

[完整合同](./specs/input.md#ui.spec.editorslashmenu)

- `EditorSlashMenu`（[来源](./component-catalog.md#ui.family.editorslashmenu)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.emojipicker"></a>
## EmojiPicker

[完整合同](./specs/input.md#ui.spec.emojipicker)

- `EmojiPicker`（[来源](./component-catalog.md#ui.family.emojipicker)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.mentionpicker"></a>
## MentionPicker

[完整合同](./specs/input.md#ui.spec.mentionpicker)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.richtexteditor"></a>
## RichTextEditor

[完整合同](./specs/input.md#ui.spec.richtexteditor)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.treeselect"></a>
## TreeSelect / Cascader

[完整合同](./specs/input.md#ui.spec.treeselect)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.a"></a>
## Link

[完整合同](./specs/content.md#ui.spec.a)

- `A`（[来源](./component-catalog.md#ui.family.a)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.agentavatar"></a>
## AgentAvatar

[完整合同](./specs/identity.md#ui.spec.agentavatar)

- `AgentAvatar`（[来源](./component-catalog.md#ui.family.agentavatar)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.avatar"></a>
## Avatar / AvatarGroup

[完整合同](./specs/identity.md#ui.spec.avatar)

- `Avatar`（[来源](./component-catalog.md#ui.family.avatar)）→ `identity`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `AvatarGroup`（[来源](./component-catalog.md#ui.family.avatar)）→ `member-summary-and-count`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.groupavatar"></a>
## GroupAvatar

[完整合同](./specs/identity.md#ui.spec.groupavatar)

- `GroupAvatar`（[来源](./component-catalog.md#ui.family.groupavatar)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.filetypeicon"></a>
## FileTypeGlyph

[完整合同](./specs/identity.md#ui.spec.filetypeicon)

- `FileTypeIcon`（[来源](./component-catalog.md#ui.family.filetypeicon)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `MaterialFileTypeIcon`（[来源](./component-catalog.md#ui.family.materialfiletypeicon)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.fluentemoji"></a>
## EmojiArtwork

[完整合同](./specs/identity.md#ui.spec.fluentemoji)

- `FluentEmoji`（[来源](./component-catalog.md#ui.family.fluentemoji)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.icon"></a>
## Icon / IconAssets

[完整合同](./specs/identity.md#ui.spec.icon)

- `Icon`（[来源](./component-catalog.md#ui.family.icon)）→ `registered-glyph`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.alert"></a>
## InlineAlert

[完整合同](./specs/feedback.md#ui.spec.alert)

- `Alert`（[来源](./component-catalog.md#ui.family.alert)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.badge"></a>
## Badge

[完整合同](./specs/feedback.md#ui.spec.badge)

- `Badge`（[来源](./component-catalog.md#ui.family.badge)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.empty"></a>
## EmptyState

[完整合同](./specs/feedback.md#ui.spec.empty)

- `Empty`（[来源](./component-catalog.md#ui.family.empty)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.guidecard"></a>
## GuideStep

[完整合同](./specs/feedback.md#ui.spec.guidecard)

- `GuideCard`（[来源](./component-catalog.md#ui.family.guidecard)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.progress"></a>
## Progress

[完整合同](./specs/feedback.md#ui.spec.progress)

- `Progress`（[来源](./component-catalog.md#ui.family.progress)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.result"></a>
## ResultState

[完整合同](./specs/feedback.md#ui.spec.result)

- `Result`（[来源](./component-catalog.md#ui.family.result)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.skeleton"></a>
## Skeleton

[完整合同](./specs/feedback.md#ui.spec.skeleton)

- `Skeleton`（[来源](./component-catalog.md#ui.family.skeleton)）→ `known-layout-placeholder`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SkeletonAvatar`（[来源](./component-catalog.md#ui.family.skeleton)）→ `avatar-placeholder`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SkeletonText`（[来源](./component-catalog.md#ui.family.skeleton)）→ `text-placeholder`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.spin"></a>
## BusyIndicator

[完整合同](./specs/feedback.md#ui.spec.spin)

- `Spin`（[来源](./component-catalog.md#ui.family.spin)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.tag"></a>
## StatusTag / FilterChip

[完整合同](./specs/feedback.md#ui.spec.tag)

- `Tag`（[来源](./component-catalog.md#ui.family.tag)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.toast"></a>
## Toast / ToastHost

[完整合同](./specs/feedback.md#ui.spec.toast)

- `ToastHost`（[来源](./component-catalog.md#ui.family.toast)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.descriptions"></a>
## KeyValueList

[完整合同](./specs/content.md#ui.spec.descriptions)

- `Descriptions`（[来源](./component-catalog.md#ui.family.descriptions)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.hotkey"></a>
## ShortcutHint

[完整合同](./specs/content.md#ui.spec.hotkey)

- `Hotkey`（[来源](./component-catalog.md#ui.family.hotkey)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.list"></a>
## List / ListItem

[完整合同](./specs/content.md#ui.spec.list)

- `List`（[来源](./component-catalog.md#ui.family.list)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.markdown"></a>
## Markdown / RichText

[完整合同](./specs/content.md#ui.spec.markdown)

- `Markdown`（[来源](./component-catalog.md#ui.family.markdown)）→ `safe-rich-text`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SearchResultCards`（[来源](./component-catalog.md#ui.family.markdown)）→ `citation-results`。Use the citation-result scenarios within Markdown, with title, origin, excerpt, attribution and access state.

<a id="ui.spec.statistic"></a>
## Metric

[完整合同](./specs/content.md#ui.spec.statistic)

- `Statistic`（[来源](./component-catalog.md#ui.family.statistic)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.table"></a>
## DataTable

[完整合同](./specs/content.md#ui.spec.table)

- `Table`（[来源](./component-catalog.md#ui.family.table)）→ `table-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableBody`（[来源](./component-catalog.md#ui.family.table)）→ `body-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableCell`（[来源](./component-catalog.md#ui.family.table)）→ `data-cell`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableColGroup`（[来源](./component-catalog.md#ui.family.table)）→ `column-tracks`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableContainer`（[来源](./component-catalog.md#ui.family.table)）→ `bounded-container`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableElement`（[来源](./component-catalog.md#ui.family.table)）→ `table-element-semantics`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableExpandedRow`（[来源](./component-catalog.md#ui.family.table)）→ `expanded-detail-row`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableFooter`（[来源](./component-catalog.md#ui.family.table)）→ `action-footer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableHeader`（[来源](./component-catalog.md#ui.family.table)）→ `header-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableHeaderCell`（[来源](./component-catalog.md#ui.family.table)）→ `header-cell`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableRoot`（[来源](./component-catalog.md#ui.family.table)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableRow`（[来源](./component-catalog.md#ui.family.table)）→ `row`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableScroll`（[来源](./component-catalog.md#ui.family.table)）→ `scroll-viewport`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableSummaryFoot`（[来源](./component-catalog.md#ui.family.table)）→ `summary-footer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TableTitle`（[来源](./component-catalog.md#ui.family.table)）→ `heading`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.text"></a>
## Text

[完整合同](./specs/content.md#ui.spec.text)

- `Typography`（[来源](./component-catalog.md#ui.family.markdown)）→ `typography-roles`。Use the Text contract and semantic heading levels; do not retain an upstream typography facade inside Markdown.
- `Text`（[来源](./component-catalog.md#ui.family.text)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.calendarview"></a>
## CalendarView

[完整合同](./specs/content.md#ui.spec.calendarview)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.virtuallist"></a>
## VirtualList

[完整合同](./specs/content.md#ui.spec.virtuallist)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.secretvalue"></a>
## SecretValue

[完整合同](./specs/content.md#ui.spec.secretvalue)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.block"></a>
## Surface

[完整合同](./specs/layout.md#ui.spec.block)

- `Block`（[来源](./component-catalog.md#ui.family.block)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.divider"></a>
## Divider

[完整合同](./specs/layout.md#ui.spec.divider)

- `Divider`（[来源](./component-catalog.md#ui.family.divider)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.draggablepanel"></a>
## ResizablePanel

[完整合同](./specs/layout.md#ui.spec.draggablepanel)

- `DraggablePanel`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `resizable-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelBody`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `content-viewport`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelContainer`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `layout-container`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelContent`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `content-viewport`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelFooter`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `task-actions`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelHandle`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `resize-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelHeader`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `heading`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelRoot`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DraggablePanelToggle`（[来源](./component-catalog.md#ui.family.draggablepanel)）→ `collapse-restore`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.flex"></a>
## Stack / Inline

[完整合同](./specs/layout.md#ui.spec.flex)

- `Center`（[来源](./component-catalog.md#ui.family.flex)）→ `center-alignment-preset`。A named alignment preset of Stack/Inline; it does not establish a separate layout engine.
- `FlexBasic`（[来源](./component-catalog.md#ui.family.flex)）→ `one-dimensional-layout`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `Flexbox`（[来源](./component-catalog.md#ui.family.flex)）→ `one-dimensional-layout`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.grid"></a>
## Grid

[完整合同](./specs/layout.md#ui.spec.grid)

- `Grid`（[来源](./component-catalog.md#ui.family.grid)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.header"></a>
## PageHeader

[完整合同](./specs/layout.md#ui.spec.header)

- `Header`（[来源](./component-catalog.md#ui.family.header)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.layout"></a>
## PageLayout

[完整合同](./specs/layout.md#ui.spec.layout)

- `Layout`（[来源](./component-catalog.md#ui.family.layout)）→ `page-region-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `LayoutFooter`（[来源](./component-catalog.md#ui.family.layout)）→ `footer-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `LayoutHeader`（[来源](./component-catalog.md#ui.family.layout)）→ `header-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `LayoutMain`（[来源](./component-catalog.md#ui.family.layout)）→ `main-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `LayoutSidebar`（[来源](./component-catalog.md#ui.family.layout)）→ `sidebar-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `LayoutSidebarInner`（[来源](./component-catalog.md#ui.family.layout)）→ `sidebar-content`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `LayoutToc`（[来源](./component-catalog.md#ui.family.layout)）→ `section-directory`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.maskshadow"></a>
## OverflowHint

[完整合同](./specs/layout.md#ui.spec.maskshadow)

- `MaskShadow`（[来源](./component-catalog.md#ui.family.maskshadow)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ScrollShadow`（[来源](./component-catalog.md#ui.family.scrollshadow)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.progressiveblur"></a>
## SurfaceFade

[完整合同](./specs/layout.md#ui.spec.progressiveblur)

- `ProgressiveBlur`（[来源](./component-catalog.md#ui.family.progressiveblur)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.scrollarea"></a>
## ScrollArea

[完整合同](./specs/layout.md#ui.spec.scrollarea)

- `ScrollArea`（[来源](./component-catalog.md#ui.family.scrollarea)）→ `scroll-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ScrollAreaContent`（[来源](./component-catalog.md#ui.family.scrollarea)）→ `content`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ScrollAreaCorner`（[来源](./component-catalog.md#ui.family.scrollarea)）→ `two-axis-corner`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ScrollAreaRoot`（[来源](./component-catalog.md#ui.family.scrollarea)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ScrollAreaScrollbar`（[来源](./component-catalog.md#ui.family.scrollarea)）→ `scrollbar-track`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ScrollAreaThumb`（[来源](./component-catalog.md#ui.family.scrollarea)）→ `scrollbar-thumb`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ScrollAreaViewport`（[来源](./component-catalog.md#ui.family.scrollarea)）→ `viewport`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.card"></a>
## Card

[完整合同](./specs/layout.md#ui.spec.card)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.accordion"></a>
## Accordion

[完整合同](./specs/disclosure.md#ui.spec.accordion)

- `Accordion`（[来源](./component-catalog.md#ui.family.accordion)）→ `composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `AccordionHeader`（[来源](./component-catalog.md#ui.family.accordion)）→ `heading`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `AccordionItem`（[来源](./component-catalog.md#ui.family.accordion)）→ `item`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `AccordionPanel`（[来源](./component-catalog.md#ui.family.accordion)）→ `controlled-panel`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `AccordionRoot`（[来源](./component-catalog.md#ui.family.accordion)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `AccordionTrigger`（[来源](./component-catalog.md#ui.family.accordion)）→ `activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.collapsible"></a>
## Disclosure

[完整合同](./specs/disclosure.md#ui.spec.collapsible)

- `Collapsible`（[来源](./component-catalog.md#ui.family.collapsible)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.anchor"></a>
## SectionNav

[完整合同](./specs/navigation.md#ui.spec.anchor)

- `Anchor`（[来源](./component-catalog.md#ui.family.anchor)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.breadcrumb"></a>
## Breadcrumb

[完整合同](./specs/navigation.md#ui.spec.breadcrumb)

- `Breadcrumb`（[来源](./component-catalog.md#ui.family.breadcrumb)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.burger"></a>
## NavigationToggle

[完整合同](./specs/navigation.md#ui.spec.burger)

- `Burger`（[来源](./component-catalog.md#ui.family.burger)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.draggablesidenav"></a>
## ResizableNavigationRail

[完整合同](./specs/navigation.md#ui.spec.draggablesidenav)

- `DraggableSideNav`（[来源](./component-catalog.md#ui.family.draggablesidenav)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.pagination"></a>
## Pagination

[完整合同](./specs/navigation.md#ui.spec.pagination)

- `Pagination`（[来源](./component-catalog.md#ui.family.pagination)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.sidenav"></a>
## NavigationRail

[完整合同](./specs/navigation.md#ui.spec.sidenav)

- `SideNav`（[来源](./component-catalog.md#ui.family.sidenav)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.steps"></a>
## StepProgress

[完整合同](./specs/navigation.md#ui.spec.steps)

- `Steps`（[来源](./component-catalog.md#ui.family.steps)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.tabs"></a>
## Tabs

[完整合同](./specs/navigation.md#ui.spec.tabs)

- `Tabs`（[来源](./component-catalog.md#ui.family.tabs)）→ `tab-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TabsIndicator`（[来源](./component-catalog.md#ui.family.tabs)）→ `selected-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TabsList`（[来源](./component-catalog.md#ui.family.tabs)）→ `tab-list`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TabsPanel`（[来源](./component-catalog.md#ui.family.tabs)）→ `controlled-panel`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TabsRoot`（[来源](./component-catalog.md#ui.family.tabs)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TabsTab`（[来源](./component-catalog.md#ui.family.tabs)）→ `tab-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.tree"></a>
## Tree

[完整合同](./specs/navigation.md#ui.spec.tree)

- `Tree`（[来源](./component-catalog.md#ui.family.tree)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.commandpalette"></a>
## CommandPalette

[完整合同](./specs/navigation.md#ui.spec.commandpalette)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.contextmenu"></a>
## ContextMenu

[完整合同](./specs/overlay.md#ui.spec.contextmenu)

- `ContextMenuHost`（[来源](./component-catalog.md#ui.family.contextmenu)）→ `window-menu-host`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ContextMenuTrigger`（[来源](./component-catalog.md#ui.family.contextmenu)）→ `object-context-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.dropdownmenu"></a>
## Menu

[完整合同](./specs/overlay.md#ui.spec.dropdownmenu)

- `DropdownMenu`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuCheckboxItemIndicator`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `choice-item-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuCheckboxItemPrimitive`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `choice-item-state`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuFooter`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `footer-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuGroup`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `semantic-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuGroupLabel`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `group-label`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuHeader`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `heading-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuItem`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `command-item`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuItemContent`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `item-content`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuItemDesc`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `item-description`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuItemExtra`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `item-extra-status`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuItemIcon`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `item-glyph`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuItemLabel`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `item-label`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuItemLabelGroup`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `item-label-layout`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuPopup`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `popup-surface`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuPortal`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `window-portal`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuPositioner`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `anchor-collision`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuRoot`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuScrollViewport`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `bounded-scroll`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuSeparator`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `semantic-separator`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuSubmenuArrow`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `nested-menu-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuSubmenuRoot`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `nested-menu-state`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuSubmenuTrigger`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `nested-menu-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DropdownMenuSwitchItem`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `immediate-boolean-choice`。Immediate boolean choice inside Menu uses the same setting value owner and rollback; a generic form cannot be embedded as a menu item.
- `DropdownMenuTrigger`（[来源](./component-catalog.md#ui.family.dropdownmenu)）→ `open-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.popover"></a>
## Popover

[完整合同](./specs/overlay.md#ui.spec.popover)

- `Popover`（[来源](./component-catalog.md#ui.family.popover)）→ `short-task-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverArrow`（[来源](./component-catalog.md#ui.family.popover)）→ `anchor-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverArrowIcon`（[来源](./component-catalog.md#ui.family.popover)）→ `anchor-marker`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverBackdrop`（[来源](./component-catalog.md#ui.family.popover)）→ `dismiss-layer-not-modal-trap`。Dismissal layer does not make a short-task Popover modal; modal work follows Dialog.
- `PopoverGroup`（[来源](./component-catalog.md#ui.family.popover)）→ `singleton-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverPopup`（[来源](./component-catalog.md#ui.family.popover)）→ `popup-surface`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverPortal`（[来源](./component-catalog.md#ui.family.popover)）→ `window-portal`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverPositioner`（[来源](./component-catalog.md#ui.family.popover)）→ `anchor-collision`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverProvider`（[来源](./component-catalog.md#ui.family.popover)）→ `scope-context`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverRoot`（[来源](./component-catalog.md#ui.family.popover)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverTriggerElement`（[来源](./component-catalog.md#ui.family.popover)）→ `trigger-association`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PopoverViewport`（[来源](./component-catalog.md#ui.family.popover)）→ `bounded-viewport`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.tooltip"></a>
## Tooltip

[完整合同](./specs/overlay.md#ui.spec.tooltip)

- `Tooltip`（[来源](./component-catalog.md#ui.family.tooltip)）→ `plain-hint`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `TooltipGroup`（[来源](./component-catalog.md#ui.family.tooltip)）→ `bounded-delay-group`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.modal"></a>
## Dialog / ConfirmDialog

[完整合同](./specs/overlay.md#ui.spec.modal)

- `Modal`（[来源](./component-catalog.md#ui.family.modal)）→ `dialog-composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalBackdrop`（[来源](./component-catalog.md#ui.family.modal)）→ `modal-background`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalClose`（[来源](./component-catalog.md#ui.family.modal)）→ `close-request`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalContent`（[来源](./component-catalog.md#ui.family.modal)）→ `content`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalDescription`（[来源](./component-catalog.md#ui.family.modal)）→ `description`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalFooter`（[来源](./component-catalog.md#ui.family.modal)）→ `action-footer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalHeader`（[来源](./component-catalog.md#ui.family.modal)）→ `heading-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalHost`（[来源](./component-catalog.md#ui.family.modal)）→ `window-host`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalPopup`（[来源](./component-catalog.md#ui.family.modal)）→ `popup-surface`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalPortal`（[来源](./component-catalog.md#ui.family.modal)）→ `window-portal`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalRoot`（[来源](./component-catalog.md#ui.family.modal)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalTitle`（[来源](./component-catalog.md#ui.family.modal)）→ `title`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalTrigger`（[来源](./component-catalog.md#ui.family.modal)）→ `open-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `ModalViewport`（[来源](./component-catalog.md#ui.family.modal)）→ `bounded-viewport`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.drawer"></a>
## Drawer

[完整合同](./specs/overlay.md#ui.spec.drawer)

- `Drawer`（[来源](./component-catalog.md#ui.family.drawer)）→ `composition`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerBackdrop`（[来源](./component-catalog.md#ui.family.drawer)）→ `modal-only-background`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerClose`（[来源](./component-catalog.md#ui.family.drawer)）→ `close-request`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerContent`（[来源](./component-catalog.md#ui.family.drawer)）→ `content`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerDescription`（[来源](./component-catalog.md#ui.family.drawer)）→ `description`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerFooter`（[来源](./component-catalog.md#ui.family.drawer)）→ `task-actions`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerHeader`（[来源](./component-catalog.md#ui.family.drawer)）→ `heading-region`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerPopup`（[来源](./component-catalog.md#ui.family.drawer)）→ `surface`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerPortal`（[来源](./component-catalog.md#ui.family.drawer)）→ `window-portal`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerRoot`（[来源](./component-catalog.md#ui.family.drawer)）→ `state-root`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerTitle`（[来源](./component-catalog.md#ui.family.drawer)）→ `title`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `DrawerTrigger`（[来源](./component-catalog.md#ui.family.drawer)）→ `open-activation`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.floatingsheet"></a>
## Sheet

[完整合同](./specs/overlay.md#ui.spec.floatingsheet)

- `FloatingSheet`（[来源](./component-catalog.md#ui.family.floatingsheet)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.floatingpanel"></a>
## FloatingPanel

[完整合同](./specs/overlay.md#ui.spec.floatingpanel)

- `FloatingPanel`（[来源](./component-catalog.md#ui.family.floatingpanel)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.carousel"></a>
## Carousel

[完整合同](./specs/media.md#ui.spec.carousel)

- `Carousel`（[来源](./component-catalog.md#ui.family.carousel)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.image"></a>
## Image / ImageViewer

[完整合同](./specs/media.md#ui.spec.image)

- `Image`（[来源](./component-catalog.md#ui.family.image)）→ `resolved-image`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PreviewGroup`（[来源](./component-catalog.md#ui.family.image)）→ `viewer-collection`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.htmlpreview"></a>
## HtmlPreview

[完整合同](./specs/media.md#ui.spec.htmlpreview)

- `HtmlPreview`（[来源](./component-catalog.md#ui.family.htmlpreview)）→ `isolated-preview`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `HtmlPreviewIframe`（[来源](./component-catalog.md#ui.family.htmlpreview)）→ `sandbox-renderer-port`。Platform renderer port only, governed by sandbox/network policy; no unrestricted iframe escape hatch.

<a id="ui.spec.qrcode"></a>
## QrCode

[完整合同](./specs/media.md#ui.spec.qrcode)

- `QRCode`（[来源](./component-catalog.md#ui.family.qrcode)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.video"></a>
## VideoPlayer

[完整合同](./specs/media.md#ui.spec.video)

- `Video`（[来源](./component-catalog.md#ui.family.video)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.audioplayer"></a>
## AudioPlayer

[完整合同](./specs/media.md#ui.spec.audioplayer)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.highlighter"></a>
## CodeBlock

[完整合同](./specs/code.md#ui.spec.highlighter)

- `Highlighter`（[来源](./component-catalog.md#ui.family.highlighter)）→ `read-only-code`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SyntaxHighlighter`（[来源](./component-catalog.md#ui.family.highlighter)）→ `read-only-code`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.snippet"></a>
## CodeSnippet

[完整合同](./specs/code.md#ui.spec.snippet)

- `Snippet`（[来源](./component-catalog.md#ui.family.snippet)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.codeeditor"></a>
## CodeEditor

[完整合同](./specs/code.md#ui.spec.codeeditor)

- `CodeEditor`（[来源](./component-catalog.md#ui.family.codeeditor)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.codediff"></a>
## CodeDiff

[完整合同](./specs/code.md#ui.spec.codediff)

- `CodeDiff`（[来源](./component-catalog.md#ui.family.codediff)）→ `snapshot-comparison`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `PatchDiff`（[来源](./component-catalog.md#ui.family.codediff)）→ `patch-input-comparison`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.mermaid"></a>
## DiagramPreview

[完整合同](./specs/code.md#ui.spec.mermaid)

- `Mermaid`（[来源](./component-catalog.md#ui.family.mermaid)）→ `sandbox-diagram-renderer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `SyntaxMermaid`（[来源](./component-catalog.md#ui.family.mermaid)）→ `sandbox-diagram-renderer`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.configprovider"></a>
## UIProvider

[完整合同](./specs/runtime.md#ui.spec.configprovider)

- `ConfigProvider`（[来源](./component-catalog.md#ui.family.configprovider)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.
- `IconProvider`（[来源](./component-catalog.md#ui.family.icon)）→ `asset-policy-context`。Asset policy belongs to UIProvider context; Icon does not create a second independent provider.
- `LobeUIProvider`（[来源](./component-catalog.md#ui.family.provider)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.focusscope"></a>
## FocusBoundary

[完整合同](./specs/runtime.md#ui.spec.focusscope)

- `FocusScope`（[来源](./component-catalog.md#ui.family.focusscope)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.fontloader"></a>
## FontAssets

[完整合同](./specs/runtime.md#ui.spec.fontloader)

- `FontLoader`（[来源](./component-catalog.md#ui.family.fontloader)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.freeze"></a>
## RenderSuspension

[完整合同](./specs/runtime.md#ui.spec.freeze)

- `Freeze`（[来源](./component-catalog.md#ui.family.freeze)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.motionprovider"></a>
## MotionPolicy

[完整合同](./specs/runtime.md#ui.spec.motionprovider)

- `MotionComponent`（[来源](./component-catalog.md#ui.family.motionprovider)）→ `renderer-motion-port`。Renderer implementation port only; business consumers request registered motion roles, never arbitrary upstream springs.
- `MotionProvider`（[来源](./component-catalog.md#ui.family.motionprovider)）→ `motion-policy-context`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.react-error-boundary"></a>
## ViewErrorBoundary

[完整合同](./specs/runtime.md#ui.spec.react-error-boundary)

- `ErrorBoundary`（[来源](./component-catalog.md#ui.family.react-error-boundary)）→ `family-capability`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.styles"></a>
## ThemeBoundary / ThemeBootstrap

[完整合同](./specs/runtime.md#ui.spec.styles)

- `LobeThemeScript`（[来源](./component-catalog.md#ui.family.styles)）→ `theme-bootstrap`。The target is Peers ThemeBootstrap; the supplier name and script are not retained as a Peers public API.
- `ThemeScope`（[来源](./component-catalog.md#ui.family.styles)）→ `approved-theme-boundary`。Compose or implement within the owning Peers contract; retaining this upstream export name is not required.

<a id="ui.spec.relationshiprequestitem"></a>
## RelationshipRequestItem

[完整合同](./specs/domain.md#ui.spec.relationshiprequestitem)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.contactitem"></a>
## ContactItem

[完整合同](./specs/domain.md#ui.spec.contactitem)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.conversationitem"></a>
## ConversationItem

[完整合同](./specs/domain.md#ui.spec.conversationitem)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.messagebubble"></a>
## MessageBubble

[完整合同](./specs/domain.md#ui.spec.messagebubble)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.messagecomposer"></a>
## MessageComposer

[完整合同](./specs/domain.md#ui.spec.messagecomposer)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.attachmentitem"></a>
## AttachmentItem

[完整合同](./specs/domain.md#ui.spec.attachmentitem)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.attachmentviewer"></a>
## AttachmentViewer

[完整合同](./specs/domain.md#ui.spec.attachmentviewer)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.reactionchip"></a>
## ReactionChip / ReactionPicker

[完整合同](./specs/domain.md#ui.spec.reactionchip)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.identityblock"></a>
## IdentityBlock

[完整合同](./specs/domain.md#ui.spec.identityblock)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.trustindicator"></a>
## TrustIndicator

[完整合同](./specs/domain.md#ui.spec.trustindicator)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.permissiondecision"></a>
## PermissionDecision

[完整合同](./specs/domain.md#ui.spec.permissiondecision)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.agenttaskcard"></a>
## AgentTaskCard

[完整合同](./specs/domain.md#ui.spec.agenttaskcard)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.toolcallcard"></a>
## ToolCallCard

[完整合同](./specs/domain.md#ui.spec.toolcallcard)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.devicelinkcard"></a>
## DeviceLinkCard

[完整合同](./specs/domain.md#ui.spec.devicelinkcard)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.connectionrecovery"></a>
## ConnectionRecovery

[完整合同](./specs/domain.md#ui.spec.connectionrecovery)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.notificationitem"></a>
## NotificationItem

[完整合同](./specs/domain.md#ui.spec.notificationitem)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.navigationshell"></a>
## NavigationShell

[完整合同](./specs/domain.md#ui.spec.navigationshell)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.applettile"></a>
## AppletTile

[完整合同](./specs/domain.md#ui.spec.applettile)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.resourceusage"></a>
## ResourceUsage

[完整合同](./specs/domain.md#ui.spec.resourceusage)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.onboardingflow"></a>
## OnboardingFlow

[完整合同](./specs/domain.md#ui.spec.onboardingflow)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

<a id="ui.spec.settingrow"></a>
## SettingRow

[完整合同](./specs/domain.md#ui.spec.settingrow)

Peers 补充需求，没有对应来源公共值；参见能力合同与源码候选记录。

