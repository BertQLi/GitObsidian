// 用 Node 直接跑插件逻辑，mock 掉 obsidian 模块
const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const NOTICES = [];
const STATUS = [];

class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  addStatusBarItem() {
    return { setText: (t) => STATUS.push(t), setAttr: () => {}, addClass: () => {}, addEventListener: () => {} };
  }
  registerDomEvent() {}
  registerInterval() {}
  addCommand() {}
  addSettingTab() {}
  async loadData() { return this._data || {}; }
  async saveData(d) { this._data = d; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; } }
class Setting {}
class Modal { constructor(app) { this.app = app; } }
class Notice { constructor(msg) { NOTICES.push(String(msg)); } }

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "obsidian") return { Plugin, PluginSettingTab, Setting, Notice, Modal };
  return originalRequire.apply(this, arguments);
};

const PLUGIN = path.join(__dirname, "main.js");
const SimpleGitSyncPlugin = require(PLUGIN);

const tmp = process.argv[2];
const vault = path.join(tmp, "vault");
const remote = path.join(tmp, "remote.git");

function mkApp(vaultPath) {
  return { vault: { adapter: { getBasePath: () => vaultPath } } };
}

async function main() {
  fs.mkdirSync(path.join(vault, "sub"), { recursive: true });
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vault, "note1.md"), "# one\n");
  fs.writeFileSync(path.join(vault, "sub", "note2.md"), "# two\n");
  fs.writeFileSync(path.join(vault, ".obsidian", "workspace.json"), "{}");
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  const p = new SimpleGitSyncPlugin(mkApp(vault), { id: "simple-git-sync" });
  await p.onload();

  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push("PASS  " + name); }
    catch (e) { results.push("FAIL  " + name + " :: " + e.message); }
  };

  // --- 未配置远程时应报错 ---
  try {
    await p.doInit();
    results.push("FAIL  未配置远程应报错");
  } catch (e) {
    results.push(String(e.message).includes("仓库地址") ? "PASS  未配置远程时给出友好提示" : "FAIL  错误信息不符: " + e.message);
  }

  // --- 配置 ---
  p.settings.remoteUrl = remote.replace(/\\/g, "/");
  p.settings.branch = "main";
  p.settings.username = "";
  p.settings.token = "";
  p.settings.userName = "Test User";
  p.settings.userEmail = "test@example.com";
  p.settings.gitPath = "git";

  // --- doInit ---
  await p.doInit();
  check("doInit 后是 git 仓库", () => { if (!fs.existsSync(path.join(vault, ".git"))) throw new Error("no .git"); });
  check("doInit 写了 .gitattributes", () => {
    const c = fs.readFileSync(path.join(vault, ".gitattributes"), "utf8");
    if (!c.includes("-text")) throw new Error("bad gitattributes");
  });
  check("doInit 写了 .gitignore 且含 data.json", () => {
    const c = fs.readFileSync(path.join(vault, ".gitignore"), "utf8");
    if (!c.includes("data.json")) throw new Error("token file not ignored");
  });
  const remoteFiles1 = execFileSync("git", ["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" }).trim().split("\n");
  check("远程根目录就是 vault 内容", () => {
    if (!remoteFiles1.includes("note1.md")) throw new Error("note1.md missing, got " + remoteFiles1.join(","));
    if (!remoteFiles1.includes("sub/note2.md")) throw new Error("sub/note2.md missing");
  });
  check("远程没有 .obsidian/workspace.json", () => {
    if (remoteFiles1.some((f) => f.includes("workspace.json"))) throw new Error("workspace.json leaked");
  });

  // --- doUpload：新增文件 ---
  fs.writeFileSync(path.join(vault, "note3.md"), "# note three\n", "utf8");
  await p.doUpload();
  const remoteFiles2 = execFileSync("git", ["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" }).trim().split("\n");
  check("doUpload 把新文件推上去", () => { if (!remoteFiles2.includes("note3.md")) throw new Error("note3.md not pushed"); });

  // --- doUpload：无改动不应崩 ---
  try { await p.doUpload(); results.push("PASS  doUpload 无改动不报错"); }
  catch (e) { results.push("FAIL  doUpload 无改动报错: " + e.message); }

  // --- 模拟另一端 push，本端 doDownload ---
  const other = path.join(tmp, "other");
  execFileSync("git", ["clone", remote, other], { stdio: "ignore" });
  fs.writeFileSync(path.join(other, "from-mac.md"), "# from mac\n", "utf8");
  execFileSync("git", ["-C", other, "add", "-A"]);
  execFileSync("git", ["-C", other, "-c", "user.name=Mac", "-c", "user.email=mac@example.com", "commit", "-m", "mac change"], { stdio: "ignore" });
  execFileSync("git", ["-C", other, "push", "origin", "main"], { stdio: "ignore" });

  await p.doDownload();
  check("doDownload 拉到另一端的新文件", () => {
    if (!fs.existsSync(path.join(vault, "from-mac.md"))) throw new Error("from-mac.md not pulled");
  });

  // --- doSync：本地改动 + 远端改动同时存在 ---
  fs.writeFileSync(path.join(vault, "local-change.md"), "# local\n", "utf8");
  fs.writeFileSync(path.join(other, "remote-change.md"), "# remote\n", "utf8");
  execFileSync("git", ["-C", other, "add", "-A"]);
  execFileSync("git", ["-C", other, "-c", "user.name=Mac", "-c", "user.email=mac@example.com", "commit", "-m", "remote change"], { stdio: "ignore" });
  execFileSync("git", ["-C", other, "push", "origin", "main"], { stdio: "ignore" });

  await p.doSync(false);
  check("doSync 合并了远端改动", () => {
    if (!fs.existsSync(path.join(vault, "remote-change.md"))) throw new Error("remote-change.md missing after sync");
  });
  const remoteFiles3 = execFileSync("git", ["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" }).trim().split("\n");
  check("doSync 推送了本地改动", () => { if (!remoteFiles3.includes("local-change.md")) throw new Error("local-change.md not pushed"); });
  check("doSync 后另一端文件也在远程", () => { if (!remoteFiles3.includes("remote-change.md")) throw new Error("remote-change.md not on remote"); });

  // --- 状态栏 ---
  check("状态栏有更新", () => { if (STATUS.length === 0) throw new Error("status bar never updated"); });

  // --- 未初始化仓库时 upload 应报错 ---
  const bare = path.join(tmp, "emptyvault");
  fs.mkdirSync(bare, { recursive: true });
  const p2 = new SimpleGitSyncPlugin(mkApp(bare), { id: "simple-git-sync" });
  await p2.onload();
  p2.settings.remoteUrl = remote.replace(/\\/g, "/");
  try {
    await p2.doUpload();
    results.push("FAIL  非仓库时 upload 应报错");
  } catch (e) {
    results.push(String(e.message).includes("初始化") ? "PASS  非仓库时提示先初始化" : "FAIL  错误信息不符: " + e.message);
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  console.log("NOTICES:", JSON.stringify(NOTICES.slice(-6)));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
