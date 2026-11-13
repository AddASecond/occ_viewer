// Full-resolution binary downloads: inactivity timeout, progress, validated resume.
// There is intentionally no total-duration deadline for an actively flowing file.
export async function downloadArrayBuffer(url, {
  signal, expectedBytes = null, onProgress = () => {}, idleTimeoutMs = 90000,
  retries = 3, fetchImpl = fetch,
} = {}) {
  let total = expectedBytes, bytes = null, chunks = [], loaded = 0;
  let etag = null, validator = null, resumable = false, failures = 0;
  const validSize = n => Number.isSafeInteger(n) && n >= 0;
  if (total !== null && !validSize(total)) throw new Error('Invalid asset byte length');
  const fail = (message, retryable = false) => Object.assign(new Error(message), {retryable});
  const report = () => onProgress({loaded, total, retries: failures});
  function reset() { loaded = 0; chunks = []; }
  function setTotal(n) {
    if (!validSize(n)) throw fail('Invalid Content-Length/Content-Range');
    if (total !== null && total !== n) throw fail(`Asset length mismatch: expected ${total}, received ${n}`);
    total = n;
    if (!bytes) {
      bytes = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      chunks = [];
    }
  }
  if (total !== null) setTotal(total);
  while (true) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer, timedOut = false, reader;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, idleTimeoutMs);
    };
    try {
      if (loaded && !resumable) reset();
      const offset = loaded;
      const headers = offset ? {Range: `bytes=${offset}-`, ...(validator && {'If-Range': validator})} : {};
      touch();
      const response = await fetchImpl(url, {signal: requestSignal, headers});
      touch();
      if (!response.ok) throw fail(`HTTP ${response.status} ${response.statusText}`,
        response.status >= 500 || [408,429].includes(response.status));
      if (response.headers.get('content-type')?.includes('text/html')) {
        throw fail('返回了网页而非数据，请检查登录或数据权限');
      }
      const encoding = response.headers.get('content-encoding');
      const encoded = encoding && encoding !== 'identity';
      let responseEnd = null;
      if (response.status === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (!match || Number(match[1]) !== offset || encoded) throw fail('Invalid resume Content-Range');
        const [, start, end, length] = match.map(Number);
        if (end < start || end >= length) throw fail('Invalid resume byte interval');
        if (etag && response.headers.get('etag') !== etag) throw fail('Asset changed during resume');
        setTotal(length);
        responseEnd = end + 1;
      } else if (response.status === 200) {
        // Range may be ignored, or If-Range may indicate a changed object.
        // Restart instead of appending duplicate bytes or mixing two versions.
        if (offset) reset();
        const length = response.headers.get('content-length');
        if (length !== null && !encoded) setTotal(Number(length));
      } else throw fail(`Unexpected binary response HTTP ${response.status}`);
      etag = response.headers.get('etag');
      // Express sendFile commonly uses a weak ETag, which is illegal in
      // If-Range. Last-Modified is a valid fallback on that path.
      validator = etag && !etag.startsWith('W/') ? etag : response.headers.get('last-modified');
      // Byte offsets must refer to the actual transfer representation.
      resumable = !encoded && (response.status === 206 || response.headers.get('accept-ranges') === 'bytes');
      report();
      if (!response.body) throw fail('Empty binary response', true);
      reader = response.body.getReader();
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        touch();
        if (total !== null && loaded + value.byteLength > total) throw fail('Asset exceeds declared byte length');
        if (responseEnd !== null && loaded + value.byteLength > responseEnd) throw fail('Response exceeds Content-Range');
        if (bytes) bytes.set(value, loaded);
        else chunks.push(value);
        loaded += value.byteLength;
        report();
      }
      if (responseEnd !== null && loaded !== responseEnd) throw fail('Incomplete range response', true);
      if (total !== null && loaded !== total) {
        // Servers may return a bounded portion of an open-ended range.
        if (responseEnd === loaded) continue;
        throw fail(`Incomplete asset: ${loaded}/${total} bytes`, true);
      }
      if (!bytes) {
        bytes = new Uint8Array(loaded);
        let at = 0;
        for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
        total = loaded;
      }
      signal?.throwIfAborted();
      report();
      return bytes.buffer;
    } catch (error) {
      signal?.throwIfAborted();
      // Protocol/auth errors must not be hidden by retries. Network errors and
      // genuine stalls may resume only from the bytes already committed above.
      if (error.retryable === false) throw error;
      if (++failures > retries) {
        throw new Error(timedOut
          ? `连续 ${idleTimeoutMs / 1000} 秒未收到数据，重试耗尽；已收到 ${loaded}/${total ?? '?'} 字节`
          : `下载失败，重试耗尽；已收到 ${loaded}/${total ?? '?'} 字节：${error.message}`);
      }
      report();
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
    }
  }
}
