import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function spawnHermes(args, options = {}) {
  let cli = process.env.DOCFLOW_HERMES_CLI ?? 'hermes';
  if (process.platform === 'win32' && !path.extname(cli)) {
    const dirs = /[\\/]/.test(cli) ? [''] : (process.env.PATH ?? '').split(path.delimiter);
    const candidates = dirs.flatMap(dir => ['.exe', '.cmd', '.bat'].map(ext => path.join(dir.replace(/^"|"$/g, ''), cli + ext)));
    cli = candidates.find(file => fs.existsSync(file)) ?? cli;
  }
  if (/\.[cm]?js$/i.test(cli)) return spawnSync(process.execPath, [cli, ...args], options);
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(cli)) return spawnSync(cli, args, options);
  // cmd.exe expands these characters even inside quotes. Fail closed instead of interpolating them.
  if ([cli, ...args].some(value => /["%!^&|<>\r\n]/.test(value))) {
    return { status: null, error: { code: 'UNSAFE_CMD_ARGUMENT' }, stdout: '', stderr: '' };
  }
  const command = `"${[cli, ...args].map(value => `"${value}"`).join(' ')}"`;
  return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { ...options, windowsVerbatimArguments: true });
}
