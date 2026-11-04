// 测试操作面板（状态栏点开的 ControlPanelModal）
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const NOTICES = [];
const MODALS = [];

// 更完整的 DOM mock，支持记录按钮文字
function mkEl(tag) {
  const el = {
    tag: tag || "div",
    children: [],
    style: {},
    text: "",
    title: "",
    checked: false,
    _on: {},
    empty() { this.children.length = 0; },
    createEl(t, o) {
      const c = mkEl(t);
      c.text = (o && o.text) || "";
      c.addClass = () => {};
      c.addEventListener = (ev, fn) => { c._on[ev] = fn; };
      this.children.push(c);
      return c;
    },
    createDiv() { const c = mkEl("div"); c.addClass = () => {}; c.addEventListener = (ev, fn) => { c._on[ev] = fn; }; this.children.push(c); return c; },
    setText(t) { this.text = String(t); },
    setAttr(k, v) { this[k] = v; },
    addClass() {},
    addEventListener(ev, fn) { this._on[ev] = fn; },
  };
  return el;
}

class Plugin {
  constructor(app, m) { this.app = app; this.manifest = m; }
  addStatusBarItem() {
    const el = mkEl("div");
    el.setText = (t) => { el.text = String(t); };
    el.addClass = () => {};
    return el;
  }
  registerDomEvent() {} registerInterval() {} addCommand() {} addSettingTab() {}
  async loadData() { return {}; } async saveData() {}
}
class PluginSettingTab { constructor() { this.containerEl = mkEl(); } }
class Setting {}
class Modal {
  constructor(app) { this.app = app; this.contentEl = mkEl(); }
  open() { MODALS.push(this); if (this.onOpen) this.onOpen(); }
  close() { if (this.onClose) this.onClose(); }
}
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

// 递归收集所有按钮文字
function collectButtons(el, out) {
  out = out || [];
  if (el.tag === "button" && el.text) out.push(el.text);
  (el.children || []).forEach((c) => collectButtons(c, out));
  return out;
}
function collectTexts(el, out) {
  out = out || [];
  if (el.text) out.push(el.text);
  (el.children || []).forEach((c) => collectTexts(c, out));
  return out;
}
function findButton(el, label) {
  if (el.tag === "button" && el.text === label) return el;
  for (const c of el.children || []) {
    const f = findButton(c, label);
    if (f) return f;
  }
  return null;
}

