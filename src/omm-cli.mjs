import path from 'node:path';
import fs from 'node:fs';

export function ommCli() {
  if (process.env.DOCGEN_OMM_CLI) return path.resolve(process.env.DOCGEN_OMM_CLI);
  const local = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'HALCamera/docgen-tools/node_modules/oh-my-mermaid/dist/cli.js') : null;
  if (local && fs.existsSync(local)) return local;
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
