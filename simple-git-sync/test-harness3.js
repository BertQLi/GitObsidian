// 测试「限定目录同步」：笔记同步不碰 plugins/
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const NOTICES = [];
class Plugin {
  constructor(app, m) { this.app = app; this.manifest = m; }
  addStatusBarItem() { return { setText: () => {}, setAttr: () => {}, addClass: () => {} }; }
  registerDomEvent() {} registerInterval() {} addCommand() {} addSettingTab() {}
  async loadData() { return this._data || {}; }
  async saveData(d) { this._data = d; }
}
class PluginSettingTab { constructor() { this.containerEl = {}; } }
class Setting {} class Modal {} class Notice { constructor(m) { NOTICES.push(String(m)); } }
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "obsidian") return { Plugin, PluginSettingTab, Setting, Notice, Modal };
  return orig.apply(this, arguments);
};
const SimpleGitSyncPlugin = require(path.join(__dirname, "main.js"));

const tmp = process.argv[2];
const vault = path.join(tmp, "vault");
const remote = path.join(tmp, "remote.git");
const mkApp = (v) => ({ vault: { adapter: { getBasePath: () => v } } });
const results = [];
const t = (n, ok, extra) => results.push((ok ? "PASS  " : "FAIL  ") + n + (ok ? "" : " :: " + (extra || "")));
const git = (args, cwd) => execFileSync("git", ["-c", "core.quotepath=false"].concat(args), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  // 布局：notes/我的笔记1、notes/我的笔记2、plugins/simple-git-sync、.obsidian
  fs.mkdirSync(path.join(vault, "notes", "我的笔记1"), { recursive: true });
  fs.mkdirSync(path.join(vault, "notes", "我的笔记2"), { recursive: true });
  fs.mkdirSync(path.join(vault, "plugins", "simple-git-sync"), { recursive: true });
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vault, "notes", "我的笔记1", "a.md"), "# 笔记1\n");
  fs.writeFileSync(path.join(vault, "notes", "我的笔记2", "b.md"), "# 笔记2\n");
  fs.writeFileSync(path.join(vault, "plugins", "simple-git-sync", "main.js"), "// plugin\n");
  fs.writeFileSync(path.join(vault, "plugins", "simple-git-sync", "README.md"), "# readme\n");
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), "{}");

  git(["init", "--bare", "-b", "main", remote], tmp);

  const p = new SimpleGitSyncPlugin(mkApp(vault), {});
  await p.onload();
  p.settings.remoteUrl = remote.replace(/\\/g, "/");
  p.settings.userName = "T"; p.settings.userEmail = "t@x.com";
  p.settings.syncPaths = "notes\n.obsidian";

  // 首次：整体上传（用 doInit 会按 syncPaths 提交，所以先把插件也提交进去）
  await p.runGit(["init"]);
  await p.runGit(["symbolic-ref", "HEAD", "refs/heads/main"]);
  await p.runGit(["config", "user.name", "T"]);
  await p.runGit(["config", "user.email", "t@x.com"]);
  await p.runGit(["add", "-A"]);
  await p.runGit(["commit", "-m", "init all"]);
  await p.runGit(["remote", "add", "origin", remote]);
  await p.runGit(["push", "origin", "main"]);

  // 现在：同时改笔记和插件，然后跑 doSync，应只提交笔记
  fs.writeFileSync(path.join(vault, "notes", "我的笔记1", "a.md"), "# 笔记1 改过了\n");
  fs.writeFileSync(path.join(vault, "plugins", "simple-git-sync", "main.js"), "// plugin changed\n");

  await p.doSync(false);

  const head = git(["show", "--name-only", "--pretty=format:", "HEAD"], vault).trim().split("\n").filter(Boolean);
  t("同步只提交了笔记目录", head.some((f) => f.includes("我的笔记1")), JSON.stringify(head));
  t("同步没有提交 plugins/", !head.some((f) => f.startsWith("plugins/")), JSON.stringify(head));

  const status = git(["status", "--porcelain"], vault).trim();
  t("plugins/ 改动仍留在工作区未提交", status.includes("plugins/simple-git-sync/main.js"), status);

  // 远程内容核对
  const remoteFiles = git(["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], tmp).trim().split("\n");
  t("远程有笔记", remoteFiles.some((f) => f.includes("我的笔记1/a.md")), JSON.stringify(remoteFiles));
  t("远程有插件（首次提交进去的）", remoteFiles.some((f) => f.includes("plugins/simple-git-sync/main.js")));

  // 模拟 Mac 端改了笔记，本端 doDownload 应拉到
  const other = path.join(tmp, "other");
  git(["clone", remote, other], tmp);
  fs.writeFileSync(path.join(other, "notes", "我的笔记2", "c.md"), "# mac 新增\n");
  git(["add", "-A"], other);
  git(["-c", "user.name=M", "-c", "user.email=m@x.com", "commit", "-m", "mac note"], other);
  git(["push", "origin", "main"], other);
  await p.doDownload();
  t("doDownload 拉到另一端的笔记", fs.existsSync(path.join(vault, "notes", "我的笔记2", "c.md")));

  // syncPaths 留空 = 整仓
  p.settings.syncPaths = "";
  t("syncPaths 留空时 pathSpec 为空（=整仓）", p.pathSpec().length === 0, JSON.stringify(p.pathSpec()));

  // 多个路径
  p.settings.syncPaths = "notes\n.obsidian\n\n  ";
  t("pathSpec 过滤空行", p.pathSpec().length === 2, JSON.stringify(p.pathSpec()));

  // 关键回归：.obsidian 开头的点不能被剥掉
  p.settings.syncPaths = ".obsidian";
  t("pathSpec 保留 .obsidian 的点", JSON.stringify(p.pathSpec()) === JSON.stringify([".obsidian"]), JSON.stringify(p.pathSpec()));

  p.settings.syncPaths = "./notes/";
  t("pathSpec 去掉 ./ 和尾部斜杠", JSON.stringify(p.pathSpec()) === JSON.stringify(["notes"]), JSON.stringify(p.pathSpec()));

  // 目录不存在时不应出现在 pathspec 里（否则 git add 会 fatal）
  p.settings.syncPaths = "notes\n不存在的目录";
  t("pathSpec 过滤不存在的目录", JSON.stringify(p.pathSpec()) === JSON.stringify(["notes"]), JSON.stringify(p.pathSpec()));

  // 配置了范围但目录全不存在时必须停止，不能误传整仓
  const emptyVault = path.join(tmp, "emptyvault");
  fs.mkdirSync(emptyVault, { recursive: true });
  fs.writeFileSync(path.join(emptyVault, "x.md"), "# x\n");
  const remote3 = path.join(tmp, "remote3.git");
  git(["init", "--bare", "-b", "main", remote3], tmp);
  const p3 = new SimpleGitSyncPlugin(mkApp(emptyVault), {});
  await p3.onload();
  p3.settings.remoteUrl = remote3.replace(/\\/g, "/");
  p3.settings.userName = "T"; p3.settings.userEmail = "t@x.com";
  p3.settings.syncPaths = "notes";
  try {
    await p3.doInit();
    t("配置的目录都不存在时停止提交", false, "意外成功");
  } catch (e) {
    t("配置的目录都不存在时停止提交", /同步文件夹不存在/.test(e.message), e.message);
  }
  t("范围不存在时根目录文件未提交", git(["status", "--porcelain"], emptyVault).includes("x.md"));
  await p3.doDownload();
  t("空远程不会误报已下载", p3.settings.lastSyncResult === "远程暂无可下载内容", p3.settings.lastSyncResult);

  p.settings.syncPaths = "../plugins";
  let invalidPath = false;
  try { p.pathSpec(); } catch (e) { invalidPath = /无效路径/.test(e.message); }
  t("拒绝越出 vault 的同步路径", invalidPath);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
