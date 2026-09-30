import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DatasetPage from '../pages/[owner]/[slug]'
import { datasetHref, matchesCatalogQuery, isRestricted, validateCatalogAccess, publishedDatasets } from '../lib/datasets'
import type { Dataset } from '../lib/datasets'
import { StaticProvider } from '../lib/providers/static-provider'
import { toDCAT } from '../lib/metadata/dcat'

const tagged: Dataset = {
  slug: 'oral-history',
  namespace: 'humanities',
  name: 'Interviews',
  description: 'Recorded conversations',
  keywords: ['Oral History', 'fieldwork'],
}

test('catalog search finds Frictionless keywords without searching source data', () => {
  assert.equal(matchesCatalogQuery(tagged, 'oral history'), true)
  assert.equal(matchesCatalogQuery(tagged, 'FIELDWORK'), true)
  assert.equal(matchesCatalogQuery(tagged, 'interviews'), true)
  assert.equal(matchesCatalogQuery(tagged, 'humanities'), true)
  assert.equal(matchesCatalogQuery(tagged, 'recorded'), true)
  assert.equal(matchesCatalogQuery(tagged, 'nothing'), false)
  assert.equal(matchesCatalogQuery({ ...tagged, keywords: [] }, 'oral history'), false)
})

test('draft datasets are hidden from static provider outside development', async () => {
  const records: Dataset[] = [
    { ...tagged, slug: 'published' },
    { ...tagged, slug: 'draft-record', draft: true },
  ]
  const provider = new StaticProvider(records, 'production')
  assert.deepEqual((await provider.listDatasets()).map((d) => d.slug), ['published'])
  assert.equal(await provider.getDataset(tagged.namespace, 'draft-record'), null)
  assert.deepEqual((await provider.search({ q: 'interviews' })).map((d) => d.slug), ['published'])
})

test('draft datasets are available to the development provider', async () => {
  const provider = new StaticProvider([{ ...tagged, draft: true }], 'development')
  assert.equal((await provider.listDatasets()).length, 1)
  assert.ok(await provider.getDataset(tagged.namespace, tagged.slug))
})

test('published feed selection excludes drafts regardless of environment', () => {
  const records: Dataset[] = [
    { ...tagged, slug: 'published' },
    { ...tagged, slug: 'draft-record', draft: true },
  ]
  assert.deepEqual(publishedDatasets(records).map((d) => d.slug), ['published'])
})

test('catalogue rejects invalid draft values', () => {
  assert.throws(
    () => validateCatalogAccess([{ ...tagged, draft: 'true' } as unknown as Dataset]),
    /invalid draft/i,
  )
})

test('static provider searches manifest keywords as well as catalog metadata', async () => {
  const provider = new StaticProvider()
  const matches = await provider.search({ q: 'geospatial' })
  assert.ok(matches.some((d) => d.slug === 'world-boundaries'))
  assert.ok(matches.every((d) => matchesCatalogQuery(d, 'geospatial')))
})

test('private research repository is listed as a metadata-only restricted dataset', async () => {
  const provider = new StaticProvider()
  const dataset = await provider.getDataset('culturalheritagenus', 'ds-article-20260902')
  assert.ok(dataset)
  assert.equal(datasetHref(dataset), '/@culturalheritagenus/ds-article-20260902')
  assert.equal(isRestricted(dataset), true)
  assert.equal(dataset.file, undefined)
  assert.equal(dataset.resources, undefined)
  assert.deepEqual(dataset.sources, [{
    title: 'GitHub repository (sign in for access)',
    path: 'https://github.com/culturalheritagenus/ds_article_20260902',
    access: 'restricted',
  }])
})

test('a restricted source marks its dataset as restricted', () => {
  assert.equal(isRestricted({ ...tagged, sources: [{ title: 'Archive', access: 'restricted' }] }), true)
  assert.equal(isRestricted({ ...tagged, access: 'restricted' }), true)
  assert.equal(isRestricted(tagged), false)
})

