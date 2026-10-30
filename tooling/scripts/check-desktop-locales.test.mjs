import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_NAMESPACE,
  extractTranslationKeys,
  findDuplicateKeys,
  parseNamespaces,
} from './check-desktop-locales.mjs';

test('parses single, array, and default namespace bindings', () => {
  assert.deepEqual(parseNamespaces("const { t } = useTranslation('auth');"), ['auth']);
  assert.deepEqual(
    parseNamespaces("useTranslation(['chat', 'agent'])"),
    ['chat', 'agent'],
  );
  assert.deepEqual(parseNamespaces('useTranslation()'), [DEFAULT_NAMESPACE]);
  assert.deepEqual(parseNamespaces('const value = 42;'), []);
});

test('extracts literal keys with line, count, and forceCommon markers', () => {
  const content = [
    "const x = t('auth.login.title');",
    "t('chat.unread', { count: total });",
    "resolveI18nValue(item.label);",
    "resolveI18nValue('common.stationPicker.title');",
    't(dynamicKey);',
    "i18n.t('common.save');",
  ].join('\n');

  const findings = extractTranslationKeys(content);
  const byKey = Object.fromEntries(findings.map((f) => [f.key, f]));

  assert.equal(byKey['auth.login.title'].line, 1);
  assert.equal(byKey['auth.login.title'].count, false);
  assert.equal(byKey['chat.unread'].count, true);
  assert.equal(byKey['common.stationPicker.title'].forceCommon, true);
  assert.equal(byKey['common.save'].forceCommon, false);
  assert.ok(!('dynamicKey' in byKey));
  // resolveI18nValue with a variable argument is not a literal reference.
  assert.equal(findings.filter((f) => f.forceCommon).length, 1);
});

test('captures explicit per-call namespace options', () => {
  const findings = extractTranslationKeys(
    "t('common.action.add', { ns: 'common' }); t('search.label', { ns: 'search' });",
  );
  assert.deepEqual(findings.map((f) => [f.key, f.callNs]), [
    ['common.action.add', ['common']],
    ['search.label', ['search']],
  ]);

  const arrayNs = extractTranslationKeys("t('x.y', { ns: ['chat', 'agent'] });");
  assert.deepEqual(arrayNs[0].callNs, ['chat', 'agent']);
});

test('does not match property accessors or word boundaries', () => {
  const findings = extractTranslationKeys("obj.t('a.b'); const xt = z.t2('c.d');");
  const keys = findings.map((f) => f.key);
  assert.ok(keys.includes('a.b'));
  assert.ok(!keys.includes('c.d'));
});

test('detects duplicate flat JSON keys', () => {
  const text = '{\n  "a.b": "1",\n  "a.c": "2",\n  "a.b": "3"\n}\n';
  assert.deepEqual(findDuplicateKeys(text), ['a.b']);
  assert.deepEqual(findDuplicateKeys('{"a.b": "1", "a.c": "2"}'), []);
});
