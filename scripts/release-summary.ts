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