test('catalogue rejects unknown access labels rather than treating them as public', () => {
  assert.throws(
    () => validateCatalogAccess([{ ...tagged, access: 'private' } as unknown as Dataset]),
    /invalid access/i,
  )
  assert.throws(
    () => validateCatalogAccess([{ ...tagged, sources: [{ title: 'Archive', access: 'private' }] } as unknown as Dataset]),
    /invalid access/i,
  )
})

test('restricted catalogue records cannot contain downloadable resources', () => {
  const restricted: Dataset = {
    ...tagged,
    access: 'restricted',
    file: 'secret.csv',
    format: 'csv',
    sources: [{ title: 'Archive', path: 'https://archive.example.org/login' }],
  }
  assert.throws(() => validateCatalogAccess([restricted]), /restricted.*resource/i)
  assert.throws(
    () => validateCatalogAccess([{ ...tagged, sources: [{ title: 'Archive', access: 'restricted' }], resources: [{ name: 'data', path: 'https://example.org/secret.csv', format: 'csv' }] }]),
    /restricted.*resource/i,
  )
  assert.doesNotThrow(() => validateCatalogAccess([{ ...restricted, file: undefined }]))
})

test('restricted sources require a safe public landing link, not a credential URL', () => {
  const restricted: Dataset = {
    ...tagged,
    access: 'restricted',
    sources: [{ title: 'Archive', path: 'https://archive.example.org/login' }],
  }
  assert.throws(() => validateCatalogAccess([{ ...restricted, sources: [{ title: 'Archive', path: 'https://user:pass@archive.example.org/login' }] }]), /source link/i)
  assert.throws(() => validateCatalogAccess([{ ...restricted, sources: [{ title: 'Archive', path: 'javascript:alert(1)' }] }]), /source link/i)
  assert.throws(() => validateCatalogAccess([{ ...restricted, sources: [{ title: 'Archive', path: 'https://archive.example.org/login?token=secret' }] }]), /source link/i)
  assert.throws(() => validateCatalogAccess([{ ...restricted, sources: [] }]), /source link/i)
  assert.throws(() => validateCatalogAccess([{ ...tagged, sources: [{ title: 'Bad link', path: 'javascript:alert(1)' }] }]), /source link/i)
  assert.doesNotThrow(() => validateCatalogAccess([restricted]))
})

test('DCAT feed marks restricted source data as restricted public', () => {
  const dataset: Dataset = {
    ...tagged,
    sources: [{ title: 'Archive', path: 'https://archive.example.org/login', access: 'restricted' }],
  }
  const node = toDCAT(dataset)
  assert.equal(node['dct:accessLevel'], 'restricted public')
  assert.equal(node['dcat:distribution'], undefined)
})

test('restricted dataset page shows source access but no preview or download actions', () => {
  const dataset: Dataset = {
    ...tagged,
    access: 'restricted',
    sources: [{ title: 'Protected archive', path: 'https://archive.example.org/login', access: 'restricted' }],
  }
  const resource = { name: 'secret', path: 'https://archive.example.org/secret.csv', format: 'csv' as const }
  const html = renderToStaticMarkup(createElement(DatasetPage, { dataset, resources: [resource], activity: [] }))
  assert.match(html, /Protected archive/)
  assert.match(html, /Restricted/)
  assert.match(html, /https:\/\/archive\.example\.org\/login/)
  assert.doesNotMatch(html, /https:\/\/archive\.example\.org\/secret\.csv/)
  assert.doesNotMatch(html, /Download &amp; API|Download csv|Copy URL|Preview/)
})

test('unmarked existing datasets retain their public resource display', () => {
  const dataset: Dataset = { ...tagged, file: 'data.csv', format: 'csv' }
  const resource = { name: 'data', path: 'data.csv', format: 'csv' as const }
  const html = renderToStaticMarkup(createElement(DatasetPage, { dataset, resources: [resource], activity: [] }))
  assert.match(html, /Download &amp; API/)
  assert.match(html, /\/data\/data\.csv/)
})
