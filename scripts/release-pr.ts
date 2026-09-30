import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatReleaseMarkdown } from './release-markdown.ts';
import { formatChangesetSummaries, type ChangesetStatus, type Release } from './release-summary.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const repository = 'YanChenBai/cyrene';
const baseBranch = 'main';
const primaryPackage = 'cyrenex';

type PackageInfo = {
  name: string;
  directory: string;
  private?: boolean;
};

const git = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim();

const gh = (...args: string[]) =>
  execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim();

const vp = (...args: string[]) =>
  execFileSync('vp', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim();

function readChangesetStatus(): ChangesetStatus {
  const directory = mkdtempSync(join(tmpdir(), 'cyrene-release-'));
  const path = join(directory, 'status.json');

  try {
    vp('exec', 'changeset', 'status', '--output', path);

    return JSON.parse(readFileSync(path, 'utf8')) as ChangesetStatus;
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
}

function readPackages(): PackageInfo[] {
  return readdirSync(join(root, 'packages'), {
    withFileTypes: true,
  })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const directory = `packages/${entry.name}`;

      const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')) as {
        name: string;
        private?: boolean;
      };

      return {
        name: manifest.name,
        private: manifest.private,
        directory,
      };
    });
}

function findPreviousTag(packageName: string) {
  const patterns = [`${packageName}@*`];

  if (packageName === primaryPackage) {
    patterns.push('v[0-9]*');
  }

  for (const pattern of patterns) {
    const tag = git('tag', '--merged', 'HEAD', '--sort=-version:refname', '--list', pattern)
      .split('\n')
      .find(Boolean);

    if (tag) {
      return tag;
    }
  }

  return undefined;
}

function commitShasForPackage(pkg: PackageInfo) {
  const previousTag = findPreviousTag(pkg.name);
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';

  const output = git('log', '--no-merges', '--format=%H', range, '--', pkg.directory);

  return output ? output.split('\n').filter(Boolean) : [];
}

function resolveContributor(sha: string) {
  try {
    const login = gh('api', `repos/${repository}/commits/${sha}`, '--jq', '.author.login // empty');

    if (login) {
      return `@${login}`;
    }
  } catch {
    // Commit may not be associated with a GitHub account.
  }

  const name = git('show', '-s', '--format=%aN', sha);

  return name || undefined;
}

function readContributors(releases: Release[], packages: PackageInfo[]) {
  const commits = new Set<string>();

  for (const release of releases) {
    const pkg = packages.find(item => item.name === release.name);

    if (!pkg) {
      continue;
    }

    for (const sha of commitShasForPackage(pkg)) {
      commits.add(sha);
    }
  }

  const contributors = new Set<string>();

  for (const sha of commits) {
    const contributor = resolveContributor(sha);

    if (!contributor) {
      continue;
    }

    if (contributor.endsWith('[bot]') || contributor === '@github-actions') {
      continue;
    }

    contributors.add(contributor);
  }

  return [...contributors].sort((a, b) => a.localeCompare(b));
}

function createTitle(releases: Release[]) {
  const versions = new Set(releases.map(release => release.newVersion));

  if (versions.size === 1) {
    const [version] = versions;
    const packages = releases.map(release => release.name).join(', ');

    return `chore(release): prepare ${packages} v${version}`;
  }

  const packages = releases.map(release => `${release.name}@${release.newVersion}`).join(', ');

  return `chore(release): prepare ${packages}`;
}

function createCompareUrl(previousTag: string, branch: string) {
  const base = encodeURIComponent(previousTag);
  const head = encodeURIComponent(branch);

  return `https://github.com/${repository}/compare/${base}...${head}`;
}

function createBody(
  status: ChangesetStatus,
  releases: Release[],
  contributors: string[],
  branch: string,
) {
  const previousTag = findPreviousTag(primaryPackage);

  return formatReleaseMarkdown({
    packages: releases.map(release => ({
      name: release.name,
      version: release.newVersion,
      oldVersion: release.oldVersion,
    })),
    changes: formatChangesetSummaries(status, releases),
    compareUrl: createCompareUrl(previousTag ?? baseBranch, branch),
    contributors,
    isPullRequest: true,
  });
}

function findExistingPullRequest(branch: string) {
  const result = gh(
    'pr',
    'list',
    '--base',
    baseBranch,
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  );

  return result ? Number(result) : undefined;
}

function ensureBranchPushed(branch: string) {
  const remote = git('ls-remote', '--heads', 'origin', branch);

  if (!remote) {
    throw new Error(`Branch "${branch}" has not been pushed to origin.`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const preview = args.includes('--dry-run');
  const prIndex = args.indexOf('--pr');
  const pullRequest = prIndex >= 0 ? args[prIndex + 1] : undefined;
  const statusIndex = args.indexOf('--status');
  const statusPath = statusIndex >= 0 ? args[statusIndex + 1] : undefined;

  const branch = pullRequest
    ? gh(
        'pr',
        'view',
        pullRequest,
        '--repo',
        repository,
        '--json',
        'headRefName',
        '--jq',
        '.headRefName',
      )
    : git('branch', '--show-current');

  if (!branch || branch === baseBranch) {
    throw new Error(`Release PR requires a non-${baseBranch} branch.`);
  }

  const status: ChangesetStatus = statusPath
    ? JSON.parse(readFileSync(statusPath, 'utf8'))
    : readChangesetStatus();

  const packages = readPackages();

  const releases = status.releases.filter(
    release =>
      release.type !== 'none' && packages.some(pkg => pkg.name === release.name && !pkg.private),
  );

  if (!releases.length) {
    throw new Error('No public packages are scheduled for release.');
  }

  const contributors = preview ? [] : readContributors(releases, packages);
  const title = createTitle(releases);
  const body = createBody(status, releases, contributors, branch);

  if (preview) {
    process.stdout.write(body);

    return;
  }

  ensureBranchPushed(branch);

  const existing = pullRequest ?? findExistingPullRequest(branch);
  const directory = mkdtempSync(join(tmpdir(), 'cyrene-release-pr-'));
  const bodyPath = join(directory, 'body.md');

  try {
    writeFileSync(bodyPath, body);

    const command = existing
      ? ['pr', 'edit', String(existing)]
      : ['pr', 'create', '--base', baseBranch, '--head', branch];

    execFileSync(
      'gh',
      [...command, '--repo', repository, '--title', title, '--body-file', bodyPath],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
