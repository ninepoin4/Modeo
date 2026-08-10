/**
 * 零依赖网络请求层：支持 HTTP(S)_PROXY / NO_PROXY 环境变量（CONNECT 隧道），
 * 返回兼容 fetch Response 语义的对象（ok/status/headers.get/text/arrayBuffer/body.getReader）。
 * Node 内置 fetch（undici）不读代理环境变量，国内环境直连超时，故自实现。
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { URL } from 'node:url';

/** 判断目标是否命中 NO_PROXY */
function inNoProxy(hostname) {
  const list = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.some((n) => {
    if (n.startsWith('.')) return hostname.endsWith(n);
    return hostname === n || hostname.endsWith('.' + n);
  });
}

/** 返回目标应使用的代理 URL，无则 null */
export function getProxyFor(targetUrl) {
  const u = new URL(targetUrl);
  const host = u.hostname.toLowerCase();
  if (inNoProxy(host)) return null;
  const proxy =
    u.protocol === 'https:'
      ? process.env.HTTPS_PROXY || process.env.https_proxy
      : process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy) return null;
  try {
    return new URL(proxy).href;
  } catch {
    return null;
  }
}

/** 解析代理 URL 中的认证信息，返回 Proxy-Authorization 头值（无则 null） */
function proxyAuth(proxyUrl) {
  try {
    const p = new URL(proxyUrl);
    if (p.username || p.password) {
      const user = decodeURIComponent(p.username || '');
      const pass = decodeURIComponent(p.password || '');
      return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }
  } catch {
    /* 解析失败视为无认证 */
  }
  return null;
}

/** 通过 HTTP 代理建立 CONNECT 隧道，返回已连接 socket（尚未 TLS） */
function connectTunnel(proxyUrl, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const auth = proxyAuth(proxyUrl);
    const headers = { Host: `${targetHost}:${targetPort}`, 'Proxy-Connection': 'keep-alive' };
    if (auth) headers['Proxy-Authorization'] = auth;
    const req = http.request({
      host: p.hostname,
      port: p.port || 80,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理 CONNECT 失败: HTTP ${res.statusCode}`));
        return;
      }
      resolve(socket);
    });
    req.on('error', reject);
    req.end();
  });
}

/** Node IncomingMessage → Web ReadableStream reader 兼容对象 */
function nodeToReader(stream) {
  let ended = false;
  let errored = null;
  const pending = [];
  const waiters = [];
  stream.on('data', (c) => {
    if (waiters.length) waiters.shift()({ done: false, value: c });
    else pending.push(c);
  });
  stream.on('end', () => {
    ended = true;
    while (waiters.length) waiters.shift()({ done: true });
  });
  stream.on('error', (e) => {
    errored = e;
    while (waiters.length) waiters.shift()({ done: true });
  });
  return {
    read: () =>
      new Promise((resolve) => {
        if (pending.length) return resolve({ done: false, value: pending.shift() });
        if (ended) return resolve({ done: true });
        if (errored) return resolve({ done: true });
        waiters.push(resolve);
      }),
  };
}

function makeResponse(nodeRes) {
  return {
    ok: nodeRes.statusCode >= 200 && nodeRes.statusCode < 300,
    status: nodeRes.statusCode,
    headers: {
      get: (name) => nodeRes.headers[String(name).toLowerCase()] ?? null,
    },
    body: { getReader: () => nodeToReader(nodeRes) },
    text: () => collectBody(nodeRes, 'utf8'),
    arrayBuffer: () => collectBody(nodeRes, 'buffer'),
  };
}

function collectBody(nodeRes, encoding) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    nodeRes.on('data', (c) => chunks.push(c));
    nodeRes.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve(encoding === 'utf8' ? buf.toString('utf8') : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    });
    nodeRes.on('error', reject);
  });
}

/**
 * 兼容 fetch 的网络请求。
 * @param {string} targetUrl
 * @param {{method?:string, headers?:object, body?:string|Buffer, signal?:AbortSignal}} opts
 */
export async function netFetch(targetUrl, opts = {}) {
  const u = new URL(targetUrl);
  const method = opts.method || 'GET';
  const headers = { ...(opts.headers || {}) };
  const proxy = getProxyFor(targetUrl);
  const requestOpts = {
    method,
    headers,
    signal: opts.signal,
  };

  if (u.protocol === 'https:') {
    const doHttps = (socket) => {
      const reqOpts = {
        host: u.hostname,
        port: Number(u.port) || 443,
        path: u.pathname + u.search,
        method,
        headers,
        signal: opts.signal,
      };
      if (socket) {
        // 代理隧道：在已连接 socket 上做 TLS
        reqOpts.createConnection = () => tls.connect({ socket, servername: u.hostname });
      }
      return new Promise((resolve, reject) => {
        const req = https.request(reqOpts, (res) => resolve(makeResponse(res)));
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
      });
    };
    if (proxy) {
      const sock = await connectTunnel(proxy, u.hostname, Number(u.port) || 443);
      return await doHttps(sock);
    }
    return await doHttps(null);
  }

  // http:// 目标
  const doHttp = (fullUrl) => {
    const auth = fullUrl ? proxyAuth(fullUrl) : null;
    const reqOpts = fullUrl
      ? {
          host: new URL(fullUrl).hostname,
          port: new URL(fullUrl).port || 80,
          path: targetUrl,
          method,
          headers: auth ? { ...headers, 'Proxy-Authorization': auth } : headers,
          signal: opts.signal,
        }
      : { host: u.hostname, port: Number(u.port) || 80, path: u.pathname + u.search, method, headers, signal: opts.signal };
    return new Promise((resolve, reject) => {
      const req = http.request(reqOpts, (res) => resolve(makeResponse(res)));
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  };
  return proxy ? doHttp(proxy) : doHttp(null);
}
