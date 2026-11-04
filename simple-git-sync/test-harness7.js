// 一 vault 一仓库：拒绝父仓库；克隆后的 vault 自动发现 origin。
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const MODALS = [];
function mkEl(tag) {
  return { tag: tag || "div", children: [], style: {}, text: "",
    empty() { this.children.length = 0; },
    createEl(t, o) { const c = mkEl(t); c.text = (o && o.text) || ""; this.children.push(c); return c; },
    createDiv() { const c = mkEl("div"); this.children.push(c); return c; },
    setText(t) { this.text = String(t); }, setAttr() {}, addClass() {}, addEventListener() {} };
}
class Plugin {
  constructor(app, m) { this.app = app; this.manifest = m; }
  addStatusBarItem() { return mkEl(); }
  registerDomEvent() {} registerInterval() {} addCommand() {} addSettingTab() {}
  async loadData() { return {}; } async saveData() {}
}
class PluginSettingTab { constructor() { this.containerEl = mkEl(); } }
class Setting {} class Modal {
  constructor(app) { this.app = app; this.contentEl = mkEl(); }
  open() { MODALS.push(this); if (this.onOpen) this.onOpen(); }
  close() {}
}
class Notice {}
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "obsidian") return { Plugin, PluginSettingTab, Setting, Notice, Modal };
  return orig.apply(this, arguments);
};
const SimpleGitSyncPlugin = require(path.join(__dirname, "main.js"));

const tmp = process.argv[2];
const mkApp = (v) => ({ vault: { adapter: { getBasePath: () => v } }, plugins: {} });
const results = [];
const t = (name, ok, extra) => results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " :: " + (extra || "")));
const git = (args, cwd) => execFileSync("git", ["-c", "core.quotepath=false"].concat(args),
  { cwd: cwd || tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  const parent = path.join(tmp, "parent-repo");
  const vaultA = path.join(parent, "vaultA");
  const vaultB = path.join(parent, "vaultB");
  fs.mkdirSync(vaultA, { recursive: true });
  fs.mkdirSync(vaultB, { recursive: true });
  fs.writeFileSync(path.join(vaultA, "note.md"), "# A\n");
  fs.writeFileSync(path.join(vaultB, "note.md"), "# B\n");
  git(["init", "-b", "main", parent]);
  git(["config", "user.name", "T"], parent);
  git(["config", "user.email", "t@x.com"], parent);
  git(["add", "-A"], parent);
  git(["commit", "-m", "old layout"], parent);
  git(["remote", "add", "origin", "https://example.invalid/old.git"], parent);
  const originalHead = git(["rev-parse", "HEAD"], parent).trim();

  const pA = new SimpleGitSyncPlugin(mkApp(vaultA), {});
  await pA.onload();
  pA.settings.remoteUrl = path.join(tmp, "unused.git");
  t("父仓库不算当前 vault 的仓库", pA.isRepo() === false);
  t("检测到父仓库位置", fs.realpathSync(pA._repoRoot) === fs.realpathSync(parent));
  let blockedUpload = false;
  try { await pA.doUpload(); } catch (e) { blockedUpload = /独立 Git 仓库/.test(e.message); }
  t("上传不会操作父仓库", blockedUpload);
  let blockedInit = false;
  try { await pA.doInit(); } catch (e) { blockedInit = /父目录的 Git 仓库/.test(e.message); }
  t("初始化不会在父仓库内嵌套建仓", blockedInit && !fs.existsSync(path.join(vaultA, ".git")));
  t("父仓库的提交和 origin 未改变", git(["rev-parse", "HEAD"], parent).trim() === originalHead &&
    git(["remote", "get-url", "origin"], parent).trim() === "https://example.invalid/old.git");
  pA.showStatus();
  const texts = [];
  (function walk(el) { if (el.text) texts.push(el.text); (el.children || []).forEach(walk); })(MODALS[0].contentEl);
  t("操作面板提示拆分父仓库", texts.join(" ").includes("父仓库"));

  const remote = path.join(tmp, "notes.git");
  const first = path.join(tmp, "notes-first");
  const second = path.join(tmp, "notes-second");
  fs.mkdirSync(first, { recursive: true });
  fs.writeFileSync(path.join(first, "note.md"), "# first\n");
  git(["init", "--bare", "-b", "main", remote]);
  git(["init", "-b", "main", first]);
  git(["config", "user.name", "T"], first);
  git(["config", "user.email", "t@x.com"], first);
  git(["remote", "add", "origin", remote], first);
  const pFirst = new SimpleGitSyncPlugin(mkApp(first), {});
  await pFirst.onload();
  t("vault 根是独立仓库", pFirst.isRepo() && fs.realpathSync(pFirst._repoRoot) === fs.realpathSync(first));
  t("自动读取本地 origin", pFirst.settings.remoteUrl === remote, pFirst.settings.remoteUrl);
  await pFirst.doUpload();

  git(["clone", remote, second]);
  git(["config", "user.name", "T"], second);
  git(["config", "user.email", "t@x.com"], second);
  const pSecond = new SimpleGitSyncPlugin(mkApp(second), {});
  await pSecond.onload();
  t("克隆后的 vault 自动读取 origin", pSecond.settings.remoteUrl === remote, pSecond.settings.remoteUrl);

  fs.writeFileSync(path.join(first, "note.md"), "# from first\n");
  await pFirst.doUpload();
  await pSecond.doDownload();
  t("第二台设备下载第一台的改动", fs.readFileSync(path.join(second, "note.md"), "utf8").includes("from first"));

  fs.writeFileSync(path.join(second, "note.md"), "# from second\n");
  await pSecond.doSync(false);
  await pFirst.doDownload();
  t("第一台设备下载第二台的改动", fs.readFileSync(path.join(first, "note.md"), "utf8").includes("from second"));

  git(["remote", "set-url", "origin", "https://me:fake-token@example.invalid/notes.git"], second);
  pSecond.settings.remoteUrl = "";
  await pSecond.loadRemoteFromOrigin();
  t("origin URL 中的凭据不会保存到插件设置", pSecond.settings.remoteUrl === "https://example.invalid/notes.git");

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e && e.stack || e); process.exit(2); });
