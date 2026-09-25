import crypto from 'node:crypto';

// 설정을 읽지 않는 순수 텍스트 도우미. 검사기처럼 프로젝트 설정 없이 단독으로 쓰이는 모듈이 가져갑니다.

// 근거와 원고는 텍스트이므로 체크아웃 줄 끝 차이는 변경이 아닙니다.
export const normalizeText = (text) => text.replace(/\r\n/g, "\n");

// 줄 끝을 LF 로 맞춘 내용의 git blob 해시. 저장소에 커밋된 blob 과 같으므로 검토 당시 내용을 git 에서 되찾는 열쇠가 됩니다.
export function blobSha(text) {
  const body = Buffer.from(normalizeText(text), 'utf8');
  return crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}
