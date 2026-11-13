import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {downloadArrayBuffer} from '../web/asset-loader.v3.mjs';

const body = Uint8Array.from({length: 1000}, (_, i) => i % 251);
const headers = {'Content-Type': 'application/octet-stream', 'Content-Length': body.length,
  'Accept-Ranges': 'bytes', ETag: '"same"'};
async function serverTest(t, handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await run(`http://127.0.0.1:${server.address().port}/asset.bin`);
}

test('active stream may exceed inactivity timeout many times without being aborted', async t => {
  await serverTest(t, async (req, res) => {
    res.writeHead(200, headers);
    for (let at = 0; at < body.length; at += 100) { res.write(body.slice(at, at + 100)); await delay(30); }
    res.end();
  }, async url => {
    const progress = [];
    const result = await downloadArrayBuffer(url, {idleTimeoutMs: 120, onProgress: p => progress.push(p.loaded)});
    assert.deepEqual(new Uint8Array(result), body);
    assert.ok(progress.length > 3);
    assert.equal(progress.at(-1), body.length);
  });
});

for (const weak of [false, true]) test(`midstream disconnect resumes exact bytes (weak ETag=${weak})`, async t => {
  const requests = [];
  const hs = {...headers, ETag: weak ? 'W/"same"' : '"same"', 'Last-Modified': 'Thu, 12 Nov 2026 04:01:51 GMT'};
  await serverTest(t, async (req, res) => {
    requests.push(req.headers);
    if (!req.headers.range) {
      res.writeHead(200, hs); res.write(body.slice(0,400)); await delay(40); res.destroy();
    } else {
      assert.equal(req.headers.range, 'bytes=400-');
      assert.equal(req.headers['if-range'], weak ? hs['Last-Modified'] : hs.ETag);
      res.writeHead(206, {...hs, 'Content-Length': 600, 'Content-Range': 'bytes 400-999/1000'});
      res.end(body.slice(400));
    }
  }, async url => {
    assert.deepEqual(new Uint8Array(await downloadArrayBuffer(url, {expectedBytes:1000})), body);
    assert.equal(requests.length, 2);
  });
});

test('stalled read resumes, user cancellation never retries', async t => {
  let requests = 0;
  await serverTest(t, (req, res) => {
    requests++;
    if (!req.headers.range) { res.writeHead(200,headers); res.write(body.slice(0,400)); }
    else {
      res.writeHead(206,{...headers,'Content-Length':600,'Content-Range':'bytes 400-999/1000'});
      res.end(body.slice(400));
    }
  }, async url => {
    assert.deepEqual(new Uint8Array(await downloadArrayBuffer(url,{idleTimeoutMs:100})),body);
    assert.equal(requests,2);
    const ac = new AbortController();
    const pending = downloadArrayBuffer(url,{signal:ac.signal});
    await delay(30); ac.abort();
    await assert.rejects(pending, {name:'AbortError'});
    assert.equal(requests,3);
  });
});

test('ignored range safely restarts and does not append duplicates', async t => {
  let requests = 0;
  await serverTest(t, async (req,res) => {
    requests++;
    res.writeHead(200,headers);
    if (requests === 1) { res.write(body.slice(0,400)); await delay(40); res.destroy(); }
    else res.end(body);
  },async url => {
    assert.deepEqual(new Uint8Array(await downloadArrayBuffer(url)),body);
    assert.equal(requests,2);
  });
});

test('unknown initial length is retained when resume first supplies total size', async t => {
  await serverTest(t,async(req,res) => {
    if (!req.headers.range) {
      const hs = {...headers}; delete hs['Content-Length'];
      res.writeHead(200,hs); res.write(body.slice(0,400)); await delay(40); res.destroy();
    } else {
      res.writeHead(206,{...headers,'Content-Length':600,'Content-Range':'bytes 400-999/1000'});
      res.end(body.slice(400));
    }
  },async url => assert.deepEqual(new Uint8Array(await downloadArrayBuffer(url)),body));
});

test('mismatched ranges fail without returning mixed bytes', async t => {
  let requests = 0;
  await serverTest(t,async(req,res) => {
    requests++;
    if (!req.headers.range) { res.writeHead(200,headers); res.write(body.slice(0,400)); await delay(40); res.destroy(); }
    else { res.writeHead(206,{...headers,'Content-Length':600,'Content-Range':'bytes 399-998/1000'}); res.end(body.slice(400)); }
  },async url => {
    await assert.rejects(downloadArrayBuffer(url),/Invalid resume Content-Range/);
    assert.equal(requests,2);
  });
});

test('changed ETag on a resumed response is rejected', async t => {
  await serverTest(t,async(req,res) => {
    if (!req.headers.range) { res.writeHead(200,headers); res.write(body.slice(0,400)); await delay(40); res.destroy(); }
    else {
      res.writeHead(206,{...headers,ETag:'"changed"','Content-Length':600,'Content-Range':'bytes 400-999/1000'});
      res.end(body.slice(400));
    }
  },async url => await assert.rejects(downloadArrayBuffer(url),/Asset changed during resume/));
});

test('server-bounded range responses finish all remaining bytes', async t => {
  await serverTest(t,async(req,res) => {
    if (!req.headers.range) { res.writeHead(200,headers); res.write(body.slice(0,400)); await delay(40); res.destroy(); }
    else {
      const start = Number(/bytes=(\d+)-/.exec(req.headers.range)[1]);
      const end = Math.min(start+300,body.length);
      res.writeHead(206,{...headers,'Content-Length':end-start,'Content-Range':`bytes ${start}-${end-1}/1000`});
      res.end(body.slice(start,end));
    }
  },async url => assert.deepEqual(new Uint8Array(await downloadArrayBuffer(url)),body));
});

test('permanent HTTP error and metadata size mismatch do not retry', async t => {
  let requests = 0;
  await serverTest(t,(req,res) => {
    requests++;
    if (req.url.includes('missing')) { res.writeHead(404); res.end(); }
    else { res.writeHead(200,headers); res.end(body); }
  },async url => {
    await assert.rejects(downloadArrayBuffer(url+'?missing'),/HTTP 404/);
    await assert.rejects(downloadArrayBuffer(url,{expectedBytes:999}),/length mismatch/);
    assert.equal(requests,2);
  });
});

test('retry exhaustion is finite and includes received byte counts', async t => {
  let requests = 0;
  await serverTest(t,(req,res) => { requests++; res.writeHead(503); res.end(); },async url => {
    await assert.rejects(downloadArrayBuffer(url,{retries:2}),/重试耗尽.*0\/\?/);
    assert.equal(requests,3);
  });
});
