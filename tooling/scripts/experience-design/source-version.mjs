import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_FILES = [
  'admission.mjs',
  'calibration.mjs',
  'canonical.mjs',
  'comparative-calibration.mjs',
  'comparative-evaluator.mjs',
  'comparative-review.mjs',
  'comparative-schema.mjs',
  'evaluator.mjs',
  'evidence.mjs',
  'experience-design.mjs',
  'holdout.mjs',
  'ranking.mjs',
  'review-result-schema.mjs',
  'review-receipt.mjs',
  'schema.mjs',
  'source-fence.mjs',
  'source-version.mjs',
  'validator.mjs',
];

export function controlPlaneVersionDigest(scriptDirectory = SCRIPT_DIR) {
  const hash = createHash('sha256');
  for (const relativePath of SOURCE_FILES) {
    const sourcePath = path.join(scriptDirectory, relativePath);
    hash.update(`${relativePath}\0`, 'utf8');
    hash.update(fs.readFileSync(sourcePath));
    hash.update('\0', 'utf8');
  }
  return `sha256:${hash.digest('hex')}`;
}

export const CONTROL_PLANE_SOURCE_FILES = Object.freeze([...SOURCE_FILES]);
