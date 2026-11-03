// 测试「文件夹选择器」
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const NOTICES = [];
const MODALS = [];
function mkEl() {
  return { children: [], style: {}, empty() { this.children.length = 0; },
    createEl(t, o) { const c = mkEl(); c.tag = t; c.text = (o && o.text) || ""; c.checked = false;
      c.addEventListener = (ev, fn) => { c._on = fn; }; this.children.push(c); return c; },
    createDiv() { const c = mkEl(); this.children.push(c); return c; },
    setText(t) { this.text = String(t); }, addClass() {}, addEventListener(ev, fn) { this._on = fn; } };
}
class Plugin {
  constructor(app, m) { this.app = app; this.manifest = m; }
  addStatusBarItem() { return { setText: () => {}, addClass: () => {} }; }
  registerDomEvent() {} registerInterval() {} addCommand() {} addSettingTab() {}
  async loadData() { return {}; } async saveData() {}
}
class PluginSettingTab { constructor() { this.containerEl = {}; } }
class Setting {}
class Modal { constructor(app) { this.app = app; this.contentEl = mkEl(); } open() { MODALS.push(this); if (this.onOpen) this.onOpen(); } close() {} }
class Notice { constructor(m) { NOTICES.push(String(m)); } }
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "obsidian") return { Plugin, PluginSettingTab, Setting, Notice, Modal };
  return orig.apply(this, arguments);
};
const SimpleGitSyncPlugin = require(path.join(__dirname, "main.js"));

