#!/usr/bin/env node
import path from 'node:path';

const args = process.argv.slice(2);
const command = args.shift();
for (const [flag, variable] of [['--project', 'DOCFLOW_PROJECT_ROOT'], ['--source', 'DOCFLOW_SOURCE_ROOT'], ['--config', 'DOCFLOW_CONFIG']]) {
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    process.env[variable] = flag === '--config' ? value : path.resolve(value);
    args.splice(index, 2);
  }
}
const commands = ['sync', 'collect', 'extract', 'verify', 'generate', 'brief', 'doctor', 'ack', 'design'];
if (!commands.includes(command)) {
  console.log('docflow <sync|collect|extract|verify|generate|brief|doctor|ack|design> --project <documentation-repo> [--source <code-repo>] [--config <relative-json>]');
  process.exitCode = command && command !== '--help' ? 1 : 0;
} else {
  process.argv = [process.execPath, new URL(`../src/${command}.mjs`, import.meta.url).pathname, ...args];
  await import(`../src/${command}.mjs`);
}
