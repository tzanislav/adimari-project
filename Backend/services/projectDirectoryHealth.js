const dns = require('node:dns/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function isPublicAddress(address) {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2)))
      && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      && !(a === 203 && b === 0 && c === 113);
  }
  if (net.isIP(ip) === 6) {
    if (ip.includes('.')) return isPublicAddress(ip.slice(ip.lastIndexOf(':') + 1));
    const first = Number.parseInt(ip.split(':')[0], 16);
    return first >= 0x2000 && first < 0x4000 && !ip.startsWith('2001:db8:');
  }
  return false;
}

async function resolvePublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('Private or reserved address');
    return { address: host, family: net.isIP(host) };
  }
  const addresses = await dns.lookup(host, { all: true });
  const publicAddress = addresses.find(({ address }) => isPublicAddress(address));
  if (!publicAddress) throw new Error('No public address');
  return publicAddress;
}

async function requestStatus(urlString, method = 'HEAD', redirects = 0) {
  const url = new URL(urlString);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported URL');
  const resolved = await resolvePublicHost(url.hostname);
  const transport = url.protocol === 'https:' ? https : http;
  const response = await new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method,
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
      headers: { 'user-agent': 'AdimariProjectStatus/1.0', accept: '*/*' },
      timeout: 5000,
    }, (res) => {
      const result = { statusCode: res.statusCode, location: res.headers.location };
      res.destroy();
      resolve(result);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.location) {
    if (redirects >= 5) throw new Error('Too many redirects');
    return requestStatus(new URL(response.location, url).href, method, redirects + 1);
  }
  if (method === 'HEAD' && [405, 501].includes(response.statusCode)) return requestStatus(urlString, 'GET');
  return response.statusCode;
}

function createProjectDirectoryHealth({ store, check = requestStatus, intervalMs = 60 * 60 * 1000 } = {}) {
  const results = new Map();
  let timer = null;
  let running = false;
  let rerun = false;

  async function refresh() {
    if (running) { rerun = true; return; }
    running = true;
    try {
      const projects = await store.read();
      for (const id of results.keys()) if (!projects.some((project) => project.id === id)) results.delete(id);
      for (let index = 0; index < projects.length; index += 4) {
        await Promise.all(projects.slice(index, index + 4).map(async (project) => {
          const target = project.healthUrl || (project.link.type === 'external' ? project.link.value : '');
          if (!target) {
            results.set(project.id, { state: 'not_checked', checkedAt: null });
            return;
          }
          try {
            const statusCode = await check(target);
            const state = (statusCode >= 200 && statusCode < 400) || [401, 403].includes(statusCode)
              ? 'live' : statusCode === 429 ? 'unknown' : 'unavailable';
            results.set(project.id, { state, checkedAt: new Date().toISOString(), statusCode });
          } catch (error) {
            const state = ['Private or reserved address', 'No public address', 'Unsupported URL'].includes(error.message)
              ? 'unknown' : 'unavailable';
            results.set(project.id, { state, checkedAt: new Date().toISOString() });
          }
        }));
      }
    } catch (error) {
      console.error('Project directory health check failed:', error);
    } finally {
      running = false;
      if (rerun) { rerun = false; void refresh(); }
    }
  }

  function get(project) {
    return results.get(project.id) || { state: project.healthUrl || project.link.type === 'external' ? 'checking' : 'not_checked', checkedAt: null };
  }

  function invalidate(id) { results.delete(id); }

  function start() {
    void refresh();
    if (timer === null) { timer = setInterval(() => void refresh(), intervalMs); timer.unref?.(); }
  }

  function stop() { if (timer !== null) clearInterval(timer); timer = null; }

  return { get, invalidate, refresh, start, stop };
}

module.exports = { createProjectDirectoryHealth, isPublicAddress, requestStatus };
