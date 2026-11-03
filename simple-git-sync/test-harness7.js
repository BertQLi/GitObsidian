// 测试多 vault 场景：仓库根是父目录，vault 是子目录
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
const vaultA = path.join(repoRoot, "vaultA");
const vaultB = path.join(repoRoot, "vaultB");
const remote = path.join(tmp, "remote.git");
const mkApp = (v) => ({ vault: { adapter: { getBasePath: () => v } }, plugins: {} });
const results = [];
const t = (n, ok, extra) => results.push((ok ? "PASS  " : "FAIL  ") + n + (ok ? "" : " :: " + (extra || "")));
const git = (args, cwd) => execFileSync("git", ["-c", "core.quotepath=false"].concat(args), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function main() {
  // 构造多 vault 结构
  for (const [v, folders] of [[vaultA, ["笔记X", "笔记Y"]], [vaultB, ["笔记Z"]]]) {
    fs.mkdirSync(path.join(v, ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(v, ".obsidian", "app.json"), "{}");
    for (const f of folders) {
      fs.mkdirSync(path.join(v, f), { recursive: true });
      fs.writeFileSync(path.join(v, f, "note.md"), "# " + f + "\n");
    }
  }

  git(["init", "--bare", "-b", "main", remote], tmp);
  git(["init", "-b", "main"], repoRoot);
  git(["config", "user.name", "T"], repoRoot);
  git(["config", "user.email", "t@x.com"], repoRoot);
  git(["add", "-A"], repoRoot);
  git(["commit", "-m", "init"], repoRoot);
  git(["remote", "add", "origin", remote], repoRoot);
  git(["push", "origin", "main"], repoRoot);

  // ===== 在 vaultA 里操作 =====
  const p = new SimpleGitSyncPlugin(mkApp(vaultA), {});
  await p.onload();
  p.settings.remoteUrl = remote.replace(/\\/g, "/");
  p.settings.userName = "T";
  p.settings.userEmail = "t@x.com";

  // --- 仓库识别 ---
  const root = await p.detectRepoRoot();
  t("识别出仓库根在父目录", root && path.resolve(root) === path.resolve(repoRoot), root);
  const pref = await p.vaultPrefix();
  t("识别出 vault 前缀 vaultA/", pref === "vaultA/", pref);
  t("isRepo 返回 true（不是只看自己目录的 .git）", p.isRepo() === true, String(p.isRepo()));
  t("isVaultAtRepoRoot 返回 false", (await p.isVaultAtRepoRoot()) === false, "");

  // --- 关键：只同步当前 vault ---
  fs.writeFileSync(path.join(vaultA, "笔记X", "note.md"), "# X 改了\n");
  fs.writeFileSync(path.join(vaultA, "笔记Y", "note.md"), "# Y 改了\n");
  fs.writeFileSync(path.join(vaultB, "笔记Z", "note.md"), "# Z 改了\n");  // 兄弟 vault

  const committed = await p.commitAll("只同步 vaultA");
  t("commitAll 返回 true", committed === true, "");

  const head = git(["show", "--name-only", "--pretty=format:", "HEAD"], repoRoot).trim().split("\n").filter(Boolean);
  t("只提交 vaultA 的文件", head.every((f) => f.startsWith("vaultA/")), JSON.stringify(head));
  t("没提交 vaultB", !head.some((f) => f.startsWith("vaultB/")), JSON.stringify(head));
  t("提交了 vaultA 的两个文件夹", head.length === 2, JSON.stringify(head));

  const status = git(["status", "--porcelain"], repoRoot).trim();
  t("vaultB 改动仍在工作区", status.includes("vaultB"), status);

  // --- 带选中文件夹时 ---
  git(["reset", "--hard", "HEAD"], repoRoot);
  fs.writeFileSync(path.join(vaultA, "笔记X", "note.md"), "# X 再改\n");
  fs.writeFileSync(path.join(vaultA, "笔记Y", "note.md"), "# Y 再改\n");
  fs.writeFileSync(path.join(vaultB, "笔记Z", "note.md"), "# Z 再改\n");

  p.settings.selectedFolders = ["笔记X"];
  p._repoRoot = undefined; p._vaultPrefix = undefined;
  await p.commitAll("只同步 vaultA/笔记X");

  const head2 = git(["show", "--name-only", "--pretty=format:", "HEAD"], repoRoot).trim().split("\n").filter(Boolean);
  t("选中文件夹时只提交那一个", head2.length === 1 && head2[0].includes("笔记X"), JSON.stringify(head2));
  t("没提交 vaultA 的其他文件夹", !head2.some((f) => f.includes("笔记Y")), JSON.stringify(head2));
  t("没提交兄弟 vault", !head2.some((f) => f.startsWith("vaultB/")), JSON.stringify(head2));

  // --- push 到远程 ---
  await p.pushWithHint();
  const remoteTree = git(["--git-dir=" + remote, "ls-tree", "-r", "--name-only", "main"], tmp).trim().split("\n");
  t("推送成功", remoteTree.some((f) => f.includes("vaultA/笔记X")), "");

  // ===== 在 vaultB 里操作（模拟另一个 Obsidian 实例）=====
  git(["reset", "--hard", "HEAD"], repoRoot);
  const pB = new SimpleGitSyncPlugin(mkApp(vaultB), {});
  await pB.onload();
  pB.settings.remoteUrl = remote.replace(/\\/g, "/");
  pB.settings.userName = "T";
  pB.settings.userEmail = "t@x.com";

  const rootB = await pB.detectRepoRoot();
  t("vaultB 也识别出同一个仓库根", path.resolve(rootB) === path.resolve(repoRoot), rootB);
  const prefB = await pB.vaultPrefix();
  t("vaultB 前缀是 vaultB/", prefB === "vaultB/", prefB);

  fs.writeFileSync(path.join(vaultB, "笔记Z", "note.md"), "# Z 从 B 改\n");
  fs.writeFileSync(path.join(vaultA, "笔记X", "note.md"), "# X 从 B 视角改\n");
  await pB.commitAll("从 vaultB 同步");

  const head3 = git(["show", "--name-only", "--pretty=format:", "HEAD"], repoRoot).trim().split("\n").filter(Boolean);
  t("vaultB 只提交自己的文件", head3.every((f) => f.startsWith("vaultB/")), JSON.stringify(head3));
  t("vaultB 没提交 vaultA", !head3.some((f) => f.startsWith("vaultA/")), JSON.stringify(head3));

  // --- 操作面板显示 vault 位置 ---
  MODALS.length = 0;
  await pB.detectRepoRoot();
  await pB.vaultPrefix();
  pB.showStatus();
  const texts = [];
  (function walk(el) { if (el.text) texts.push(el.text); (el.children || []).forEach(walk); })(MODALS[0].contentEl);
  const joined = texts.join(" | ");
  t("面板显示 vault 在仓库内的位置", joined.includes("vaultB"), joined.slice(0, 250));

  // --- 单一 vault（vault 就是仓库根）仍要正常 ---
  const soloRepo = path.join(tmp, "solo");
  const soloVault = path.join(soloRepo, "v");
  fs.mkdirSync(path.join(soloVault, "notes"), { recursive: true });
  fs.writeFileSync(path.join(soloVault, "notes", "a.md"), "# a\n");
  git(["init", "-b", "main", soloVault], tmp);
  git(["config", "user.name", "T"], soloVault);
  git(["config", "user.email", "t@x.com"], soloVault);
  git(["add", "-A"], soloVault);
  git(["commit", "-m", "init"], soloVault);

  const pSolo = new SimpleGitSyncPlugin(mkApp(soloVault), {});
  await pSolo.onload();
  pSolo.settings.remoteUrl = remote.replace(/\\/g, "/");
  pSolo.settings.userName = "T";
  pSolo.settings.userEmail = "t@x.com";
  t("单 vault 时 isVaultAtRepoRoot 为 true", (await pSolo.isVaultAtRepoRoot()) === true, "");
  const prefSolo = await pSolo.vaultPrefix();
  t("单 vault 时前缀为空", prefSolo === "", JSON.stringify(prefSolo));

  fs.writeFileSync(path.join(soloVault, "notes", "a.md"), "# a 改了\n");
  await pSolo.commitAll("solo");
  const headSolo = git(["show", "--name-only", "--pretty=format:", "HEAD"], soloVault).trim().split("\n").filter(Boolean);
  t("单 vault 提交正常", headSolo.includes("notes/a.md"), JSON.stringify(headSolo));

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log("\n=== " + (results.length - failed) + "/" + results.length + " passed ===");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR:", e && e.stack || e); process.exit(2); });
