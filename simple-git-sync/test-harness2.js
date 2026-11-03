const Module = require("module");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const NOTICES = [];
class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  addStatusBarItem() { return { setText: () => {}, addClass: () => {} }; }
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
const mkApp = (v) => ({ vault: { adapter: { getBasePath: () => v } } });
const results = [];
const t = (name, ok, extra) => results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " :: " + (extra || "")));

function git(args, cwd) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }

async function main() {
  // ===== 用例 A：远程已有内容（模拟建仓库时勾了 README）=====
  {
    const root = path.join(tmp, "caseA");
    const remote = path.join(root, "remote.git");
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault, { recursive: true });
    git(["init", "--bare", "-b", "main", remote], root);
    // 造一个已有内容的远程
    const seed = path.join(root, "seed");
    git(["clone", remote, seed], root);
    fs.writeFileSync(path.join(seed, "README.md"), "# repo\n");
    git(["add", "-A"], seed);
    git(["-c", "user.name=Seed", "-c", "user.email=seed@x.com", "commit", "-m", "seed"], seed);
    git(["push", "origin", "main"], seed);

    fs.writeFileSync(path.join(vault, "note.md"), "# note\n");
    const p = new SimpleGitSyncPlugin(mkApp(vault), {});
    await p.onload();
    p.settings.remoteUrl = remote.replace(/\\/g, "/");
    p.settings.userName = "T"; p.settings.userEmail = "t@x.com";

    let msg = "";
    try { await p.doInit(); } catch (e) { msg = e.message; }
    t("远程非空时 doInit 给出可读提示", /远程仓库已有内容|下载/.test(msg), msg.slice(0, 120));
    t("提示里没有裸露的 git 堆栈", !/^\s*at\s/m.test(msg), msg.slice(0, 120));
  }

  // ===== 用例 B：冲突 =====
  {
    const root = path.join(tmp, "caseB");
    const remote = path.join(root, "remote.git");
    const vault = path.join(root, "vault");
    const other = path.join(root, "other");
    fs.mkdirSync(vault, { recursive: true });
    git(["init", "--bare", "-b", "main", remote], root);
    fs.writeFileSync(path.join(vault, "a.md"), "line1\nline2\n");
    const p = new SimpleGitSyncPlugin(mkApp(vault), {});
    await p.onload();
    p.settings.remoteUrl = remote.replace(/\\/g, "/");
    p.settings.userName = "T"; p.settings.userEmail = "t@x.com";
    await p.doInit();

    git(["clone", remote, other], root);
    // 两端改同一行
    fs.writeFileSync(path.join(other, "a.md"), "MAC VERSION\nline2\n");
    git(["add", "-A"], other);
    git(["-c", "user.name=M", "-c", "user.email=m@x.com", "commit", "-m", "mac"], other);
    git(["push", "origin", "main"], other);

    fs.writeFileSync(path.join(vault, "a.md"), "WIN VERSION\nline2\n");
    let msg = "";
    try { await p.doSync(false); } catch (e) { msg = e.message; }
    t("冲突时给出中文提示", /冲突/.test(msg), msg.slice(0, 160));

    // abort 能恢复
    await p.doAbortMerge();
    const status = git(["status", "--porcelain"], vault).trim();
    t("取消合并后工作区干净", status === "", status.slice(0, 120));
    const content = fs.readFileSync(path.join(vault, "a.md"), "utf8");
    t("取消合并后保留本地内容", content.includes("WIN VERSION"), content);
  }

  // ===== 用例 C：带令牌的 URL 拼接 =====
  {
    const root = path.join(tmp, "caseC");
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault, { recursive: true });
    const p = new SimpleGitSyncPlugin(mkApp(vault), {});
    await p.onload();

    p.settings.remoteUrl = "https://github.com/me/repo.git";
    p.settings.username = "me";
    p.settings.token = "";
    t("无令牌时用原始 URL", p.authedUrl() === "https://github.com/me/repo.git", p.authedUrl());

    p.settings.token = "ghp_secret";
    const u = p.authedUrl();
    t("有令牌时注入凭据", u.includes("ghp_secret") && u.startsWith("https://me:"), u);

    p.settings.remoteUrl = "git@github.com:me/repo.git";
    p.settings.username = "me"; p.settings.token = "ghp_x";
    t("SSH 地址不被改写", p.authedUrl() === "git@github.com:me/repo.git", p.authedUrl());

    p.settings.remoteUrl = "";
    let threw = false;
    try { p.authedUrl(); } catch (e) { threw = /仓库地址/.test(e.message); }
    t("未填地址时抛可读错误", threw);
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
