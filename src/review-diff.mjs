// 재검토할 사람에게 "마지막 검토 이후 근거 코드에서 무엇이 바뀌었는가"를 보여 줍니다.
//
// 최신성 판정은 근거 파일 전체를 하나로 묶은 codeHash 만 비교하므로, "재검토 필요"라는 사실은 알려 주지만
// 어느 파일의 어느 줄이 바뀌었는지는 알려 주지 않습니다. 로컬 모델이 그 변화를 원본에 반영했다고 믿을 수도
// 없으므로(형식 검사만 통과한 채 값 변경을 놓칠 수 있습니다) 사람이 코드와 원본을 직접 대조해야 하고,
// 이 모듈은 그 대조에 필요한 diff 를 만듭니다.
//
// 검토 기록(accepted.files)에는 근거 파일마다 git blob 해시를 남깁니다. 줄 끝을 LF 로 맞춘 내용의 해시이므로
// 저장소에 커밋된 blob 과 같고, 그 blob 이 저장소에 있으면 `git cat-file` 로 검토 당시 내용을 되살릴 수 있습니다.
// 이 필드가 없는 예전 기록은 검토 커밋(accepted.commit)을 기준으로 삼되, squash 머지 등으로 커밋이 사라졌으면
// 그 사실만 알립니다. 어느 경우에도 판정 결과(stale/fresh)는 바꾸지 않습니다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SOURCE_ROOT, sourcePath } from './config.mjs';
import { normalizeText, blobSha } from './text.mjs';

export function fileBlobs(files) {
  return Object.fromEntries(files.map(rel => [rel, blobSha(fs.readFileSync(sourcePath(rel), 'utf8'))]));
}

const git = (args) => spawnSync('git', args, { cwd: SOURCE_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });

// 검토 당시 blob 과 현재 파일의 unified diff. 헤더는 근거 경로로 바꿉니다.
function diffBlob(rel, sha) {
  const old = git(['cat-file', '-p', sha]);
  if (old.status !== 0) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-review-'));
  try {
    const before = path.join(dir, 'before'), after = path.join(dir, 'after');
    fs.writeFileSync(before, normalizeText(old.stdout));
    fs.writeFileSync(after, normalizeText(fs.readFileSync(sourcePath(rel), 'utf8')));
    const diff = git(['diff', '--no-index', '--no-color', '--unified=3', '--', before, after]);
    const body = diff.stdout.split('\n');
    const start = body.findIndex(line => line.startsWith('@@'));
    return [`--- a/${rel}`, `+++ b/${rel}`, ...(start < 0 ? [] : body.slice(start))].join('\n').trimEnd();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function clip(lines, max) {
  return lines.length <= max ? lines : [...lines.slice(0, max), `… (${lines.length - max}줄 생략. DOCFLOW_CHANGES_MAX_LINES 로 늘릴 수 있습니다)`];
}

// current 는 computeHashes 결과, accepted 는 검토 기록입니다. 출력할 줄 목록을 돌려줍니다.
export function describeChanges(current, accepted, { maxLines = 400 } = {}) {
  if (!accepted) return ['  검토 기록이 없어 비교할 기준이 없습니다. 근거 파일 전체를 대조하세요.'];
  const out = [];
  if (accepted.files) {
    const now = fileBlobs(current.files);
    const added = current.files.filter(rel => !(rel in accepted.files));
    const removed = Object.keys(accepted.files).filter(rel => !(rel in now)).sort();
    const changed = current.files.filter(rel => rel in accepted.files && accepted.files[rel] !== now[rel]);
    if (!added.length && !removed.length && !changed.length) return ['  근거 파일 내용은 검토 때와 같습니다. 근거 범위(바인딩)가 바뀌었는지 확인하세요.'];
    for (const rel of added) out.push(`  추가된 근거 파일: ${rel}`);
    for (const rel of removed) out.push(`  빠진 근거 파일: ${rel}`);
    for (const rel of changed) {
      out.push(`  바뀐 근거 파일: ${rel}`);
      const diff = diffBlob(rel, accepted.files[rel]);
      out.push(...(diff ? diff.split('\n').map(line => `    ${line}`) : [`    검토 당시 내용(blob ${accepted.files[rel].slice(0, 12)})을 저장소에서 찾을 수 없어 diff 를 표시하지 못했습니다.`]));
    }
    return clip(out, maxLines);
  }
  // 파일별 기록이 없는 예전 검토: 검토 커밋이 아직 저장소에 있으면 그 커밋과 현재 작업본을 비교합니다.
  const commit = accepted.commit && git(['rev-parse', '--verify', '--quiet', `${accepted.commit}^{commit}`]);
  if (!commit || commit.status !== 0) {
    return [`  검토 기록에 파일별 해시가 없고, 검토 커밋 ${accepted.commit ?? '(없음)'}을 저장소에서 찾을 수 없습니다.`,
      '  다음 검토(--accept)부터 바뀐 파일과 diff 를 표시합니다. 이번에는 근거 파일 전체를 대조하세요.'];
  }
  const diff = git(['diff', '--no-color', '--unified=3', commit.stdout.trim(), '--', ...current.files]);
  if (diff.status !== 0) return [`  검토 커밋 ${accepted.commit}과의 diff 를 만들지 못했습니다: ${diff.stderr.trim()}`];
  const lines = diff.stdout.trimEnd().split('\n').filter(Boolean);
  if (!lines.length) return [`  검토 커밋 ${accepted.commit} 이후 근거 파일의 커밋 내용은 같습니다. 줄 끝이나 근거 범위가 바뀌었는지 확인하세요.`];
  return clip([`  검토 커밋 ${accepted.commit} 기준 (파일별 기록이 없는 예전 검토입니다):`, ...lines.map(line => `    ${line}`)], maxLines);
}
