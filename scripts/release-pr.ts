import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
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
  });
}

export function main(args = process.argv.slice(2)) {
  const preview = args.includes('--dry-run');
  const pr = args[args.indexOf('--pr') + 1];
  const statusPath = args[args.indexOf('--status') + 1];

  if (
    !args.includes('--pr') ||
    !pr ||
    !/^\d+$/.test(pr) ||
    !args.includes('--status') ||
    !statusPath ||
    statusPath.startsWith('--')
  ) {
    throw new Error('Usage: vp run release-pr --pr <number> --status <file> [--dry-run]');
  }

  const status = JSON.parse(readFileSync(resolve(root, statusPath), 'utf8')) as ChangesetStatus;
  const packages = readPackages();

  const releases = status.releases.filter(
    release =>
      release.type !== 'none' && packages.some(pkg => pkg.name === release.name && !pkg.private),
  );

  if (!releases.length) {
    throw new Error('No public packages are scheduled for release.');
  }

  const branch = gh(
    'pr',
    'view',
    pr,
    '--repo',
    repository,
    '--json',
    'headRefName',
    '--jq',
    '.headRefName',
  );

  const contributors = preview ? [] : readContributors(releases, packages);
  const title = `release: ${releases.map(release => `${release.name}@${release.newVersion}`).join(', ')}`;
  const body = createBody(status, releases, contributors, branch);

  if (preview) {
    process.stdout.write(`${title}\n\n${body}`);

    return;
  }

  execFileSync(
    'gh',
    ['pr', 'edit', pr, '--repo', repository, '--title', title, '--body-file', '-'],
    {
      cwd: root,
      input: body,
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
