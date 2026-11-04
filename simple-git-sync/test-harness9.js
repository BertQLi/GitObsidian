// 更新器回归：可信来源、完整性、失败恢复和设置保留。无真实网络请求。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { createHash } = require('crypto');
const notices = [];
let responder;
const el = () => ({ style: {}, setText() {}, setAttr() {}, addClass() {} });
class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  async loadData() { return { autoUpdate: false, token: 'local-test-secret' }; }
  async saveData() {}
  addStatusBarItem() { return el(); }
  registerDomEvent() {} addCommand() {} addSettingTab() {} registerInterval() {}
}
const orig = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'obsidian') return { Plugin, PluginSettingTab: class {}, Setting: class {}, Modal: class {},
    Notice: class { constructor(text) { notices.push(text); } },
    requestUrl: async (req) => responder(req), requireApiVersion: (v) => Number(v.split('.')[0]) <= 1 };
  return orig.apply(this, arguments);
};
const Sync = require('./main.js');
const root = process.argv[2];
let fixtureId = 0;
const results = [];
const test = async (name, fn) => { try { await fn(); results.push('PASS  '+name); } catch (e) { results.push('FAIL  '+name+' :: '+e.message); } };
function release(version, overrides = {}) {
  const tag = 'v'+version;
  const bytes = {
    'main.js': Buffer.from('module.exports = class UpdatedPlugin {};\n'),
    'manifest.json': Buffer.from(JSON.stringify({ id: 'simple-git-sync', version, minAppVersion: '1.0.0', ...overrides }))
  };
  const data = { tag_name: tag, assets: Object.entries(bytes).map(([name, b]) => ({ name, size: b.length,
    digest: 'sha256:'+createHash('sha256').update(b).digest('hex'),
    browser_download_url: 'https://github.com/BertQLi/GitObsidian/releases/download/'+tag+'/'+name })) };
  return { data, bytes };
}
function serve(pkg, calls = []) {
  responder = (req) => {
    calls.push(req);
    if (new URL(req.url).pathname.endsWith('/latest/download/update.json')) return { status: 200, json: pkg.data };
    const name = req.url.split('/').pop();
    const b = pkg.bytes[name];
    return { status: b ? 200 : 404, arrayBuffer: b };
  };
}
async function fixture(version = '0.9.0') {
  const vault = path.join(root, 'case-'+(++fixtureId));
  const dir = path.join(vault, '.obsidian/plugins/simple-git-sync');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir,'main.js'), 'module.exports = class PreviousPlugin {};\n');
  fs.writeFileSync(path.join(dir,'manifest.json'), JSON.stringify({ id: 'simple-git-sync', version }));
  fs.writeFileSync(path.join(dir,'data.json'), '{"token":"keep-me"}');
  fs.writeFileSync(path.join(dir,'styles.css'), '/* old */');
  const p = new Sync({ vault: { adapter: { getBasePath: () => vault } }, plugins: {} }, { id:'simple-git-sync', version });
  await p.onload();
  return { p, dir, old: fs.readFileSync(path.join(dir,'main.js'),'utf8') };
}
const intact = (f) => fs.readFileSync(path.join(f.dir,'main.js'),'utf8') === f.old &&
  JSON.parse(fs.readFileSync(path.join(f.dir,'data.json'),'utf8')).token === 'keep-me';
