// Visual presentation is independent from manuscript evidence and review hashes.
export function renderDesign(design, readFile) {
  if (!['architecture','slack','plain','custom'].includes(design.preset)) throw new Error('Unknown design preset');
  if (design.preset === 'architecture') return readFile('@architecture.css');
  if (design.preset === 'custom') {
    const css = readFile(design.stylesheet).replaceAll('\r\n','\n');
    if (!css.trim()) throw new Error('Custom stylesheet is empty');
    return css.trimEnd() + '\n';
  }
  const slack = design.preset === 'slack';
  const palette = {primary: slack?'#4a154b':'#243247', ink:'#1d1d1d', muted:'#696969', link:slack?'#1264a3':'#174c83', cream:slack?'#f4ede4':'#f4f5f7', lavender:slack?'#f9f0ff':'#f7f8fa', border:'#e6e6e6', ...design.colors};
  for (const [key,value] of Object.entries(palette)) {
    if (!['primary','ink','muted','link','cream','lavender','border'].includes(key) || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid design color: ${key}`);
  }
  const vars=Object.entries(palette).map(([k,v])=>`--doc-${k}:${v}`).join(';');
  return `/* Generated document theme: ${design.preset}. Change project design configuration. */
:root{${vars};color-scheme:light}
*{box-sizing:border-box}
html{scroll-padding-top:96px}
body{max-width:1240px;margin:0 auto;padding:32px 40px 64px;font:16px/1.75 Inter,"Noto Sans KR","Malgun Gothic",system-ui,sans-serif;color:var(--doc-ink);background:#fff;word-break:keep-all;overflow-wrap:break-word}
nav[aria-label="문서 메뉴"]{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 0 24px;border-bottom:1px solid var(--doc-border)}
nav[aria-label="문서 메뉴"] a{padding:9px 20px;border-radius:90px;color:var(--doc-primary);font-weight:700;text-decoration:none}
nav[aria-label="문서 메뉴"] a:hover,nav[aria-label="문서 메뉴"] a[aria-current="page"]{background:var(--doc-primary);color:white}
main{padding-top:24px;min-width:0}
main>h1:first-child{font-size:clamp(30px,4vw,48px);line-height:1.25;letter-spacing:-.025em;color:var(--doc-primary);padding:40px 32px;margin:0 0 32px;border-radius:16px;background:linear-gradient(115deg,var(--doc-cream),var(--doc-lavender))}
h2{font-size:26px;line-height:1.4;margin-top:56px;color:var(--doc-primary)}h3{font-size:20px;line-height:1.5;margin-top:32px}
p,li{max-width:88ch}li+li{margin-top:8px}a{color:var(--doc-link);text-underline-offset:3px}
pre{overflow:auto;padding:24px;background:var(--doc-lavender);border:1px solid var(--doc-border);border-radius:12px;font-size:14px;line-height:1.65;word-break:normal;overflow-wrap:normal}
main :not(pre)>code{padding:2px 5px;background:var(--doc-lavender);border-radius:4px;overflow-wrap:anywhere}
table{border-collapse:separate;border-spacing:0;display:block;max-width:100%;overflow:auto;margin:24px 0;font-size:15px}th,td{border:0;border-bottom:1px solid var(--doc-border);padding:14px 16px;text-align:left;vertical-align:top}th{background:var(--doc-cream);color:var(--doc-primary)}
details{margin:20px 0;padding:16px 20px;border:1px solid var(--doc-border);border-radius:12px;background:#fff}summary{cursor:pointer;font-weight:600;color:var(--doc-primary)}.doc-evidence{font-size:14px;overflow-wrap:anywhere}
blockquote{margin:24px 0;padding:16px 24px;border-left:4px solid var(--doc-primary);background:var(--doc-lavender);border-radius:0 12px 12px 0}
button{font:inherit;cursor:pointer;border:1px solid var(--doc-primary);border-radius:90px;background:#fff;color:var(--doc-primary);padding:8px 18px}button:hover{background:var(--doc-lavender)}
:is(a,button,summary,[tabindex]):focus-visible{outline:3px solid var(--doc-link);outline-offset:4px}
.mermaid{overflow:auto;margin:28px 0;padding:24px 16px;border:1px solid var(--doc-border);border-radius:16px;background:#fff}.mermaid svg{max-width:100%}main img{max-width:100%;height:auto;border-radius:12px}
.diagram-dialog{color:var(--doc-ink);border-color:var(--doc-border);border-radius:16px}.diagram-toolbar{border-color:var(--doc-border)}.diagram-viewport{background:var(--doc-cream)}
@media(max-width:640px){body{padding:16px 16px 40px}nav[aria-label="문서 메뉴"] a{padding:8px 12px}main>h1:first-child{padding:28px 20px}h2{font-size:23px;margin-top:40px}pre{padding:16px}th,td{padding:10px 12px}.mermaid{padding:12px 8px}}
@media print{body{max-width:none;padding:0}nav,dialog{display:none!important}main>h1:first-child{background:none;padding:0}.mermaid,pre,table{overflow:visible}}
`;
}
