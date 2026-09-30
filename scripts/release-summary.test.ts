import assert from 'node:assert/strict';

import { test } from 'vite-plus/test';

import { formatReleaseMarkdown } from './release-markdown.ts';
import { formatChangesetSummaries, readVersionChangelog } from './release-summary.ts';

test('keeps a shared multiline summary once, scoped to the released packages', () => {
  const releases = ['cyrenex', '@cyrenex/elysia'].map(name => ({
    name,
    type: 'major' as const,
    oldVersion: '0.0.0',
    newVersion: '1.0.0-beta.0',
    changesets: ['shared'],
  }));

  const summary = 'New API.\n\n```ts\nconst value = 1;\n```\n\n- Migration step';

  const changes = formatChangesetSummaries(
    {
      releases,
      changesets: [
        { id: 'shared', summary },
        { id: 'old', summary: 'Already released' },
      ],
    },
    releases,
  );

  assert.equal(changes, `**\`cyrenex\`, \`@cyrenex/elysia\`**\n\n${summary}`);
});

test('extracts exactly the requested version without truncating fenced Markdown', () => {
  const entry = '### Major Changes\n\n- New API\n\n```md\n## Example heading\n```';
  const changelog = `# cyrenex\n\n## 1.0.0\n\nFuture\n\n## 1.0.0-beta.0\n\n${entry}\n\n## 0.0.3\n\nOld`;

  assert.equal(readVersionChangelog(changelog, '1.0.0-beta.0'), entry);
  assert.throws(() => readVersionChangelog(changelog, '2.0.0'), /Missing changelog/);
});

test('shares package tables and upgrade commands, with a PR-only merge notice', () => {
  const options = {
    packages: [{ name: 'cyrenex', version: '1.0.0-beta.0', oldVersion: '0.0.3' }],
    changes: 'Human-written summary.\n\nMigration instructions.',
    compareUrl: 'https://github.com/YanChenBai/cyrene/compare/master...release',
    commits: '### Features\n\n- Commit detail',
    contributors: ['@YanChenBai'],
  };

  const pr = formatReleaseMarkdown({ ...options, isPullRequest: true });
  const release = formatReleaseMarkdown(options);

  assert.match(pr, /Human-written summary\.\n\nMigration instructions/);
  assert.match(pr, /`0.0.3` → `1.0.0-beta.0`/);
  assert.match(pr, /npm install cyrenex@1.0.0-beta.0/);
  assert.match(pr, /Merging this PR/);
  assert.match(release, /<summary>Commit details<\/summary>/);
  assert.doesNotMatch(release, /Merging this PR/);
});
