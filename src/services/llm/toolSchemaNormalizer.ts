import type { ProviderId } from '../../types';
import type { LlmToolDefinition } from './types';

const STRICT_OBJECT_PROVIDERS = new Set<ProviderId>([
  'gemini',
  'groq',
  'nvidia',
  'cloudflare',
  'modelscope',
  'amd',
]);

const STRIPPED_KEYS_BY_STRICT = new Set([
  '$schema',
  '$id',
  '$comment',
  'examples',
  'default',
  'additionalProperties',
  'propertyNames',
  'patternProperties',
]);

function pickConcreteSchemaBranch(branches: unknown[]): Record<string, unknown> | null {
  for (const branch of branches) {
    if (!branch || typeof branch !== 'object' || Array.isArray(branch)) continue;
    const obj = branch as Record<string, unknown>;
    if (obj.type === 'null') continue;
    return obj;
  }
  return null;
}

function normalizeNode(
  node: unknown,
  provider: ProviderId,
  isRoot = false
): Record<string, unknown> {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return isRoot ? { type: 'object', properties: {} } : { type: 'string' };
  }

  const strict = STRICT_OBJECT_PROVIDERS.has(provider);
  const raw = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // Flatten union schemas (anyOf / oneOf) for strict endpoints
  const unionRaw = Array.isArray(raw.anyOf)
    ? raw.anyOf
    : Array.isArray(raw.oneOf)
      ? raw.oneOf
      : null;

  if (unionRaw) {
    const picked = pickConcreteSchemaBranch(unionRaw);
    if (picked) {
      const merged = normalizeNode(
        {
          ...picked,
          ...(typeof raw.description === 'string' && !picked.description
            ? { description: raw.description }
            : {}),
        },
        provider,
        isRoot
      );
      return merged;
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (strict && STRIPPED_KEYS_BY_STRICT.has(key)) {
      continue;
    }
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      continue;
    }

    if (key === 'type') {
      if (Array.isArray(value)) {
        const nonNull = value.find((t): t is string => typeof t === 'string' && t !== 'null');
        out.type = nonNull ?? 'string';
      } else if (typeof value === 'string') {
        out.type = value;
      }
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        props[propKey] = normalizeNode(propVal, provider, false);
      }
      out.properties = props;
      continue;
    }

    if (key === 'items') {
      if (Array.isArray(value)) {
        out.items = normalizeNode(value[0], provider, false);
      } else if (value && typeof value === 'object') {
        out.items = normalizeNode(value, provider, false);
      }
      continue;
    }

    if (key === 'enum' && Array.isArray(value)) {
      const sanitizedEnum = value.filter((item) => item !== null && item !== undefined);
      if (sanitizedEnum.length > 0) {
        out.enum = sanitizedEnum;
      }
      continue;
    }

    out[key] = value;
  }

  // Handle allOf object merging cleanly
  if (Array.isArray(raw.allOf)) {
    const mergedProps: Record<string, unknown> =
      out.properties && typeof out.properties === 'object'
        ? { ...(out.properties as Record<string, unknown>) }
        : {};
    const mergedRequired = new Set<string>(
      Array.isArray(raw.required)
        ? raw.required.filter((r): r is string => typeof r === 'string')
        : []
    );

    for (const part of raw.allOf) {
      const normalizedPart = normalizeNode(part, provider, false);
      if (
        normalizedPart.properties &&
        typeof normalizedPart.properties === 'object' &&
        !Array.isArray(normalizedPart.properties)
      ) {
        Object.assign(mergedProps, normalizedPart.properties);
      }
      if (Array.isArray(normalizedPart.required)) {
        for (const reqKey of normalizedPart.required) {
          if (typeof reqKey === 'string') mergedRequired.add(reqKey);
        }
      }
    }
    if (Object.keys(mergedProps).length > 0) {
      out.properties = mergedProps;
      out.type = out.type ?? 'object';
    }
    if (mergedRequired.size > 0) {
      out.required = Array.from(mergedRequired);
    }
  }

  if (!out.type) {
    if (out.properties) out.type = 'object';
    else if (out.items) out.type = 'array';
    else if (out.enum) out.type = 'string';
    else out.type = isRoot ? 'object' : 'string';
  }

  if (out.type === 'object') {
    const propsObj =
      out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)
        ? (out.properties as Record<string, unknown>)
        : {};
    const propKeys = Object.keys(propsObj);

    if (propKeys.length === 0) {
      if (provider === 'gemini') {
        out.properties = {
          _placeholder: { type: 'string', description: 'Optional unused parameter' },
        };
      } else {
        out.properties = {};
      }
      delete out.required;
    } else {
      out.properties = propsObj;
      if (Array.isArray(out.required)) {
        const propSet = new Set(propKeys);
        const validRequired = out.required.filter(
          (k): k is string => typeof k === 'string' && propSet.has(k)
        );
        if (validRequired.length > 0) {
          out.required = Array.from(new Set(validRequired));
        } else {
          delete out.required;
        }
      }
    }
  }

  if (out.type === 'array' && !out.items) {
    out.items = { type: 'string' };
  }

  return out;
}

/**
 * Normalizes a JSON Schema object for a specific LLM provider endpoint.
 * Strips unsupported draft keywords ($schema, additionalProperties, default),
 * flattens nullable/union types, and prunes dangling `required` entries.
 */
export function normalizeToolSchemaForProvider(
  schema: Record<string, unknown> | undefined | null,
  provider: ProviderId
): Record<string, unknown> {
  return normalizeNode(schema ?? { type: 'object', properties: {} }, provider, true);
}

export function normalizeToolsForProvider(
  tools: LlmToolDefinition[],
  provider: ProviderId
): LlmToolDefinition[] {
  return tools.map((tool) => ({
    ...tool,
    parameters: normalizeToolSchemaForProvider(tool.parameters, provider),
  }));
}
