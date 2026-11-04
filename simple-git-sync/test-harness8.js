// 测试隐藏 .gitignore/.gitattributes
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const NOTICES = [];
const MODALS = [];
function mkEl(tag) {
  const el = { tag: tag || "div", children: [], style: {}, text: "", _on: {},
    empty() { this.children.length = 0; },
    createEl(t, o) { const c = mkEl(t); c.text = (o && o.text) || ""; c.addClass = () => {}; c.addEventListener = (e, f) => { c._on[e] = f; }; this.children.push(c); return c; },
    createDiv() { const c = mkEl("div"); c.addClass = () => {}; c.addEventListener = (e, f) => { c._on[e] = f; }; this.children.push(c); return c; },
    setText(t) { this.text = String(t); }, setAttr() {}, addClass() {}, addEventListener() {} };
  return el;
}
class Plugin {
  constructor(app, m) { this.app = app; this.manifest = m; }
  addStatusBarItem() { const e = mkEl(); e.setText = (t) => { e.text = String(t); }; return e; }
  registerDomEvent() {} registerInterval() {} addCommand() {} addSettingTab() {}
  async loadData() { return {}; } async saveData() {}
}
class PluginSettingTab { constructor() { this.containerEl = mkEl(); } }
class Setting {} class Modal { constructor(app) { this.app = app; this.contentEl = mkEl(); } open() { MODALS.push(this); if (this.onOpen) this.onOpen(); } close() {} }
class Notice { constructor(m) { NOTICES.push(String(m)); } }
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "obsidian") return { Plugin, PluginSettingTab, Setting, Notice, Modal };
  return orig.apply(this, arguments);
};
const SimpleGitSyncPlugin = require(path.join(__dirname, "main.js"));