async function main() {
  for (const d of ["SIGMOD2027", "笔记A"]) {
    fs.mkdirSync(path.join(vault, d), { recursive: true });
    fs.writeFileSync(path.join(vault, d, "note.md"), "# " + d + "\n");
  }
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });

  git(["init", "--bare", "-b", "main", remote], tmp);
  git(["init", "-b", "main"]);
  git(["config", "user.name", "T"]);
  git(["config", "user.email", "t@x.com"]);
  git(["add", "-A"]);
  git(["commit", "-m", "init"]);
  git(["remote", "add", "origin", remote]);
  git(["push", "origin", "main"]);

  const p = new SimpleGitSyncPlugin(mkApp(vault), {});
  await p.onload();
  p.settings.remoteUrl = remote.replace(/\\/g, "/");
  p.settings.userName = "T";
  p.settings.userEmail = "t@x.com";
  p.settings.selectedFolders = ["SIGMOD2027"];

  // --- 状态栏点击打开面板 ---
  MODALS.length = 0;
  p.showStatus();
  t("showStatus 打开操作面板", MODALS.length === 1, "modals=" + MODALS.length);
  const modal = MODALS[0];
  t("面板是 ControlPanelModal", modal.constructor.name === "ControlPanelModal", modal.constructor.name);

  // --- 按钮齐全 ---
  const buttons = collectButtons(modal.contentEl);
  t("有「立即同步」按钮", buttons.includes("立即同步"), JSON.stringify(buttons));
  t("有「同步整个 vault」按钮", buttons.includes("同步整个 vault"), JSON.stringify(buttons));
  t("有「上传」按钮", buttons.includes("仅上传"), JSON.stringify(buttons));
  t("有「下载」按钮", buttons.includes("仅下载"), JSON.stringify(buttons));
  t("有「提交范围…」按钮", buttons.includes("提交范围…"), JSON.stringify(buttons));
  t("有「从本地源码安装」按钮", buttons.includes("从本地源码安装"), JSON.stringify(buttons));
  t("有「取消未完成的合并」按钮", buttons.includes("取消未完成的合并"), JSON.stringify(buttons));
  t("有「刷新」按钮", buttons.includes("刷新状态"), JSON.stringify(buttons));

  // --- 状态摘要显示 ---
  const texts = collectTexts(modal.contentEl);
  const joined = texts.join(" | ");
  t("显示同步范围", joined.includes("SIGMOD2027"), joined.slice(0, 200));
  t("显示仓库状态", joined.includes("已初始化"), joined.slice(0, 200));

  // --- 点击「提交范围…」会弹选择器 ---
  MODALS.length = 0;
  const chooseBtn = findButton(modal.contentEl, "提交范围…");
  t("找到选择文件夹按钮", !!chooseBtn, "");
  if (chooseBtn) {
    await chooseBtn._on.click();
    t("点击后弹出文件夹选择器", MODALS.length === 1 && MODALS[0].constructor.name === "FolderPickerModal", MODALS.length ? MODALS[0].constructor.name : "none");
  }

  // --- 点击「上传」实际执行 git 操作 ---
  fs.writeFileSync(path.join(vault, "SIGMOD2027", "new.md"), "# new\n");
  MODALS.length = 0;
  p.showStatus();
  const m2 = MODALS[0];
  const uploadBtn = findButton(m2.contentEl, "仅上传");
  t("找到上传按钮", !!uploadBtn, "");
  if (uploadBtn) {
    await uploadBtn._on.click();
    const remoteTree = git(["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], tmp).trim().split("\n");
    t("点击上传后文件推到远程", remoteTree.some((f) => f.includes("SIGMOD2027/new.md")), JSON.stringify(remoteTree));
  }

  // 「同步整个 vault」必须覆盖选中文件夹设置，提交本 vault 里的其他文件夹。
  fs.writeFileSync(path.join(vault, "笔记A", "note.md"), "# 同步整个 vault测试\n");
  MODALS.length = 0;
  p.showStatus();
  const allBtn = findButton(MODALS[0].contentEl, "同步整个 vault");
  if (allBtn) await allBtn._on.click();
  const remoteNote = git(["--git-dir=" + remote, "show", "main:笔记A/note.md"], tmp);
  t("同步整个 vault会提交未选中的文件夹", remoteNote.includes("同步整个 vault测试"), remoteNote);

  // --- 面板刷新后状态更新 ---
  MODALS.length = 0;
  p.showStatus();
  const m3 = MODALS[0];
  const texts3 = collectTexts(m3.contentEl).join(" | ");
  t("刷新后显示上次同步结果", texts3.includes("已同步") || texts3.includes("仅上传"), texts3.slice(0, 300));

  // 主按钮只执行配置范围；重复点击不会启动第二个同步。
  fs.writeFileSync(path.join(vault, "笔记A", "note.md"), "# outside selected scope\n");
  fs.writeFileSync(path.join(vault, "SIGMOD2027", "note.md"), "# selected scope\n");
  MODALS.length = 0;
  p.showStatus();
  const syncBtn = findButton(MODALS[0].contentEl, "立即同步");
  await syncBtn._on.click();
  const scopedHead = git(["show", "--name-only", "--pretty=format:", "HEAD"]).trim().split("\n");
  t("立即同步使用配置的提交范围", scopedHead.every((f) => f.startsWith("SIGMOD2027/")), JSON.stringify(scopedHead));
  const realSync = p.doSync;
  let calls = 0, release;
  p.doSync = async () => { calls++; await new Promise((resolve) => { release = resolve; }); };
  MODALS.length = 0;
  p.showStatus();
  const duplicateBtn = findButton(MODALS[0].contentEl, "立即同步");
  const pendingClick = duplicateBtn._on.click();
  await duplicateBtn._on.click();
  t("同步期间重复点击不会重复执行", calls === 1);
  release();
  await pendingClick;
  p.doSync = realSync;

  // --- 未初始化仓库时不应显示「取消合并」 ---
  const emptyVault = path.join(tmp, "empty");
  fs.mkdirSync(emptyVault, { recursive: true });
  const p2 = new SimpleGitSyncPlugin(mkApp(emptyVault), {});
  await p2.onload();
  MODALS.length = 0;
  p2.showStatus();
  const btns2 = collectButtons(MODALS[0].contentEl);
  t("未初始化时隐藏取消合并", !btns2.includes("取消未完成的合并"), JSON.stringify(btns2));
  t("未初始化时仍显示同步按钮", btns2.includes("初始化并首次同步"), JSON.stringify(btns2));
  t("未初始化时可从面板首次上传", btns2.includes("初始化并首次同步"), JSON.stringify(btns2));

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e && e.stack || e); process.exit(2); });
