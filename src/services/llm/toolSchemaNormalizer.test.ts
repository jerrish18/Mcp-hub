import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolSchemaForProvider, normalizeToolsForProvider } from './toolSchemaNormalizer';

test('normalizeToolSchemaForProvider strips strict keywords and prunes dangling required keys', () => {
  const raw = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties: {
      path: {
        type: ['string', 'null'],
        default: 'index.html',
        examples: ['src/app.ts'],
      },
      options: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              dryRun: { type: 'boolean', default: false },
            },
            required: ['dryRun', 'missingKey'],
          },
        ],
      },
    },
    required: ['path', 'nonexistent'],
  };

  const geminiNormalized = normalizeToolSchemaForProvider(raw, 'gemini');
  assert.equal(geminiNormalized.$schema, undefined);
  assert.equal(geminiNormalized.additionalProperties, undefined);
  assert.deepEqual(geminiNormalized.required, ['path']);

  const props = geminiNormalized.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.path.type, 'string');
  assert.equal(props.path.default, undefined);
  assert.equal(props.options.type, 'object');
  assert.deepEqual(props.options.required, ['dryRun']);
});

test('normalizeToolSchemaForProvider injects _placeholder for empty object on gemini only', () => {
  const emptyObj = { type: 'object', properties: {}, required: ['ghost'] };
  const gemini = normalizeToolSchemaForProvider(emptyObj, 'gemini');
  const nvidia = normalizeToolSchemaForProvider(emptyObj, 'nvidia');

  assert.ok((gemini.properties as Record<string, unknown>)._placeholder);
  assert.equal(gemini.required, undefined);
  assert.deepEqual(nvidia.properties, {});
  assert.equal(nvidia.required, undefined);
});

test('normalizeToolsForProvider handles allOf merging cleanly', () => {
  const normalized = normalizeToolsForProvider(
    [
      {
        qualifiedName: 'srv__patch',
        originalName: 'patch',
        serverId: 'srv',
        serverName: 'Srv',
        description: 'Patch file',
        isReadOnly: false,
        isDestructive: false,
        parameters: {
          allOf: [
            { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            { type: 'object', properties: { search: { type: 'string' } }, required: ['search'] },
          ],
        },
      },
    ],
    'groq'
  );

  const schema = normalized[0].parameters;
  assert.equal(schema.type, 'object');
  assert.deepEqual(Object.keys(schema.properties as Record<string, unknown>), ['path', 'search']);
  assert.deepEqual(schema.required, ['path', 'search']);
});
