// GitHub Contents API client for reading/writing data.json.
import { encodeBase64Utf8, decodeBase64Utf8 } from './core.js';

export const REPO = {
  owner: 'weichuncheng0104',
  repo: '006_0029_RadiologyReportWait_Site',
  path: 'data.json',
  branch: 'main',
};

const API_URL = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}`;

export class ApiError extends Error {
  constructor(status) {
    super(describeApiError(status));
    this.status = status;
  }
}

export function describeApiError(status) {
  if (status === 0) return '無法連線 GitHub，請檢查網路';
  if (status === 401) return 'Token 無效或已過期';
  if (status === 403 || status === 404) return 'Token 權限不足（需本 repo 的 Contents 讀寫權限）或檔案不存在';
  if (status === 409) return '資料已被更新，請重新載入後再存';
  if (status === 422) return 'GitHub 拒絕此次儲存（資料驗證失敗）';
  return `GitHub 回應錯誤（HTTP ${status}）`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function request(fetchImpl, url, init) {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch {
    throw new ApiError(0);
  }
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

export async function getFile(token, fetchImpl = fetch) {
  const body = await request(fetchImpl, `${API_URL}?ref=${REPO.branch}`, {
    headers: headers(token), cache: 'no-store',
  });
  return { data: JSON.parse(decodeBase64Utf8(body.content)), sha: body.sha };
}

export async function putFile(token, data, sha, fetchImpl = fetch) {
  const body = await request(fetchImpl, API_URL, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update wait times ${data.lastUpdate ?? ''}`.trim(),
      content: encodeBase64Utf8(JSON.stringify(data, null, 2) + '\n'),
      sha,
      branch: REPO.branch,
    }),
  });
  return body.content.sha;
}

function contentsUrl(path) {
  return `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}`;
}

// Read a text file at `path`; only here is a 404 treated as "does not exist" (returns null).
export async function getText(token, path, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${contentsUrl(path)}?ref=${REPO.branch}`, { headers: headers(token), cache: 'no-store' });
  } catch {
    throw new ApiError(0);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status);
  const body = await res.json();
  // Contents API omits content for files over 1MB; never treat that as an empty file (would wipe history on upsert).
  if (body.encoding && body.encoding !== 'base64') throw new Error(`${path} 過大，無法經 API 讀取`);
  return { text: decodeBase64Utf8(body.content), sha: body.sha };
}

// Create/update a text file at `path`; sha omitted for a new file. Returns the new sha.
export async function putText(token, path, text, sha, message, fetchImpl = fetch) {
  const body = await request(fetchImpl, contentsUrl(path), {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encodeBase64Utf8(text),
      ...(sha ? { sha } : {}),
      branch: REPO.branch,
    }),
  });
  return body.content.sha;
}
