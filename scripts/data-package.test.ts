import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDataPackage } from './data-package';

const descriptor = {
  name: 'example-dataset', title: 'Example dataset', keywords: ['stage:master'],
  resources: [{ name: 'records', path: 'tables/records.csv', format: 'csv' }],
};

test('rejects unsafe and malformed Data Packages without exposing private resource names', () => {
  for (const change of [
    { resources: [{ name: 'private', path: '../secret.csv' }] },
    { resources: [{ name: 'private', path: '/internal/secret.csv' }] },
    { resources: [{ name: 'private', path: 'internal/secret.csv', data: ['inline'] }] },
    { keywords: ['stage:unknown'] },
    { title: 'github.com/budaya-lab/ds-example/blob/main/private.csv' },
    { created: '2026-02-30T00:00:00Z' },
    { created: '2000-01-01T00:00:00Z' },
    { licenses: [{ name: 'Private', path: 'https://private.example/internal/secret.csv' }] },
  ]) {
    let error: unknown;
    try { parseDataPackage(JSON.stringify({ ...descriptor, ...change })); } catch (cause) { error = cause; }
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /internal\/secret|secret\.csv|private\.example/);
  }
});

test('accepts valid public-safe optional fields without inventing dates or sources', () => {
  const metadata = parseDataPackage(JSON.stringify(descriptor));
  assert.equal(metadata.created, undefined);
  assert.equal(metadata.licenses, undefined);
  assert.equal('contributors' in metadata, false);
});
