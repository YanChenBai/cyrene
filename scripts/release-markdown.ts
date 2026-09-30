export type ReleasePackage = {
  name: string;
  version: string;
  oldVersion?: string;
};

export function formatReleaseMarkdown(options: {
  packages: ReleasePackage[];
  changes: string;
  compareUrl: string;
  contributors?: string[];
  commits?: string;
  isPullRequest?: boolean;
}) {
  const { packages, changes, compareUrl, contributors = [], commits, isPullRequest } = options;

  const rows = packages.map(pkg => {
    const link = `[\`${pkg.name}\`](https://www.npmjs.com/package/${pkg.name})`;

    return `| ${link} | ${pkg.oldVersion ? `\`${pkg.oldVersion}\` → ` : ''}\`${pkg.version}\` |`;
  });

  const sections = [
    `### Highlights\n\n${changes.trim() || 'Dependency updates only.'}`,
    `### ${isPullRequest ? 'Packages' : 'Published Packages'}\n\n| Package | Version |\n| --- | --- |\n${rows.join('\n')}`,
    `### Upgrade\n\n\`\`\`sh\nnpm install ${packages.map(pkg => `${pkg.name}@${pkg.version}`).join(' ')}\n\`\`\``,
  ];

  if (commits) {
    sections.push(`<details>\n<summary>Commit details</summary>\n\n${commits}\n\n</details>`);
  }

  if (contributors.length) {
    sections.push(`### Contributors\n\n${contributors.join(', ')}`);
  }

  sections.push(`**Full Changelog**: [Compare changes](${compareUrl})`);

  if (isPullRequest) {
    sections.push('---\n\nMerging this PR will trigger the release workflow.');
  }

  return `${sections.join('\n\n')}\n`;
}
