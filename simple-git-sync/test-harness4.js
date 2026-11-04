// 测试「安装到 .obsidian」命令
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const NOTICES = [];
const MODALS = [];

class Plugin {
  constructor(app, m) { this.app = app; this.manifest = m; }
  addStatusBarItem() { return { setText: () => {}, setAttr: () => {}, addClass: () => {} }; }
  registerDomEvent() {} registerInterval() {} addCommand() {} addSettingTab() {}
  async loadData() { return this._data || {}; }
  async saveData(d) { this._data = d; }
}
class PluginSettingTab { constructor() { this.containerEl = {}; } }
class Setting {}
function mkEl() {
  const el = {
    children: [],
    style: {},
    empty() { this.children.length = 0; },
    createEl(tag, o) { const c = mkEl(); c.tag = tag; c.text = (o && o.text) || ""; this.children.push(c); return c; },
    createDiv() { const c = mkEl(); c.tag = "div"; this.children.push(c); return c; },
    setText(t) { this.text = String(t); },
    addClass() {},
    addEventListener(ev, fn) { this._onClick = fn; },
  };
  return el;
}
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
const mkApp = (v) => ({ vault: { adapter: { getBasePath: () => v } }, plugins: {} });
const results = [];
const t = (n, ok, extra) => results.push((ok ? "PASS  " : "FAIL  ") + n + (ok ? "" : " :: " + (extra || "")));

