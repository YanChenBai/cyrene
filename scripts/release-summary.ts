export type Release = {
  name: string;
  type: 'major' | 'minor' | 'patch' | 'none';
  oldVersion: string;
  newVersion: string;
  changesets: string[];
};

export type ChangesetStatus = {
  releases: Release[];
  changesets: { id: string; summary: string }[];
};

export function formatChangesetSummaries(status: ChangesetStatus, releases: Release[]) {
  const ids = new Set(releases.flatMap(release => release.changesets));

  return status.changesets
    .filter(changeset => ids.has(changeset.id) && changeset.summary.trim())
    .map(changeset => {
      const packages = releases
        .filter(release => release.changesets.includes(changeset.id))
        .map(release => `\`${release.name}\``)
        .join(', ');

      return `**${packages}**\n\n${changeset.summary.trim()}`;
    })
    .join('\n\n');
}

function isClosingFence(marker: string, fence: string) {
  return marker[0] === fence[0] && marker.length >= fence.length;
}

export function readVersionChangelog(changelog: string, version: string) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];
  let active = false;
  let fence: string | undefined;

  for (const line of lines) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];

    if (marker) {
      if (!fence) {
        fence = marker;
      } else if (isClosingFence(marker, fence)) {
        fence = undefined;
      }
    } else if (!fence && line.startsWith('## ')) {
      if (active) {
        break;
      }

      active = line.trim() === `## ${version}`;
      continue;
    }

    if (active) {
      result.push(line);
    }
  }

  if (!active) {
    throw new Error(`Missing changelog entry for ${version}.`);
  }

  return result.join('\n').trim();
}