(async () => {
  await test('按数字比较版本：0.10.0 比 0.9.0 新', async () => {
    const f = await fixture(); const pkg = release('0.10.0'); const calls = []; serve(pkg,calls);
    await f.p.checkForUpdates(false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'manifest.json'))).version,'0.10.0');
    assert(calls.every((r) => !r.headers || !r.headers.Authorization));
    assert(!JSON.stringify(calls).includes('local-test-secret'));
    assert.equal(fs.readFileSync(path.join(f.dir,'.update-backup/main.js'),'utf8'),f.old);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'data.json'))).token,'keep-me');
    assert(!fs.existsSync(path.join(f.dir,'styles.css')));
  });
  await test('旧版本不会覆盖较新安装版本', async () => {
    const f = await fixture('0.10.0'); const calls=[]; serve(release('0.9.0'),calls);
    await f.p.checkForUpdates(false); assert.equal(calls.length,1); assert(intact(f));
  });
  await test('损坏的下载拒绝安装', async () => {
    const f=await fixture(); const pkg=release('0.10.0'); pkg.bytes['main.js']=Buffer.from('corrupt'); serve(pkg);
    await assert.rejects(f.p.checkForUpdates(false),/文件大小异常|校验失败/); assert(intact(f));
  });
  await test('其他仓库的资源链接拒绝下载', async () => {
    const f=await fixture(); const pkg=release('0.10.0'); pkg.data.assets[0].browser_download_url='https://evil.invalid/main.js'; serve(pkg);
    await assert.rejects(f.p.checkForUpdates(false),/来源/); assert(intact(f));
  });
  await test('缺少发布文件时保留旧版本', async () => {
    const f=await fixture(); const pkg=release('0.10.0'); pkg.data.assets.pop(); serve(pkg);
    await assert.rejects(f.p.checkForUpdates(false),/缺少/); assert(intact(f));
  });
  await test('插件 ID 不匹配时保留旧版本', async () => {
    const f=await fixture(); serve(release('0.10.0',{id:'another-plugin'}));
    await assert.rejects(f.p.checkForUpdates(false),/ID 或版本不匹配/); assert(intact(f));
  });
  await test('Obsidian 版本过低时拒绝更新', async () => {
    const f=await fixture(); serve(release('0.10.0',{minAppVersion:'9.0.0'}));
    await assert.rejects(f.p.checkForUpdates(false),/需要 Obsidian/); assert(intact(f));
  });
  await test('JavaScript 语法错误不会替换插件', async () => {
    const f=await fixture(); const pkg=release('0.10.0'); pkg.bytes['main.js']=Buffer.from('function (');
    pkg.data.assets[0].size=pkg.bytes['main.js'].length;
    pkg.data.assets[0].digest='sha256:'+createHash('sha256').update(pkg.bytes['main.js']).digest('hex'); serve(pkg);
    await assert.rejects(f.p.checkForUpdates(false),SyntaxError); assert(intact(f));
  });
  await test('部分替换写入失败后恢复旧文件', async () => {
    const f=await fixture(); serve(release('0.10.0')); const rename=fs.renameSync;
    fs.renameSync=(from,to) => { if(to.endsWith('manifest.json')) throw new Error('disk failure'); return rename(from,to); };
    try { await assert.rejects(f.p.checkForUpdates(false),/恢复上一版/); } finally { fs.renameSync=rename; }
    assert(intact(f)); assert(fs.existsSync(path.join(f.dir,'styles.css')));
    assert(!fs.readdirSync(f.dir).some((name)=>name.endsWith('.tmp')));
  });
  await test('新版重载失败时恢复并重新启用旧版', async () => {
    const f=await fixture(); serve(release('0.10.0')); let enabled=0;
    f.p.app.plugins={ disablePlugin:async()=>{}, enablePlugin:async()=>{if(++enabled===1)throw new Error('load failure');} };
    await assert.rejects(f.p.checkForUpdates(false),/恢复上一版/); assert.equal(enabled,2); assert(intact(f));
  });
  await test('成功重载后保留用户设置', async () => {
    const f=await fixture(); serve(release('0.10.0')); let enabled=0;
    f.p.app.plugins={disablePlugin:async()=>f.p.onunload(),enablePlugin:async()=>enabled++};
    await f.p.checkForUpdates(false); assert.equal(enabled,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'data.json'))).token,'keep-me');
  });
  await test('没有 Release 时友好返回', async () => {
    const f=await fixture(); responder=()=>({status:404}); await f.p.checkForUpdates(false); assert(intact(f));
  });
  await test('同步进行中时自动更新延后', async () => {
    const f=await fixture(); f.p.syncing=true; let called=false; responder=()=>{called=true;throw Error('should not call');};
    await f.p.checkForUpdates(true); assert(!called);
  });
  await test('后台检查完成后面板恢复可操作状态', async () => {
    const f=await fixture('0.10.0'); serve(release('0.10.0')); const rendered=[];
    f.p.panels.add({render:()=>rendered.push(f.p.updating)});
    await f.p.checkForUpdates(true);
    assert.equal(rendered[0],true); assert.equal(rendered[rendered.length-1],false);
  });
  console.log(results.join('\n'));
  const failed=results.filter((r)=>r.startsWith('FAIL')).length;
  console.log('\n=== '+(results.length-failed)+'/'+results.length+' passed ===');
  process.exit(failed?1:0);
})().catch((e)=>{ console.error(e);process.exit(2); });
