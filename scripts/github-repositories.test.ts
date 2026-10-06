import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCandidate,
  extractMetadata,
  listRepositories,
  mergeCandidates,
  parseArguments,
  planRepositories,
  resolveGitHubToken,
  readRepositoryMetadata,
  matchesRepositoryName,
  type Repository,
} from './github-repositories';

const repo: Repository = {
  name: 'ds-example',
  full_name: 'cssh/ds-example',
  owner: { login: 'CSSH' },
  html_url: 'https://github.com/cssh/ds-example',
  description: 'A study of printed newspapers.',
  topics: ['newspapers', 'history'],
  private: true,
  default_branch: 'main',
};

test('GitHub CLI authentication is used unless an explicit token is provided', () => {
  assert.equal(
    resolveGitHubToken(' environment-token ', () => 'cli-token'),
    'environment-token',
  );
  assert.equal(
    resolveGitHubToken(undefined, () => ' cli-token\n'),
    'cli-token',
  );
  assert.throws(
    () => resolveGitHubToken(undefined, () => ''),
    /gh auth login|GITHUB_TOKEN/i,
  );
  let thrown: unknown;
  try {
    resolveGitHubToken(undefined, () => {
      throw new Error('gh unavailable');
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error);
  assert.match(thrown.message, /gh auth login|GITHUB_TOKEN/i);
  assert.ok(thrown.cause instanceof Error);
  assert.match(thrown.cause.message, /gh unavailable/);
});

test('CLI requires an account and derives a lowercase namespace unless overridden', () => {
  assert.throws(() => parseArguments([]), /organisation or username/i);
  assert.deepEqual(parseArguments(['cssh']), {
    account: 'cssh',
    namespace: 'cssh',
    pattern: '^ds[-_].*',
    apply: false,
  });
  assert.equal(
    parseArguments(['cssh', '--namespace', 'culturalheritagenus']).namespace,
    'culturalheritagenus',
  );
  assert.throws(
    () => parseArguments(['cssh', '--namespace', '../bad']),
    /namespace/i,
  );
});

test('repository planning skips existing entries and reports slug conflicts', () => {
  const existing = buildCandidate(repo, 'cssh', {});
  const other = { ...repo, name: 'ds-new', full_name: 'cssh/ds-new' };
  const conflict = {
    ...repo,
    name: 'ds-example',
    owner: { login: 'other' },
    full_name: 'other/ds-example',
  };
  const plan = planRepositories(
    [repo, other, conflict],
    'cssh',
    JSON.stringify([existing]),
  );
  assert.deepEqual(plan.alreadyCatalogued, ['cssh/ds-example']);
  assert.deepEqual(
    plan.repositories.map((item) => item.full_name),
    ['cssh/ds-new'],
  );
  assert.deepEqual(plan.conflicts, [
    {
      repository: 'other/ds-example',
      reason: 'catalogue slug cssh/ds-example belongs to a different source',
    },
  ]);
});

test('repository name pattern is validated and matched locally', () => {
  assert.equal(matchesRepositoryName('ds-example', '^ds[-_].*'), true);
  assert.equal(matchesRepositoryName('ds_example', '^ds[-_].*'), true);
  assert.equal(matchesRepositoryName('other-ds-example', '^ds[-_].*'), false);
  assert.throws(() => matchesRepositoryName('anything', '['), /pattern/i);
});

test('private repository candidate contains only metadata and a safe landing link', () => {
  const candidate = buildCandidate(repo, 'culturalheritagenus', {
    title: 'Newspaper corpus',
    description: 'A study of printed newspapers.',
    keywords: ['newspapers', 'history'],
  });
  assert.deepEqual(candidate, {
    slug: 'ds-example',
    namespace: 'culturalheritagenus',
    name: 'Newspaper corpus',
    description: 'A study of printed newspapers.',
    keywords: ['newspapers', 'history'],
    draft: true,
    access: 'restricted',
    sources: [
      {
        title: 'GitHub repository (sign in for access)',
        path: 'https://github.com/cssh/ds-example',
        access: 'restricted',
      },
    ],
  });
  assert.equal('file' in candidate, false);
  assert.equal('resources' in candidate, false);
});

test('metadata.yaml supplies title, description and keyword-list metadata', () => {
  const metadata = extractMetadata(
    { ...repo, description: null, topics: [] },
    {
      'metadata.yaml': [
        'title: East Java Newspaper Corpus',
        'description: >-',
        '  Annotated newspaper pages for the article reconstruction study.',
        'keywords:',
        '  - newspapers',
        '  - article reconstruction',
      ].join('\n'),
    },
  );
  assert.equal(metadata.title, 'East Java Newspaper Corpus');
  assert.equal(
    metadata.description,
    'Annotated newspaper pages for the article reconstruction study.',
  );
  assert.deepEqual(metadata.keywords, ['newspapers', 'article reconstruction']);
});

test('metadata.json supplies catalogue name, description and keywords', () => {
  const metadata = extractMetadata(
    { ...repo, description: null, topics: [] },
    {
      'metadata.json': JSON.stringify({
        name: 'Jawi transcription subset',
        description: 'Annotated Jawi pages for transcription research.',
        keywords: ['jawi', 'transcription'],
      }),
    },
  );
  assert.deepEqual(metadata, {
    title: 'Jawi transcription subset',
    description: 'Annotated Jawi pages for transcription research.',
    keywords: ['jawi', 'transcription'],
  });
});

test('metadata.json carries declared lineage into a draft, without inventing parents', () => {
  const metadata = extractMetadata(repo, {
    'metadata.json': JSON.stringify({
      name: 'Annotated subset',
      derivedFrom: [{ namespace: 'cssh', slug: 'source-pages' }],
    }),
  });
  assert.deepEqual(metadata.derivedFrom, [{ namespace: 'cssh', slug: 'source-pages' }]);
  const candidate = buildCandidate(repo, 'cssh', metadata);
  assert.equal(candidate.draft, true);
  assert.deepEqual(candidate.derivedFrom, metadata.derivedFrom);
  const noKnownParents = buildCandidate(repo, 'cssh', extractMetadata(repo, {
    'metadata.json': JSON.stringify({ derivedFrom: [] }),
  }));
  assert.deepEqual(noKnownParents.derivedFrom, []);
  assert.equal('derivedFrom' in buildCandidate(repo, 'cssh', {}), false);
});

test('invalid metadata.json lineage cannot enter draft candidates', () => {
  for (const lineage of [
    { role: 'unknown' },
    { role: 'derived' },
    { role: 'master' },
    { derivedFrom: null },
    { derivedFrom: [{ namespace: '', slug: 'source-pages' }] },
    { derivedFrom: [{ namespace: 'cssh', slug: 'source-pages', path: 'private' }] },
    { derivedFrom: [{ namespace: 'cssh', slug: 'source-pages' }, { namespace: 'cssh', slug: 'source-pages' }] },
  ]) {
    assert.throws(() => extractMetadata(repo, {
      'metadata.json': JSON.stringify(lineage),
    }), /role|derivedFrom|parent/i);
  }
});

test('catalogue merge refuses unknown lineage parents instead of writing a broken manifest', () => {
  const draft = buildCandidate(repo, 'cssh', {
    title: 'Annotated subset',
    derivedFrom: [{ namespace: 'cssh', slug: 'source-pages' }],
  });
  assert.throws(() => mergeCandidates('[]', [draft]), /unknown parent/i);
  const parent = { slug: 'source-pages', namespace: 'cssh', name: 'Source pages' };
  const merged = JSON.parse(mergeCandidates(JSON.stringify([parent]), [draft]));
  assert.deepEqual(merged[1].derivedFrom, [{ namespace: 'cssh', slug: 'source-pages' }]);
});

test('metadata.json takes precedence but datapackage.json remains a fallback', () => {
  const metadata = extractMetadata(repo, {
    'metadata.json': JSON.stringify({ name: 'Repository title' }),
    'datapackage.json': JSON.stringify({
      title: 'Package title',
      description: 'Package description',
      keywords: ['package keyword'],
    }),
  });
  assert.equal(metadata.title, 'Repository title');
  assert.equal(metadata.description, 'Package description');
  assert.deepEqual(metadata.keywords, ['package keyword']);
  assert.equal(
    extractMetadata(repo, {
      'metadata.json': '{invalid',
      'datapackage.json': JSON.stringify({ title: 'Package title' }),
    }).title,
    'Package title',
  );
});

test('invalid metadata.json keywords fall back to valid datapackage keywords', () => {
  const metadata = extractMetadata(
    { ...repo, topics: ['repository keyword'] },
    {
      'metadata.json': JSON.stringify({ keywords: ['https://private.example/file.csv'] }),
      'datapackage.json': JSON.stringify({ keywords: ['package keyword'] }),
    },
  );
  assert.deepEqual(metadata.keywords, ['package keyword']);
});

test('repository metadata reader fetches metadata.json without dropping datapackage.json', async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    const file = url.includes('/contents/metadata.json')
      ? { name: 'Repository title' }
      : url.includes('/contents/datapackage.json')
        ? { description: 'Package description' }
        : undefined;
    return file
      ? new Response(JSON.stringify({ content: Buffer.from(JSON.stringify(file)).toString('base64'), encoding: 'base64' }))
      : new Response('', { status: 404 });
  };
  try {
    const metadata = await readRepositoryMetadata('cssh', repo, 'test-token');
    assert.equal(metadata.title, 'Repository title');
    assert.equal(metadata.description, 'Package description');
    assert.ok(requested.some((url) => url.includes('/contents/metadata.json')));
    assert.ok(requested.some((url) => url.includes('/contents/datapackage.json')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('README and structured metadata are used conservatively', () => {
  const metadata = extractMetadata(repo, {
    'datapackage.json': JSON.stringify({
      title: 'Curated title',
      keywords: [
        'oral history',
        'https://private.example/file.csv',
        'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      ],
    }),
    'README.md':
      '# README title\n\nThis project documents historical newspaper material for scholarly study.\n\nSee https://private.example/private.csv',
  });
  assert.equal(metadata.title, 'Curated title');
  assert.equal(metadata.description, 'A study of printed newspapers.');
  assert.deepEqual(metadata.keywords, ['oral history']);
  assert.equal(
    extractMetadata(
      { ...repo, description: null },
      {
        'README.md':
          '# Sensitive\n\nUse this file at github.com/cssh/ds-example/blob/main/private.csv for data.',
      },
    ).description,
    undefined,
  );
  const fromReadme = extractMetadata(
    { ...repo, description: null, topics: [] },
    {
      'README.md':
        '# README title\n\nThis project documents historical newspaper material for scholarly study.\n\nSee https://private.example/private.csv',
    },
  );
  assert.equal(fromReadme.title, 'README title');
  assert.equal(
    fromReadme.description,
    'This project documents historical newspaper material for scholarly study.',
  );
});

test('repository listing follows GitHub pagination and rejects incomplete full pages', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/users/cssh'))
      return new Response(JSON.stringify({ type: 'Organization' }), {
        status: 200,
      });
    const page = new URL(url).searchParams.get('page');
    const data =
      page === '2'
        ? [{ ...repo, name: 'ds-last' }]
        : Array.from({ length: 100 }, (_, index) => ({
            ...repo,
            name: `ds-${index}`,
          }));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers:
        page === '2'
          ? {}
          : {
              link: '<https://api.github.com/orgs/cssh/repos?type=all&per_page=100&page=2>; rel="next"',
            },
    });
  };
  try {
    const repositories = await listRepositories('cssh', 'test-token');
    assert.equal(repositories.length, 101);
    assert.equal(requests.length, 3);
    assert.ok(
      requests.every((url) => url.startsWith('https://api.github.com/')),
    );
    assert.ok(requests[1].includes('/orgs/cssh/repos'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public candidate defaults metadata to human-review placeholders', () => {
  const candidate = buildCandidate({ ...repo, private: false }, 'cssh', {});
  assert.equal(candidate.name, 'ds-example');
  assert.equal(candidate.description, undefined);
  assert.equal(candidate.keywords, undefined);
  assert.equal(candidate.access, 'public');
  assert.equal(
    buildCandidate({ ...repo, private: undefined }, 'cssh', {}).access,
    'restricted',
  );
});

test('merge is idempotent and refuses source or namespace-slug collisions', () => {
  const candidate = buildCandidate(repo, 'cssh', {});
  const empty = `${JSON.stringify([], null, 2)}\n`;
  const once = mergeCandidates(empty, [candidate]);
  assert.equal(JSON.parse(mergeCandidates(once, [candidate])).length, 1);
  assert.throws(
    () => mergeCandidates(once, [{ ...candidate, slug: 'different' }]),
    /already exists/i,
  );
  assert.throws(
    () =>
      mergeCandidates(
        JSON.stringify([{ slug: candidate.slug, namespace: 'cssh' }]),
        [candidate],
      ),
    /collision/i,
  );
});
