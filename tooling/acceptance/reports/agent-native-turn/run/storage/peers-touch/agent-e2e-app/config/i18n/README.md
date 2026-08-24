# Peers Touch — Language Packs

This directory is managed by Peers Touch at startup.

## Built-in packs (auto-managed)

`en/` and `zh-CN/` are re-deployed when the built-in pack version
changes (tracked by the `version` field in `metadata.json`).
Do NOT edit files inside them — your changes will be overwritten
on the next app update.

## Adding a community / custom language pack

1. Create a new directory named with the BCP-47 language tag, e.g. `ja/`, `ko/`, `fr/`.
2. Copy the JSON files from `en/` as a template.
3. Translate each key-value pair; keep the keys unchanged.
4. (Optional) Add an entry in `metadata.json` with `name` and `nativeName`.
5. Restart the app — the new language will appear in the language switcher.

Community packs are **never touched** by the app.
