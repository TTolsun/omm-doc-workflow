// Use the same key-specific evidence for hashing and prompting.
import { globToRegExp } from './lib.mjs';

export function selectCommits(batch, patterns) {
  const matches = patterns.map(globToRegExp);
  const relevant = files => (files ?? []).filter(file => matches.some(re => re.test(file.path)));
  return (batch?.commits ?? []).flatMap(commit => {
    // Legacy batches have no per-commit paths: conservatively use their diff.
    const changedFiles = relevant(commit.changedFiles ?? batch.changedFiles);
    return changedFiles.length ? [{ ...commit, changedFiles, issues: commit.issues ?? batch.issues ?? [] }] : [];
  });
}

export function selectExternal(external, commits, references = []) {
  const keys = new Set(commits.flatMap(c => c.issues ?? []));
  for (const ref of references) if (ref.startsWith('jira:')) keys.add(ref.slice(5));
  const issues = (external?.issues ?? []).filter(x => keys.has(x.key));
  const urls = new Set(issues.flatMap(x => x.confluenceUrls ?? []));
  const confluence = (external?.confluence ?? []).filter(x => urls.has(x.url) || references.includes(`confluence:${x.id}`));
  return { issues, confluence };
}
