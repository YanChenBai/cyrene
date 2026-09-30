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
}) {
  const { packages, changes, compareUrl, contributors = [] } = options;

  const rows = packages.map(pkg => {
    const link = `[\`${pkg.name}\`](https://www.npmjs.com/package/${pkg.name})`;

    return `| ${link} | ${pkg.oldVersion ? `\`${pkg.oldVersion}\` → ` : ''}\`${pkg.version}\` |`;
  });

  const sections = [
    `### Highlights\n\n${changes.trim() || 'Dependency updates only.'}`,
    `### Packages\n\n| Package | Version |\n| --- | --- |\n${rows.join('\n')}`,
    `### Upgrade\n\n\`\`\`sh\nnpm install ${packages.map(pkg => `${pkg.name}@${pkg.version}`).join(' ')}\n\`\`\``,
  ];

  if (contributors.length) {
    sections.push(`### Contributors\n\n${contributors.join(', ')}`);
  }

  sections.push(`**Full Changelog**: [Compare changes](${compareUrl})`);

  sections.push(
    '---\n\nAfter merging this PR, manually run the Release workflow on main to publish.',
  );

  return `${sections.join('\n\n')}\n`;
}
