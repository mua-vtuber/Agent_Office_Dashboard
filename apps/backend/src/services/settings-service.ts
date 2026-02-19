import { defaultSettings, type Settings } from "@aod/shared-schema";
import { listSettingsObject } from "../storage/settings-repo";

/**
 * Recursively deep-merge `base` with `overrides`.
 * Arrays in overrides fully replace base arrays.
 */
export function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    const baseVal = result[key];
    const overVal = overrides[key];
    if (
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result;
}

/**
 * Returns the full settings object: defaultSettings deep-merged with user overrides from DB.
 */
export function getMergedSettings(): Settings {
  const overrides = listSettingsObject();
  const base: Record<string, unknown> = { ...defaultSettings } as unknown as Record<string, unknown>;
  return deepMerge(base, overrides) as unknown as Settings;
}
