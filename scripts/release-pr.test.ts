import assert from 'node:assert/strict';
import type * as FileSystem from 'node:fs';

import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

const state = vi.hoisted(() => ({ commands: [] as string[], body: '' }));

vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: string[], options?: { input?: string }) => {
    const call = [command, ...args].join(' ');
    state.commands.push(call);

    if (call.startsWith('gh pr view')) {
      return 'changeset-release/main';
    }

    if (options?.input) {
      state.body = options.input;
    }

    return '';
  },
}));

vi.mock('node:fs', async importOriginal => {
  const original = await importOriginal<typeof FileSystem>();

  return {
    ...original,
    readFileSync: (path: string, ...args: unknown[]) => {
      if (path.endsWith('status.json')) {
        return JSON.stringify({
          releases: [
            {
              name: 'cyrenex',
              type: 'major',
              oldVersion: '0.0.0',
              newVersion: '1.0.0-beta.0',
              changesets: ['first'],
            },
            {
              name: '@cyrenex/elysia',
              type: 'patch',
              oldVersion: '0.1.0',
              newVersion: '0.1.1',
              changesets: ['first'],
            },
          ],
          changesets: [{ id: 'first', summary: 'First beta' }],
        });
      }

      return Reflect.apply(original.readFileSync, original, [path, ...args]);
    },
  };
});

import { main } from './release-pr.ts';

beforeEach(() => {
  state.commands = [];
  state.body = '';
});

afterEach(() => vi.restoreAllMocks());

test('edits the PR title and body with each package version without preparing a release', () => {
  main(['--pr', '42', '--status', 'status.json']);
  assert.ok(
    state.commands.includes(
      'gh pr edit 42 --repo YanChenBai/cyrene --title release: cyrenex@1.0.0-beta.0, @cyrenex/elysia@0.1.1 --body-file -',
    ),
  );
  assert.match(state.body, /First beta/);
  assert.match(state.body, /1.0.0-beta.0/);
  assert.ok(
    !state.commands.some(call => /vp |git push|git commit|git add|gh pr create/.test(call)),
  );
});

test('preview does not edit the PR', () => {
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  main(['--pr', '42', '--status', 'status.json', '--dry-run']);
  assert.ok(!state.commands.some(call => call.startsWith('gh pr edit')));
});

test('requires both an explicit PR number and status file', () => {
  assert.throws(() => main([]), /Usage/);
  assert.throws(() => main(['--pr', '--status', 'status.json']), /Usage/);
  assert.throws(() => main(['--pr', '42', '--status']), /Usage/);
  assert.equal(state.commands.length, 0);
});
