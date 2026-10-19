/* =========================================================
   服务端落盘自测：node tests/server.test.js
   起一个真的 server.js（临时端口 + 临时数据文件），验证：
     - /api/state 的读写与按 at 合并
     - 墓碑（v:null）删除
     - 进程重启后数据还在
     - 数据文件不会被当静态资源下载
   ========================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');
let pass = 0, fail = 0;
const ok = (name, cond) => cond ? (pass++, console.log('  \u2713 ' + name))
                                : (fail++, console.log('  \u2717 ' + name));
const section = t => console.log('\n' + t);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
function startServer(port, stateFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, String(port)], {
      env: Object.assign({}, process.env, {
        PORT: String(port), HOST: '127.0.0.1', POPIPA_STATE: stateFile
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch (e) {}
        reject(new Error('启动超时\n' + out));
      }
    }, 5000);
    child.stdout.on('data', d => {
      out += d.toString();
      if (!settled && out.indexOf('popipa: http://') >= 0) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('exit', code => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('server 退出：' + code + '\n' + out)); }
    });
  });
}
function stopServer(child) {
  return new Promise(resolve => {
    if (!child || child.killed) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
}
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = data == null ? {} : {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    };
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (data != null) req.write(data);
    req.end();
  });
}
const json = r => { try { return JSON.parse(r.body); } catch (e) { return null; } };

(async () => {
  const port = await freePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'popipa-state-'));
  const stateFile = path.join(tmpDir, 'state.json');
  let child = null;
  try {
    child = await startServer(port, stateFile);

    section('1. 基础读写');
    let r = await request(port, 'GET', '/api/state');
    ok('空服务器返回 200 与空 keys',
       r.status === 200 && json(r) && json(r).ok === true &&
       Object.keys(json(r).keys).length === 0);
    r = await request(port, 'PUT', '/api/state', {
      keys: { 'popipa:u:小明': { v: '{"name":"小明","wrong":{"web-1":1}}', at: 1000 } }
    });
    ok('PUT 返回合并后的数据',
       r.status === 200 && json(r).keys['popipa:u:小明'] &&
       json(r).keys['popipa:u:小明'].at === 1000);
    ok('数据文件已写到磁盘', fs.existsSync(stateFile));
    const disk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    ok('磁盘内容就是刚写的数据',
       disk.keys['popipa:u:小明'].v === '{"name":"小明","wrong":{"web-1":1}}');

    section('2. 按 at 合并');
    r = await request(port, 'PUT', '/api/state', {
      keys: { 'popipa:u:小明': { v: '{"name":"旧副本"}', at: 900 } }
    });
    ok('更旧的写入被忽略', json(r).keys['popipa:u:小明'].v.indexOf('旧副本') < 0);
    r = await request(port, 'PUT', '/api/state', {
      keys: { 'popipa:u:小明': { v: '{"name":"新副本"}', at: 2000 } }
    });
    ok('更新的写入生效', json(r).keys['popipa:u:小明'].v.indexOf('新副本') >= 0);
    ok('保存时留下上一版 .bak', fs.existsSync(stateFile + '.bak'));

    section('3. 删除与过滤');
    r = await request(port, 'PUT', '/api/state', {
      keys: {
        'popipa:u:小明': { v: null, at: 3000 },
        'popipa:user': { v: '"不该落盘"', at: 4000 },
        'popipa:theme': { v: '"dark"', at: 4000 },
        'popipa:progress:x:web': { v: '{"old":1}', at: 4000 },
        'other:key': { v: '"外部键"', at: 4000 }
      }
    });
    const merged = json(r).keys;
    ok('墓碑保留 v:null', merged['popipa:u:小明'].v === null);
    ok('当前登录不落盘', !merged['popipa:user']);
    ok('本机主题不落盘', !merged['popipa:theme']);
    ok('旧版遗留键不落盘', !merged['popipa:progress:x:web']);
    ok('非 popipa 键不落盘', !merged['other:key']);

    section('4. 静态资源与数据文件保护');
    r = await request(port, 'GET', '/');
    ok('首页仍可访问', r.status === 200 && r.body.indexOf('popipa') >= 0);
    r = await request(port, 'GET', '/data/state.json');
    ok('数据文件不能直接下载', r.status === 404);
    r = await request(port, 'GET', '/data/state.json.bak');
    ok('数据文件备份也不能直接下载', r.status === 404);

    section('5. 重启后数据还在');
    await stopServer(child);
    child = await startServer(port, stateFile);
    r = await request(port, 'GET', '/api/state');
    ok('重启后读到同一份数据',
       r.status === 200 && json(r).keys['popipa:u:小明'] &&
       json(r).keys['popipa:u:小明'].v === null);

    section('6. 坏请求与坏文件');
    r = await request(port, 'PUT', '/api/state', '{oops');
    ok('坏 JSON 返回 400', r.status === 400);
    r = await request(port, 'PUT', '/api/state', { nope: 1 });
    ok('缺少 keys 返回 400', r.status === 400);

    const futureAt = Date.now() + 8 * 24 * 60 * 60 * 1000;
    r = await request(port, 'PUT', '/api/state', {
      keys: {
        'popipa:hack': { v: '"x"', at: 5000 },
        'popipa:u:bad/name': { v: '{"x":1}', at: 5000 },
        'popipa:u:坏JSON': { v: 'not-json', at: 5000 },
        'popipa:u:未来': { v: '{"x":1}', at: futureAt }
      }
    });
    const safe = json(r).keys;
    ok('未知 popipa 键被拒绝', !safe['popipa:hack']);
    ok('带路径分隔符的用户键被拒绝', !safe['popipa:u:bad/name']);
    ok('非法 JSON 值与超远未来时间戳被拒绝',
       !safe['popipa:u:坏JSON'] && !safe['popipa:u:未来']);

    await stopServer(child);

    const badFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badFile, '{ this is not json');
    child = await startServer(port, badFile);
    r = await request(port, 'GET', '/api/state');
    ok('数据文件损坏时以空数据启动', r.status === 200 && Object.keys(json(r).keys).length === 0);
    await stopServer(child);

    /* 主文件坏了、备份是好的：应该从 .bak 恢复，不能当空数据 */
    fs.writeFileSync(badFile + '.bak', JSON.stringify({
      version: 1, updatedAt: 1,
      keys: { 'popipa:u:备份': { v: '{"name":"备份"}', at: 1 } }
    }));
    child = await startServer(port, badFile);
    r = await request(port, 'GET', '/api/state');
    ok('主文件损坏时从 .bak 恢复',
       r.status === 200 && json(r).keys['popipa:u:备份'] &&
       json(r).keys['popipa:u:备份'].v.indexOf('备份') >= 0);
  } finally {
    await stopServer(child);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
