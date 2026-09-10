import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function collectChanges(config, sourceRoot, stateDir) {
  if ((config.changes?.mode ?? 'working-tree') === 'working-tree') return null;
  if (config.changes.mode !== 'commits') throw new Error('changes.mode must be working-tree or commits');
  const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git('status', '--porcelain')) throw new Error('커밋 기반 실행에는 변경 없는 미러 작업본이 필요합니다.');
  const head = git('rev-parse', 'HEAD');
  const checkpointFile = path.join(stateDir, 'checkpoint.json');
  const base = fs.existsSync(checkpointFile) ? JSON.parse(fs.readFileSync(checkpointFile)).sourceCommit : config.changes.initialCommit;
  if (!base) throw new Error('첫 실행의 changes.initialCommit을 지정하세요. 이후에는 검토 후 기록한 checkpoint를 사용합니다.');
  if (!/^[a-f0-9]{7,40}$/i.test(base)) throw new Error('initialCommit/checkpoint must be a commit hash');
  const baseCommit = git('rev-parse', `${base}^{commit}`);
  git('merge-base', '--is-ancestor', baseCommit, head);
  const range = `${baseCommit}..${head}`;
  const hashes = git('rev-list', '--reverse', range).split('\n').filter(Boolean);
  if (hashes.length > (config.changes.maxCommits ?? 100)) throw new Error('변경 커밋이 한도를 초과했습니다. 처리 구간을 나누세요.');
  if (config.jira?.enabled && (!config.jira.projectKey || !config.jira.issuePattern)) throw new Error('jira.enabled에는 projectKey와 issuePattern이 필요합니다.');
  const issuePattern = config.jira?.enabled ? new RegExp(config.jira.issuePattern, 'gi') : null;
  const parseFiles = text => {
    const tokens = text.split('\0').filter(Boolean), files = [];
    for (let i = 0; i < tokens.length; i += 2) files.push({ status: tokens[i], path: tokens[i + 1] });
    return files;
  };
  const commits = hashes.map(sha => {
    const message = git('show', '-s', '--format=%B', sha);
    const issues = issuePattern ? [...new Set([...message.matchAll(issuePattern)].map(m => {
      if (!/^\d+$/.test(m[1] ?? '')) throw new Error('jira.issuePattern의 첫 캡처 그룹은 이슈 번호여야 합니다.');
      return `${config.jira.projectKey}-${m[1]}`;
    }))].sort() : [];
    // Compare merges against their first parent, including paths deleted or renamed.
    const changedFiles = parseFiles(git('diff-tree', '--root', '--first-parent', '-m', '--no-commit-id', '-r', '--name-status', '-z', '--no-renames', sha));
    return { sha, message, issues, changedFiles };
  });
  const issues = [...new Set(commits.flatMap(c => c.issues))].sort();
  const changedFiles = parseFiles(git('diff', '--name-status', '-z', '--no-renames', baseCommit, head));
  return { schema: 1, baseCommit, headCommit: head, commits, issues, changedFiles };
}
