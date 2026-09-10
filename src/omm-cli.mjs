import path from 'node:path';
import fs from 'node:fs';

export function ommCli() {
  if (process.env.DOCGEN_OMM_CLI) return path.resolve(process.env.DOCGEN_OMM_CLI);
  let directory = import.meta.dirname;
  while (true) {
    const candidate = path.join(directory, 'node_modules/oh-my-mermaid/dist/cli.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path.join(import.meta.dirname, '../node_modules/oh-my-mermaid/dist/cli.js');
}
