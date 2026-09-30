import assert from 'node:assert/strict';

import { test } from 'vite-plus/test';

import { formatReleaseMarkdown } from './release-markdown.ts';
import { formatChangesetSummaries } from './release-summary.ts';

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

test('formats the release PR with package versions, highlights and upgrade commands', () => {
  const options = {
    packages: [{ name: 'cyrenex', version: '1.0.0-beta.0', oldVersion: '0.0.3' }],
    changes: 'Human-written summary.\n\nMigration instructions.',
    compareUrl: 'https://github.com/YanChenBai/cyrene/compare/master...release',
    contributors: ['@YanChenBai'],
  };

  const pr = formatReleaseMarkdown(options);

  assert.match(pr, /Human-written summary\.\n\nMigration instructions/);
  assert.match(pr, /`0.0.3` → `1.0.0-beta.0`/);
  assert.match(pr, /npm install cyrenex@1.0.0-beta.0/);
  assert.match(pr, /After merging this PR, manually run the Release workflow on main to publish/);
});
