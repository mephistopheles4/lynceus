/**
 * Thin CLI wrapper over the collector's closed-schema validators (S3/S6). No schema logic lives
 * here: everything is re-exported from `../collector/config.mjs` and bounded file reads go
 * through `fs-safe.mjs`.
 */
import { normalizeConfig } from '../collector/config.mjs';
import { assertStrictCountsOnly } from '../collector/privacy-gate.mjs';
import { readBoundedJsonFile } from './fs-safe.mjs';

export * from '../collector/config.mjs';

export const MAX_CONFIG_BYTES = 65_536;
export const MAX_COUNTS_BYTES = 1_048_576;

/**
 * Read + validate a `lynceus.json` file. Throws FsSafeError (exit 5) / ValidationError (exit 2).
 * @param {string} configPath
 * @param {{ allowEmptyAgents?: boolean, fsOps?: object }} [opts]
 */
export function loadConfigFile(configPath, { allowEmptyAgents = false, fsOps } = {}) {
  const raw = readBoundedJsonFile(configPath, MAX_CONFIG_BYTES, { fsOps });
  return normalizeConfig(raw, { allowEmptyAgents });
}

/**
 * Read + strictly validate a `counts.json` file. Throws FsSafeError (exit 5) /
 * ValidationError or PrivacyGateError (exit 2).
 * @param {string} countsPath
 * @param {{ fsOps?: object }} [opts]
 */
export function loadCountsFile(countsPath, { fsOps } = {}) {
  const raw = readBoundedJsonFile(countsPath, MAX_COUNTS_BYTES, { fsOps });
  return assertStrictCountsOnly(raw);
}