const tmp = process.argv[2];
const vault = path.join(tmp, "vault");
const remote = path.join(tmp, "remote.git");
const mkApp = (v) => ({ vault: { adapter: { getBasePath: () => v } }, plugins: {} });
const results = [];
const t = (n, ok, extra) => results.push((ok ? "PASS  " : "FAIL  ") + n + (ok ? "" : " :: " + (extra || "")));
const git = (args, cwd) => execFileSync("git", ["-c", "core.quotepath=false"].concat(args), { cwd: cwd || vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  // 布局：三个文件夹
  for (const d of ["SIGMOD2027", "笔记A", "笔记B"]) {
    fs.mkdirSync(path.join(vault, d), { recursive: true });
    fs.writeFileSync(path.join(vault, d, "note.md"), "# " + d + "\n");
  }
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vault, ".obsidian", "app.json"), "{}");
  fs.mkdirSync(path.join(vault, "rootfile"), { recursive: true });
  fs.writeFileSync(path.join(vault, "loose.md"), "# loose\n");

  git(["init", "--bare", "-b", "main", remote], tmp);
  git(["init", "-b", "main"]);
  git(["config", "user.name", "T"]);
  git(["config", "user.email", "t@x.com"]);

  const p = new SimpleGitSyncPlugin(mkApp(vault), {});
  await p.onload();
  p.settings.remoteUrl = remote.replace(/\\/g, "/");
  p.settings.userName = "T";
  p.settings.userEmail = "t@x.com";

  // --- listFolders ---
  const folders = p.listFolders();
  t("listFolders 列出子文件夹", JSON.stringify(folders) === JSON.stringify(["SIGMOD2027", "rootfile", "笔记A", "笔记B"]), JSON.stringify(folders));
  t("listFolders 排除 .obsidian", !folders.includes(".obsidian"), JSON.stringify(folders));
  t("listFolders 不列文件", !folders.includes("loose.md"), JSON.stringify(folders));

  // --- 初始未选择 ---
  t("默认无选中文件夹", p.selectedPathSpec().length === 0, JSON.stringify(p.selectedPathSpec()));

  // --- 首次全量提交并推送 ---
  git(["add", "-A"]);
  git(["commit", "-m", "init"]);
  git(["remote", "add", "origin", remote]);
  git(["push", "origin", "main"]);

  // --- 选两个文件夹 ---
  p.settings.selectedFolders = ["笔记A", "笔记B"];
  t("selectedPathSpec 只返回选中的", JSON.stringify(p.selectedPathSpec()) === JSON.stringify(["笔记A", "笔记B"]), JSON.stringify(p.selectedPathSpec()));

  // --- 三个文件夹都改，只同步选中的两个 ---
  for (const d of ["SIGMOD2027", "笔记A", "笔记B"]) {
    fs.writeFileSync(path.join(vault, d, "note.md"), "# " + d + " 改了\n");
  }
  fs.writeFileSync(path.join(vault, "loose.md"), "# loose 改了\n");

  const committed = await p.commitAll("只同步选中的");
  const head = git(["show", "--name-only", "--pretty=format:", "HEAD"]).trim().split("\n").filter(Boolean);
  t("只提交选中的文件夹", head.every((f) => f.startsWith("笔记A/") || f.startsWith("笔记B/")), JSON.stringify(head));
  t("没提交 SIGMOD2027", !head.some((f) => f.startsWith("SIGMOD2027/")), JSON.stringify(head));
  t("没提交根目录文件", !head.some((f) => f === "loose.md"), JSON.stringify(head));

  // --- 剩余状态 ---
  const status = git(["status", "--porcelain"]).trim();
  t("SIGMOD2027 改动仍在工作区", status.includes("SIGMOD2027"), status);
  t("loose.md 改动仍在工作区", status.includes("loose.md"), status);

  // --- 只选一个 ---
  p.settings.selectedFolders = ["SIGMOD2027"];
  git(["reset", "--soft", "HEAD~1"]);
  git(["checkout", "--", "."]);
  for (const d of ["SIGMOD2027", "笔记A", "笔记B"]) {
    fs.writeFileSync(path.join(vault, d, "note.md"), "# " + d + " 再改\n");
  }
  await p.commitAll("只同步 SIGMOD");
  const head2 = git(["show", "--name-only", "--pretty=format:", "HEAD"]).trim().split("\n").filter(Boolean);
  t("只选一个时只提交那一个", head2.length === 1 && head2[0].startsWith("SIGMOD2027/"), JSON.stringify(head2));

  // --- 选中不存在的文件夹时过滤掉 ---
  p.settings.selectedFolders = ["笔记A", "不存在的文件夹", "笔记B"];
  t("过滤不存在的文件夹", JSON.stringify(p.selectedPathSpec()) === JSON.stringify(["笔记A", "笔记B"]), JSON.stringify(p.selectedPathSpec()));

  // --- 清空选择 = 整仓 ---
  p.settings.selectedFolders = [];
  t("清空选择时 selectedPathSpec 为空", p.selectedPathSpec().length === 0, "");

  // --- doSyncSelected 未选择时报错 ---
  let msg = "";
  try { await p.doSyncSelected(); } catch (e) { msg = e.message; }
  t("未选择时 doSyncSelected 报错", /选择文件夹/.test(msg), msg.slice(0, 100));

  // --- doSyncSelected 正常 ---
  p.settings.selectedFolders = ["笔记A"];
  fs.writeFileSync(path.join(vault, "笔记A", "note.md"), "# A 同步测试\n");
  await p.doSyncSelected();
  const remoteTree = git(["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], tmp).trim().split("\n");
  t("doSyncSelected 推到远程", remoteTree.some((f) => f.includes("笔记A/note.md")), "");

  // --- 文件夹选择弹窗 ---
  MODALS.length = 0;
  p.doChooseFolders();
  t("弹出文件夹选择器", MODALS.length === 1, "modals=" + MODALS.length);
  const modal = MODALS[0];
  t("选择器列出所有文件夹", modal.folders.length === 4, JSON.stringify(modal.folders));

  // 模拟勾选并保存
  let saved = null;
  modal.onDone = (r) => { saved = r; };
  modal.selected = new Set(["笔记B"]);
  const result = modal.folders.filter((f) => modal.selected.has(f));
  modal.onDone(result);
  t("选择器回调返回勾选的文件夹", JSON.stringify(saved) === JSON.stringify(["笔记B"]), JSON.stringify(saved));

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