const tmp = process.argv[2];
const repoRoot = path.join(tmp, "MyObsidian");
const vault = repoRoot;
const remote = path.join(tmp, "remote.git");
const mkApp = (v) => ({ vault: { adapter: { getBasePath: () => v } }, plugins: {} });
const results = [];
const t = (n, ok, extra) => results.push((ok ? "PASS  " : "FAIL  ") + n + (ok ? "" : " :: " + (extra || "")));
const git = (args, cwd) => execFileSync("git", ["-c", "core.quotepath=false"].concat(args), { cwd: cwd || repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  fs.mkdirSync(path.join(vault, "SIGMOD2027"), { recursive: true });
  fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "simple-git-sync"), { recursive: true });
  fs.writeFileSync(path.join(vault, "SIGMOD2027", "note.md"), "# note\n");
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), "{}");
  fs.writeFileSync(path.join(vault, ".obsidian", "workspace.json"), "{}");
  fs.writeFileSync(path.join(vault, ".obsidian", "plugins", "simple-git-sync", "data.json"), '{"token":"SECRET"}');
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "old\n");
  fs.writeFileSync(path.join(repoRoot, ".gitattributes"), "* -text\n");

  git(["init", "--bare", "-b", "main", remote], tmp);
  git(["init", "-b", "main"], repoRoot);
  git(["config", "user.name", "T"], repoRoot);
  git(["config", "user.email", "t@x.com"], repoRoot);
  // 初始只提交 .gitignore/.gitattributes（模拟迁移前状态）
  // data.json / workspace.json 一开始就不该进仓库
  git(["add", ".gitignore", ".gitattributes"], repoRoot);
  git(["add", "SIGMOD2027", ".obsidian/app.json"], repoRoot);
  git(["commit", "-m", "init"], repoRoot);
  git(["remote", "add", "origin", remote], repoRoot);
  git(["push", "origin", "main"], repoRoot);

  const p = new SimpleGitSyncPlugin(mkApp(vault), {});
  await p.onload();
  p.settings.remoteUrl = remote.replace(/\\/g, "/");
  p.settings.userName = "T"; p.settings.userEmail = "t@x.com";
  p.settings.selectedFolders = ["SIGMOD2027"];

  // --- 初始：.gitxxx 在仓库里 ---
  const before = git(["ls-files"]).trim().split("\n");
  t("初始 .gitignore 在仓库里", before.includes(".gitignore"), JSON.stringify(before));
  t("初始 .gitattributes 在仓库里", before.includes(".gitattributes"), "");

  // --- 执行隐藏 ---
  await p.doHideRepoFiles();

  const after = git(["ls-files"]).trim().split("\n");
  t("隐藏后 .gitignore 不在仓库", !after.includes(".gitignore"), JSON.stringify(after));
  t("隐藏后 .gitattributes 不在仓库", !after.includes(".gitattributes"), "");

  // --- 本地文件仍在 ---
  t(".gitignore 本地文件仍在", fs.existsSync(path.join(repoRoot, ".gitignore")), "");
  t(".gitattributes 本地文件仍在", fs.existsSync(path.join(repoRoot, ".gitattributes")), "");

  // --- info/exclude 写入了规则 ---
  const excludePath = path.join(repoRoot, ".git", "info", "exclude");
  const excludeContent = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  t("info/exclude 包含 simple-git-sync 标记", excludeContent.includes("simple-git-sync"), excludeContent.slice(0, 100));
  t("info/exclude 包含 data.json 规则", excludeContent.includes("data.json"), "");

  // --- 关键：保护规则仍生效 ---
  const checkIgnore = (f) => {
    try { execFileSync("git", ["check-ignore", "-q", f], { cwd: repoRoot, stdio: "ignore" }); return true; }
    catch { return false; }
  };
  t("data.json 仍被忽略", checkIgnore(".obsidian/plugins/simple-git-sync/data.json"), "");
  t("workspace.json 仍被忽略", checkIgnore(".obsidian/workspace.json"), "");
  t(".gitignore 本身被忽略", checkIgnore(".gitignore"), "");

  // --- 再次 commitAll 不会把 .gitxxx 加回来 ---
  fs.writeFileSync(path.join(vault, "SIGMOD2027", "note.md"), "# note 改了\n");
  await p.commitAll("再同步");
  const after2 = git(["ls-files"]).trim().split("\n");
  t("再次同步后 .gitignore 仍不在仓库", !after2.includes(".gitignore"), JSON.stringify(after2));
  t("再次同步后 data.json 没进来", !after2.some((f) => f.includes("data.json")), JSON.stringify(after2));

  // --- 远程验证 ---
  await p.pushWithHint();
  const localHead = git(["rev-parse", "HEAD"]).trim();
  const remoteHead = git(["--git-dir=" + remote, "rev-parse", "main"], tmp).trim();
  console.log("  [调试] 本地 HEAD:", localHead.slice(0, 8), "| 远程 HEAD:", remoteHead.slice(0, 8));
  console.log("  [调试] 本地文件:", JSON.stringify(git(["ls-files"]).trim().split("\n")));
  t("推送后本地与远程 HEAD 一致", localHead === remoteHead, localHead.slice(0,8) + " vs " + remoteHead.slice(0,8));
  const remoteTree = git(["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], tmp).trim().split("\n");
  t("远程无 .gitignore", !remoteTree.includes(".gitignore"), JSON.stringify(remoteTree));
  t("远程无 .gitattributes", !remoteTree.includes(".gitattributes"), "");
  t("远程无 data.json", !remoteTree.some((f) => f.includes("data.json")), "");
  t("远程有笔记", remoteTree.some((f) => f.includes("SIGMOD2027/note.md")), "");

  // --- 重复执行幂等 ---
  const excludeBefore = fs.readFileSync(excludePath, "utf8");
  await p.doHideRepoFiles();
  const excludeAfter = fs.readFileSync(excludePath, "utf8");
  t("重复执行不重复写 exclude", excludeBefore === excludeAfter, "len " + excludeBefore.length + " -> " + excludeAfter.length);

  // 已存在的 Git 仓库直接上传时，也必须先安装本地排除规则。
  const existing = path.join(tmp, "existingVault");
  const existingRemote = path.join(tmp, "existingRemote.git");
  const dataFile = path.join(existing, ".obsidian", "plugins", "simple-git-sync", "data.json");
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, '{"token":"SECRET"}');
  fs.writeFileSync(path.join(existing, "note.md"), "# note\n");
  git(["init", "--bare", "-b", "main", existingRemote], tmp);
  git(["init", "-b", "main", existing], tmp);
  git(["config", "user.name", "T"], existing);
  git(["config", "user.email", "t@x.com"], existing);
  git(["remote", "add", "origin", "https://example.invalid/original.git"], existing);
  const pExisting = new SimpleGitSyncPlugin(mkApp(existing), {});
  await pExisting.onload();
  pExisting.settings.remoteUrl = existingRemote;
  let initRefused = false;
  try { await pExisting.doInit(); } catch (e) { initRefused = /已位于 Git 仓库/.test(e.message); }
  t("初始化不会覆盖已有仓库的 origin", initRefused &&
    git(["remote", "get-url", "origin"], existing).trim() === "https://example.invalid/original.git");
  await pExisting.doUpload();
  const existingFiles = git(["--git-dir=" + existingRemote, "ls-tree", "-r", "--name-only", "main"], tmp);
  t("已有仓库直接上传时令牌文件未进入远程", !existingFiles.includes("data.json"), existingFiles);

  pExisting.settings.branch = "notes";
  fs.writeFileSync(path.join(existing, "note.md"), "# other branch\n");
  await pExisting.doUpload();
  t("已有仓库可推到配置的远程分支", git(["--git-dir=" + existingRemote, "show", "notes:note.md"], tmp).includes("other branch"));

  git(["add", "-f", ".obsidian/plugins/simple-git-sync/data.json"], existing);
  let blocked = false;
  try { await pExisting.commitAll("must not leak"); } catch (e) { blocked = /私有文件已被 Git 跟踪/.test(e.message); }
  t("令牌文件已被跟踪时拒绝继续同步", blocked);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e && e.stack || e); process.exit(2); });