function seed() {
  const src = path.join(vault, "plugins", "simple-git-sync");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "main.js"), "// v1\n");
  fs.writeFileSync(path.join(src, "manifest.json"), JSON.stringify({ id: "simple-git-sync", name: "Simple Git Sync", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(src, "README.md"), "# readme\n");
  fs.writeFileSync(path.join(src, "test-harness.js"), "// test\n");
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
}

async function main() {
  seed();
  const p = new SimpleGitSyncPlugin(mkApp(vault), { id: "simple-git-sync" });
  await p.onload();
  p.settings.pluginSourceDir = "plugins/simple-git-sync";

  const dst = path.join(vault, ".obsidian", "plugins", "simple-git-sync");

  // --- 首次安装 ---
  await p.doInstallToObsidian();
  t("安装了 main.js", fs.existsSync(path.join(dst, "main.js")), "");
  t("安装了 manifest.json", fs.existsSync(path.join(dst, "manifest.json")), "");
  t("main.js 内容正确", fs.readFileSync(path.join(dst, "main.js"), "utf8") === "// v1\n", "");

  // 只复制加载必需文件
  t("没复制 README.md", !fs.existsSync(path.join(dst, "README.md")), "");
  t("没复制 test-harness.js", !fs.existsSync(path.join(dst, "test-harness.js")), "");
  t("没复制 styles.css（源码里没有）", !fs.existsSync(path.join(dst, "styles.css")), "");

  // 弹窗提示需要重载
  t("弹窗提示可重载", MODALS.length === 1 && MODALS[0].canReload === true, "modals=" + MODALS.length);

  // --- 再次安装：内容一致，应跳过 ---
  MODALS.length = 0;
  await p.doInstallToObsidian();
  t("内容一致时提示已是最新", MODALS.length === 1 && MODALS[0].canReload === false, "modals=" + MODALS.length);

  // --- 改源码后重装 ---
  MODALS.length = 0;
  fs.writeFileSync(path.join(vault, "plugins", "simple-git-sync", "main.js"), "// v2\n");
  await p.doInstallToObsidian();
  t("源码更新后复制新版", fs.readFileSync(path.join(dst, "main.js"), "utf8") === "// v2\n", "");
  t("更新后提示可重载", MODALS.length === 1 && MODALS[0].canReload === true, "");

  // --- 源码目录不存在 ---
  p.settings.pluginSourceDir = "plugins/不存在的目录";
  let msg = "";
  try { await p.doInstallToObsidian(); } catch (e) { msg = e.message; }
  t("源码目录不存在时友好报错", /找不到插件源码目录/.test(msg), msg.slice(0, 80));

  // --- 缺 manifest ---
  const src2 = path.join(vault, "plugins", "broken");
  fs.mkdirSync(src2, { recursive: true });
  fs.writeFileSync(path.join(src2, "main.js"), "// x\n");
  p.settings.pluginSourceDir = "plugins/broken";
  msg = "";
  try { await p.doInstallToObsidian(); } catch (e) { msg = e.message; }
  t("缺 manifest 时报错", /manifest\.json/.test(msg), msg.slice(0, 80));

  // --- 缺 main.js ---
  const src3 = path.join(vault, "plugins", "broken2");
  fs.mkdirSync(src3, { recursive: true });
  fs.writeFileSync(path.join(src3, "manifest.json"), JSON.stringify({ id: "x" }));
  p.settings.pluginSourceDir = "plugins/broken2";
  msg = "";
  try { await p.doInstallToObsidian(); } catch (e) { msg = e.message; }
  t("缺 main.js 时报错", /main\.js/.test(msg), msg.slice(0, 80));

  // --- manifest id 与目录不一致时警告 ---
  const src4 = path.join(vault, "plugins", "wrongid");
  fs.mkdirSync(src4, { recursive: true });
  fs.writeFileSync(path.join(src4, "main.js"), "// y\n");
  fs.writeFileSync(path.join(src4, "manifest.json"), JSON.stringify({ id: "完全不同的id", name: "X", version: "1.0.0" }));
  p.settings.pluginSourceDir = "plugins/wrongid";
  MODALS.length = 0;
  await p.doInstallToObsidian();
  const modalText = MODALS.length ? MODALS[0].lines.join("\n") : "";
  t("manifest id 不一致时给出警告", /不一致/.test(modalText), modalText.slice(0, 120));

  // --- 源码目录 == 安装目录时拒绝 ---
  p.settings.pluginSourceDir = ".obsidian/plugins/simple-git-sync";
  msg = "";
  try { await p.doInstallToObsidian(); } catch (e) { msg = e.message; }
  t("源码目录等于安装目录时拒绝", /同一个目录/.test(msg), msg.slice(0, 80));

  // --- 路径带 ./ 前缀也能工作 ---
  fs.writeFileSync(path.join(vault, "plugins", "simple-git-sync", "main.js"), "// v3\n");
  p.settings.pluginSourceDir = "./plugins/simple-git-sync/";
  MODALS.length = 0;
  await p.doInstallToObsidian();
  t("源码目录带 ./ 和尾斜杠也能用", fs.readFileSync(path.join(dst, "main.js"), "utf8") === "// v3\n", "");

  // --- 有 styles.css 时也复制 ---
  fs.writeFileSync(path.join(vault, "plugins", "simple-git-sync", "styles.css"), ".x{}\n");
  p.settings.pluginSourceDir = "plugins/simple-git-sync";
  MODALS.length = 0;
  await p.doInstallToObsidian();
  t("有 styles.css 时一并复制", fs.existsSync(path.join(dst, "styles.css")), "");

  // --- 绝对路径（源码在 vault 外）---
  const outsideDir = path.join(tmp, "outside-src");
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, "main.js"), "// ABS\n");
  fs.writeFileSync(path.join(outsideDir, "manifest.json"), JSON.stringify({ id: "simple-git-sync", name: "X", version: "1.0.0" }));
  p.settings.pluginSourceDir = outsideDir;
  MODALS.length = 0;
  await p.doInstallToObsidian();
  t("支持 vault 外的绝对路径", fs.readFileSync(path.join(dst, "main.js"), "utf8") === "// ABS\n", "");
  t("弹窗显示完整绝对路径", MODALS.length && MODALS[0].lines[0].includes(outsideDir), MODALS.length ? MODALS[0].lines[0] : "no modal");

  // 绝对路径带正斜杠
  p.settings.pluginSourceDir = outsideDir.replace(/\\/g, "/");
  MODALS.length = 0;
  await p.doInstallToObsidian();
  t("绝对路径用正斜杠也能识别", MODALS.length === 1, "modals=" + MODALS.length);

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
