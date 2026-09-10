import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { readBindings, repoPath } from './lib.mjs';
import { renderDesign } from './design-theme.mjs';

if (CONFIG.design) {
  const css = renderDesign(CONFIG.design, rel => fs.readFileSync(repoPath(rel), 'utf8'));
  const target = repoPath(readBindings().site.root, 'assets', 'docflow-design.css');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n') !== css) throw new Error('디자인 생성 결과가 다릅니다. design 명령으로 갱신하세요.');
    console.log('디자인 생성 결과 일치');
  } else {
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.writeFileSync(target, css);
    console.log(`문서 디자인 적용: ${CONFIG.design.preset}`);
  }
} else console.log('디자인 설정 없음: 기존 사이트 디자인을 유지합니다.');
