#!/usr/bin/env node

const major = Number(String(process.versions.node || '0').split('.')[0]);
if (!Number.isFinite(major) || major < 24) {
  process.stderr.write(
    `lynceus requires Node.js >= 24.0.0 (detected ${process.versions.node || 'unknown'}).\n`
  );
  process.exit(2);
}

const commandsUrl = new URL('../src/cli/commands.mjs', import.meta.url).href;
const { runCli } = await import(commandsUrl);
process.exitCode = await runCli(process.argv.slice(2));
