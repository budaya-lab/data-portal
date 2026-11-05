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

test('accepts ground-truth packages and preserves subject keywords and resources', () => {
  const keywords = ['fieldwork', 'stage:ground-truth'];
  const metadata = parseDataPackage(JSON.stringify({ ...descriptor, keywords }));
  assert.deepEqual(metadata.keywords, keywords);
  assert.deepEqual(metadata.resources, descriptor.resources);
});

test('rejects duplicate, mixed, or miscapitalized ground-truth stages', () => {
  for (const keywords of [
    ['stage:ground-truth', 'stage:ground-truth'],
    ['stage:ground-truth', 'stage:annotated'],
    ['stage:Ground-truth'],
  ]) {
    assert.throws(
      () => parseDataPackage(JSON.stringify({ ...descriptor, keywords })),
      /Invalid datapackage\.json stage keyword/,
    );
  }
});

test('accepts valid public-safe optional fields without inventing dates or sources', () => {
  const metadata = parseDataPackage(JSON.stringify(descriptor));
  assert.equal(metadata.created, undefined);
  assert.equal(metadata.licenses, undefined);
  assert.equal('contributors' in metadata, false);
});
