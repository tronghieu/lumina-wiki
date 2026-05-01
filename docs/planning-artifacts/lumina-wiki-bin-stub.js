#!/usr/bin/env node
// lumina-wiki v0.0.1 — name-claim stub.
// The real installer ships in v0.1.0+.

const pkg = {
  name: 'lumina-wiki',
  version: '0.0.1',
  repo: 'https://github.com/tronghieu/lumina-wiki',
};

const cmd = process.argv[2];

const banner = `
  ✨ lumina-wiki v${pkg.version}

  Karpathy's LLM-Wiki vision — domain-agnostic, multi-IDE wiki scaffolder.

  This is a name-claim placeholder. The real installer is on the way.

  Track progress: ${pkg.repo}

  When v0.1.0 lands you'll be able to run:
    npx lumina-wiki@latest install
`;

if (cmd === '--version' || cmd === '-v') {
  console.log(pkg.version);
  process.exit(0);
}

console.log(banner);
process.exit(0);
