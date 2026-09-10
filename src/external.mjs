// Read-only, opt-in Jira and Confluence ingestion. Remote text is evidence, never instructions.
export function plainText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plainText).join('\n');
  if (typeof value === 'object') {
    const text = value.text ?? '';
    const links = (value.marks ?? []).filter(x => x.type === 'link').map(x => x.attrs?.href ?? '');
    return [text, ...links, ...(value.content ?? []).map(plainText)].filter(Boolean).join(value.type === 'paragraph' ? '' : '\n');
  }
  return String(value);
}

export function issueSections(fields, mapping = {}) {
  const description = plainText(fields.description);
  const names = ['Problem', 'Cause', 'Solution'];
  const sections = {Problem:[], Cause:[], Solution:[]};
  let current;
  for (const line of description.split(/\r?\n/)) {
    const heading = /^(?:h[1-6]\.\s*|#{1,6}\s*)?[*_]{0,2}(Problem|Cause|Solution)\s*:?[*_]{0,2}\s*(?::\s*(.*))?\s*$/i.exec(line);
    if (heading) { current = names.find(x => x.toLowerCase() === heading[1].toLowerCase()); if (heading[2]) sections[current].push(heading[2]); }
    else if (current) sections[current].push(line);
  }
  const result = Object.fromEntries(names.map(name => [name, mapping[name] ? plainText(fields[mapping[name]]) || null : sections[name].join('\n').trim() || null]));
  return result;
}

function auth(settings) {
  const token = process.env[settings.tokenEnv ?? 'DOCFLOW_JIRA_TOKEN'];
  if (!token) return {};
  if (settings.auth === 'basic') {
    const user = process.env[settings.userEnv ?? 'DOCFLOW_JIRA_USER'];
    if (!user) throw new Error('Basic 인증 사용자 환경변수가 없습니다.');
    return { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` };
  }
  return { Authorization: `Bearer ${token}` };
}

async function getJson(settings, suffix, fetcher) {
  const base = new URL(settings.baseUrl.endsWith('/') ? settings.baseUrl : settings.baseUrl + '/');
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid evidence server URL');
  const url = new URL(suffix, base);
  if (url.origin !== base.origin) throw new Error('Evidence URL escaped configured origin');
  const response = await fetcher(url, { headers: { Accept: 'application/json', ...auth(settings) }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`근거 서버 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 4 * 1024 * 1024) throw new Error('Evidence response is too large');
  return JSON.parse(text);
}

function confluenceLinks(issue, settings) {
  if (!settings?.enabled) return [];
  const origin = new URL(settings.baseUrl).origin;
  return [...new Set((JSON.stringify(issue).match(/https?:[^\s"<>\\]+/g) ?? []).map(x => x.replace(/[),.;]+$/, '')).filter(x => {
    try { return new URL(x).origin === origin; } catch { return false; }
  }))];
}

async function confluencePage(url, settings, fetcher) {
  const parsed = new URL(url);
  let id = parsed.searchParams.get('pageId') ?? parsed.pathname.match(/\/pages\/(\d+)/)?.[1];
  if (!id) {
    const pretty = parsed.pathname.match(/\/display\/([^/]+)\/(.+)$/);
    if (!pretty) return { url, state: 'unresolved', reason: '페이지 ID를 찾지 못했습니다.' };
    const params = new URLSearchParams({ spaceKey: decodeURIComponent(pretty[1]), title: decodeURIComponent(pretty[2].replaceAll('+', ' ')) });
    const found = await getJson(settings, `rest/api/content?${params}`, fetcher);
    if (found.results?.length !== 1) return { url, state: 'unresolved', reason: '페이지를 하나로 특정하지 못했습니다.' };
    id = String(found.results[0].id);
  }
  if (!/^\d+$/.test(id)) throw new Error('Invalid Confluence page ID');
  const page = await getJson(settings, `rest/api/content/${id}?expand=body.storage,version`, fetcher);
  return { id, url, state: 'available', title: page.title, revision: page.version?.number,
    updated: page.version?.when, storage: page.body?.storage?.value ?? '', evidenceKind: 'design-reference' };
}

export async function collectExternal(config, batch, fetcher = fetch) {
  if (!config.jira?.enabled) return { schema: 1, issues: [], confluence: [] };
  if (!batch) throw new Error('Jira 연동에는 changes.mode=commits가 필요합니다.');
  const issues = [], pages = new Map();
  for (const key of batch.issues) {
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('Invalid Jira issue key');
    let raw;
    try { raw = await getJson(config.jira, `rest/api/${config.jira.apiVersion ?? 2}/issue/${key}`, fetcher); }
    catch (error) {
      if ((config.jira.failurePolicy ?? 'fail') !== 'record-missing') throw error;
      issues.push({key, state:'unavailable', reason:error.message});
      continue;
    }
    {
      const fields = raw.fields ?? {};
      issues.push({ key, url: `${config.jira.baseUrl.replace(/\/$/, '')}/browse/${key}`, title: fields.summary,
        updated: fields.updated, status: fields.status?.name, sections: issueSections(fields, config.jira.fields),
        confluenceUrls: confluenceLinks(raw, config.confluence),
        attachments: (config.jira.attachments === 'ignore' ? [] : fields.attachment ?? []).map(a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType,
          url: a.content, state: 'linked-not-inspected' })), evidenceKind: 'issue-report', state: 'available' });
      for (const url of confluenceLinks(raw, config.confluence)) {
        if (!pages.has(url)) {
          try { pages.set(url, await confluencePage(url, {tokenEnv:'DOCFLOW_CONFLUENCE_TOKEN', ...config.confluence}, fetcher)); }
          catch (error) {
            if ((config.confluence.failurePolicy ?? 'fail') !== 'record-missing') throw error;
            pages.set(url, {url, state:'unavailable', reason:error.message});
          }
        }
      }
    }
  }
  return { schema: 1, issues, confluence: [...pages.values()] };
}
