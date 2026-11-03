"use strict";

const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require("obsidian");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const GITIGNORE = [
  "# 每台设备自己的界面布局，同步会冲突",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/cache",
  "",
  "# 本插件设置里存着访问令牌，绝对不能提交",
  ".obsidian/plugins/simple-git-sync/data.json",
  "",
  "# 系统垃圾",
  ".trash/",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "*.tmp",
  ""
].join("\n");

const GITATTRIBUTES = [
  "# 关闭行尾转换：Windows 用 CRLF、macOS 用 LF，混用会让每个文件都显示被改动",
  "* -text",
  ""
].join("\n");

const DEFAULT_SETTINGS = {
  remoteUrl: "",
  branch: "main",
  username: "",
  token: "",
  userName: "",
  userEmail: "",
  gitPath: "git",
  pluginSourceDir: "plugins/simple-git-sync",
  syncPaths: "",
  selectedFolders: [],
  autoSync: false,
  autoSyncMinutes: 10,
  lastSyncAt: 0,
  lastSyncResult: ""
};

function errText(e) {
  if (!e) return "";
  return String((e.stdout || "") + (e.stderr || "") + (e.message || "")).trim();
}

function tail(text, n) {
  const lines = String(text || "").split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
  return lines.slice(-n).join("\n");
}

function stamp() {
  return new Date().toLocaleString("zh-CN");
}

// 状态栏点开的操作面板：直接操作，不用进设置
class ControlPanelModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const el = this.contentEl;
    el.empty();
    this.render();
  }

  render() {
    const p = this.plugin;
    const el = this.contentEl;
    el.empty();

    el.createEl("h3", { text: "Git 同步" });

    // ---------- 状态摘要 ----------
    const info = el.createDiv();
    info.style.fontSize = "12px";
    info.style.lineHeight = "1.7";
    info.style.marginBottom = "12px";
    info.style.padding = "8px 10px";
    info.style.background = "var(--background-secondary)";
    info.style.borderRadius = "6px";

    const sel = p.selectedPathSpec();
    const scopeText = sel.length ? sel.join("、") : "（未选，同步整仓）";
    const lastText = p.settings.lastSyncAt
      ? new Date(p.settings.lastSyncAt).toLocaleString("zh-CN")
      : "从未";

    const row = (label, value, color) => {
      const d = info.createDiv();
      const l = d.createEl("span", { text: label + "：" });
      l.style.opacity = "0.65";
      const v = d.createEl("span", { text: value });
      if (color) v.style.color = color;
    };
    row("仓库", p.isRepo() ? "已初始化" : "未初始化", p.isRepo() ? "" : "var(--text-error)");
    if (p.isRepo()) {
      const pref = p._vaultPrefix;
      if (pref === undefined) {
        row("本 vault 位置", "检测中…");
      } else if (pref) {
        row("本 vault 位置", "仓库内 " + pref.replace(/\/$/, ""));
      } else {
        row("本 vault 位置", "仓库根");
      }
    }
    row("同步范围", scopeText);
    row("上次同步", lastText);
    if (p.settings.lastSyncResult) row("结果", p.settings.lastSyncResult);

    // ---------- 主操作 ----------
    const btnRow = (title) => {
      const t = el.createEl("div", { text: title });
      t.style.fontSize = "11px";
      t.style.opacity = "0.6";
      t.style.margin = "10px 0 6px";
      return el.createDiv();
    };

    const mkBtn = (parent, label, cta, onClick, tooltip) => {
      const b = parent.createEl("button", { text: label });
      b.style.marginRight = "6px";
      b.style.marginBottom = "6px";
      if (cta) b.addClass("mod-cta");
      if (tooltip) b.title = tooltip;
      b.addEventListener("click", async () => {
        await onClick();
      });
      return b;
    };

    // 同步
    const runAndRefresh = async (fn) => {
      await p.guard(fn);
      this.detailText = undefined;
      this.render();
    };

    const g1 = btnRow("同步");
    mkBtn(g1, "同步选中", true, () => runAndRefresh(() => p.doSyncSelected()), "只同步勾选的文件夹");
    mkBtn(g1, "全部同步", false, () => runAndRefresh(() => p.doSync(false)), "同步整个仓库");
    mkBtn(g1, "上传", false, () => runAndRefresh(() => p.doUpload()), "只提交并推送");
    mkBtn(g1, "下载", false, () => runAndRefresh(() => p.doDownload()), "只拉取远程");

    // 文件夹
    const g2 = btnRow("文件夹");
    mkBtn(g2, "选择要同步的文件夹", false, () => p.doChooseFolders());

    // 其他
    const g3 = btnRow("维护");
    mkBtn(g3, "安装到 .obsidian", false, () => p.guard(() => p.doInstallToObsidian()), "源码 → 插件目录");
    if (p.isRepo()) {
      mkBtn(g3, "取消未完成的合并", false, () => p.guard(() => p.doAbortMerge()));
    }
    mkBtn(g3, "刷新", false, () => this.render());

    // ---------- 折叠的详细信息 ----------
    const detail = el.createEl("details");
    detail.style.marginTop = "12px";
    detail.style.fontSize = "12px";
    detail.createEl("summary", { text: "详细信息" });
    const pre = detail.createEl("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.userSelect = "text";
    pre.style.fontSize = "11px";
    pre.style.marginTop = "6px";
    pre.setText(this.buildDetailText());

    if (this.detailText !== undefined) {
      pre.setText(this.detailText);
    } else {
      pre.setText("加载中…");
      this.loadDetail().then((t) => {
        this.detailText = t;
        pre.setText(t);
      });
    }
  }

  buildDetailText() {
    const p = this.plugin;
    const lines = [];
    lines.push("仓库目录: " + p.getVaultPath());
    lines.push("远程地址: " + (p.settings.remoteUrl || "(未填写)"));
    lines.push("分支: " + (p.settings.branch || "main"));
    lines.push("自动同步: " + (p.settings.autoSync ? p.settings.autoSyncMinutes + " 分钟" : "关"));
    return lines.join("\n");
  }

  async loadDetail() {
    const p = this.plugin;
    const lines = [this.buildDetailText()];
    if (p.isRepo()) {
      try {
        const st = await p.runGit(["status", "--short", "--branch"]);
        lines.push("");
        lines.push("--- git status ---");
        lines.push(st.stdout.trim() || "(工作区干净)");
      } catch (e) {
        lines.push("");
        lines.push("git status 失败: " + tail(errText(e), 3));
      }
    }
    return lines.join("\n");
  }

  onClose() {
    this.contentEl.empty();
  }
}

class FolderPickerModal extends Modal {
  constructor(app, folders, selected, onDone) {
    super(app);
    this.folders = folders;
    this.selected = new Set(selected || []);
    this.onDone = onDone;
  }
  onOpen() {
    const el = this.contentEl;
    el.empty();
    el.createEl("h3", { text: "选择要同步的文件夹" });
    el.createEl("p", {
      text: "勾选的文件夹才会被提交和推送，未勾选的原封不动。"
    });

    const list = el.createDiv();
    list.style.maxHeight = "50vh";
    list.style.overflowY = "auto";
    list.style.marginBottom = "12px";

    if (this.folders.length === 0) {
      list.createEl("p", { text: "（vault 根目录下没有子文件夹）" });
    }

    const self = this;
    this.folders.forEach(function (name) {
      const row = list.createDiv();
      row.style.padding = "4px 0";
      const cb = row.createEl("input");
      cb.type = "checkbox";
      cb.checked = self.selected.has(name);
      cb.style.marginRight = "8px";
      cb.addEventListener("change", function () {
        if (cb.checked) self.selected.add(name);
        else self.selected.delete(name);
      });
      row.createEl("span", { text: name });
    });

    const bar = el.createDiv();
    bar.style.marginTop = "8px";

    const allBtn = bar.createEl("button", { text: "全选" });
    allBtn.addEventListener("click", function () {
      self.folders.forEach(function (f) { self.selected.add(f); });
      self.onOpen();
    });

    const noneBtn = bar.createEl("button", { text: "全不选" });
    noneBtn.style.marginLeft = "6px";
    noneBtn.addEventListener("click", function () {
      self.selected.clear();
      self.onOpen();
    });

    const bar2 = el.createDiv();
    bar2.style.marginTop = "12px";

    const okBtn = bar2.createEl("button", { text: "保存选择" });
    okBtn.addClass("mod-cta");
    okBtn.addEventListener("click", function () {
      const result = self.folders.filter(function (f) { return self.selected.has(f); });
      self.close();
      self.onDone(result);
    });

    const cancelBtn = bar2.createEl("button", { text: "取消" });
    cancelBtn.style.marginLeft = "8px";
    cancelBtn.addEventListener("click", function () { self.close(); });
  }
  onClose() {
    this.contentEl.empty();
  }
}

class InstallResultModal extends Modal {
  constructor(app, title, lines, canReload, onReload) {
    super(app);
    this.titleText = title;
    this.lines = lines;
    this.canReload = canReload;
    this.onReload = onReload;
  }
  onOpen() {
    const el = this.contentEl;
    el.empty();
    el.createEl("h3", { text: this.titleText });
    const pre = el.createEl("pre");
    pre.setText(this.lines.join("\n"));
    pre.style.whiteSpace = "pre-wrap";
    pre.style.userSelect = "text";
    pre.style.fontSize = "12px";

    if (this.canReload) {
      el.createEl("p", {
        text: "插件文件已被替换，需要重载才会生效。重载过程中 Obsidian 会短暂重新加载本插件。"
      });
      const bar = el.createDiv();
      bar.style.marginTop = "12px";
      const btn = bar.createEl("button", { text: "立即重载插件" });
      btn.addClass("mod-cta");
      btn.addEventListener("click", () => {
        this.close();
        this.onReload();
      });
      const later = bar.createEl("button", { text: "稍后（重启 Obsidian）" });
      later.style.marginLeft = "8px";
      later.addEventListener("click", () => this.close());
    } else {
      const bar = el.createDiv();
      bar.style.marginTop = "12px";
      const ok = bar.createEl("button", { text: "知道了" });
      ok.addClass("mod-cta");
      ok.addEventListener("click", () => this.close());
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}

class SimpleGitSyncPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.syncing = false;
    this.timer = null;

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("mod-clickable");
    this.statusBar.setText("Git · 就绪");
    this.statusBar.setAttr("aria-label", "点击打开 Git 操作面板");
    this.registerDomEvent(this.statusBar, "click", () => this.showStatus());

    this.addCommand({ id: "init-and-upload", name: "初始化仓库并首次上传", callback: () => this.guard(() => this.doInit()) });
    this.addCommand({ id: "upload", name: "上传（提交 + 推送）", callback: () => this.guard(() => this.doUpload()) });
    this.addCommand({ id: "download", name: "下载（拉取远程）", callback: () => this.guard(() => this.doDownload()) });
    this.addCommand({ id: "sync", name: "同步（提交 + 拉取 + 推送）", callback: () => this.guard(() => this.doSync(false)) });
    this.addCommand({ id: "show-status", name: "打开操作面板", callback: () => this.showStatus() });
    this.addCommand({ id: "abort-merge", name: "取消未完成的合并", callback: () => this.guard(() => this.doAbortMerge()) });
    this.addCommand({ id: "install-to-obsidian", name: "安装到 .obsidian（源码目录 → 插件目录）", callback: () => this.guard(() => this.doInstallToObsidian()) });
    this.addCommand({ id: "choose-folders", name: "选择要同步的文件夹", callback: () => this.doChooseFolders() });
    this.addCommand({ id: "sync-selected", name: "同步选中的文件夹", callback: () => this.guard(() => this.doSyncSelected()) });

    this.addSettingTab(new SimpleGitSyncSettingTab(this.app, this));
    // 启动时探测仓库结构（多 vault 场景：仓库根可能在父目录）
    this.detectRepoRoot().then(() => this.updateStatusIdle()).catch(() => {});
    this.restartTimer();
  }

  onunload() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.restartTimer();
  }

  getVaultPath() {
    const a = this.app.vault.adapter;
    if (typeof a.getBasePath === "function") return a.getBasePath();
    return a.basePath;
  }

  runGit(args, opts) {
    opts = opts || {};
    const self = this;
    // credential.helper= 置空：凭据只从 URL 传入，避免系统凭据管理器弹窗把同步卡住
    const full = ["-c", "core.quotepath=false", "-c", "credential.helper="].concat(args);
    return new Promise(function (resolve, reject) {
      execFile(
        self.settings.gitPath || "git",
        full,
        {
          cwd: self.getVaultPath(),
          windowsHide: true,
          maxBuffer: 32 * 1024 * 1024,
          timeout: opts.timeout || 120000,
          env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: "0" })
        },
        function (err, stdout, stderr) {
          if (err) {
            err.stdout = stdout;
            err.stderr = stderr;
            reject(err);
            return;
          }
          resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
        }
      );
    });
  }

  // 仓库根可能不在 vault 根（多 vault 场景：MyObsidian/vaultA、MyObsidian/vaultB）
  // 这里同步查一次，避免每次 git 操作都起进程
  isRepo() {
    // 不用缓存：fs.existsSync 很轻，且仓库可能在运行中被 init
    // 先看自己目录，再向上找 .git（多 vault 场景仓库根在父目录）
    try {
      let dir = this.getVaultPath();
      for (let i = 0; i < 12; i++) {
        if (fs.existsSync(path.join(dir, ".git"))) return true;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  // 异步版本：准确判断（向上查找 .git）
  async detectRepoRoot() {
    try {
      const r = await this.runGit(["rev-parse", "--show-toplevel"]);
      this._repoRoot = r.stdout.trim().replace(/\\/g, "/");
    } catch (e) {
      this._repoRoot = null;
    }
    return this._repoRoot;
  }

  // vault 相对于仓库根的路径，如 "vaultA"；若 vault 就是仓库根则返回 ""
  async vaultPrefix() {
    if (this._vaultPrefix !== undefined) return this._vaultPrefix;
    try {
      const r = await this.runGit(["rev-parse", "--show-prefix"]);
      this._vaultPrefix = r.stdout.trim().replace(/\\/g, "/");
    } catch (e) {
      this._vaultPrefix = "";
    }
    return this._vaultPrefix;
  }

  // 当前 vault 是否就是仓库根
  async isVaultAtRepoRoot() {
    const root = await this.detectRepoRoot();
    if (!root) return false;
    const v = this.getVaultPath().replace(/\\/g, "/").replace(/\/+$/, "");
    return path.resolve(root) === path.resolve(v);
  }

  requireRepo() {
    if (!this.isRepo()) {
      throw new Error("当前目录还不是 Git 仓库，请先执行命令「初始化仓库并首次上传」。");
    }
  }

  requireRemote() {
    if (!String(this.settings.remoteUrl || "").trim()) {
      throw new Error("请先在插件设置里填写仓库地址，例如 https://github.com/用户名/仓库名.git");
    }
  }

  authedUrl() {
    this.requireRemote();
    const raw = String(this.settings.remoteUrl).trim();
    const user = String(this.settings.username || "").trim();
    const token = String(this.settings.token || "").trim();
    if (!user || !token || !/^https?:\/\//i.test(raw)) return raw;
    const u = new URL(raw);
    u.username = user;
    u.password = token;
    return u.toString();
  }

  // 列出 vault 根目录下可同步的文件夹（排除 .git / .obsidian 等隐藏目录）
  listFolders() {
    const root = this.getVaultPath();
    try {
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter(function (e) {
          if (!e.isDirectory()) return false;
          if (e.name.charAt(0) === ".") return false; // 排除 .obsidian / .git / .trash
          return true;
        })
        .map(function (e) { return e.name; })
        .sort();
    } catch (e) {
      return [];
    }
  }

  // 根据选中的文件夹生成 pathspec；没选 = 空数组（整仓）
  selectedPathSpec() {
    const sel = Array.isArray(this.settings.selectedFolders) ? this.settings.selectedFolders : [];
    const root = this.getVaultPath();
    return sel.filter(function (name) {
      // 只保留真实存在的目录，避免 git add 报 pathspec 不匹配
      try {
        return fs.statSync(path.join(root, name)).isDirectory();
      } catch (e) {
        return false;
      }
    });
  }

  // 把设置里的多行路径转成 git pathspec。
  // 空列表 = 整个仓库；非空 = 只处理这些目录（笔记同步和插件同步互不干扰）
  pathSpec() {
    const raw = String(this.settings.syncPaths || "").trim();
    if (!raw) return [];
    const root = this.getVaultPath();
    const self = this;
    return raw
      .split(/\r?\n/)
      .map(function (s) {
        return s
          .trim()
          .replace(/^\.\//, "")      // 只去掉 "./" 前缀
          .replace(/^\/+/, "")       // 只去掉开头的斜杠
          .replace(/[\\/]+$/, "");  // 去掉尾部斜杠（保留 .obsidian 开头的点）
      })
      .filter(function (s) { return s.length > 0; })
      // 目录还不存在时不能传给 git，否则 git add 会 fatal: pathspec did not match
      .filter(function (s) { return fs.existsSync(path.join(root, s)); })
      .filter(function (s) { return s !== ".git" && s.indexOf(".git/") !== 0; });
  }

  // 把「当前 vault」作为 pathspec 前缀：多 vault 时只影响本 vault
  async scopedSpec(spec) {
    const list = (spec || []).slice();
    if (await this.isVaultAtRepoRoot()) {
      return list; // vault 就是仓库根，无需限定
    }
    // vault 是子目录：所有路径都相对 vault 根，git 在 vault 目录下执行时天然限定
    // 但为了安全（比如 spec 为空表示"整个 vault"），加 "." 显式限定
    return list.length ? list : ["."];
  }

  async hasChanges(spec) {
    const args = ["status", "--porcelain"];
    if (spec && spec.length) args.push("--");
    const r = await this.runGit(spec && spec.length ? args.concat(spec) : args);
    return r.stdout.trim().length > 0;
  }

  async commitAll(message) {
    // 优先用「选中的文件夹」，没选则回退到 syncPaths，再没有就整仓
    let spec = this.selectedPathSpec();
    if (spec.length === 0) spec = this.pathSpec();
    const rawConfigured = String(this.settings.syncPaths || "").trim();
    // 配置了范围但目录一个都还没建：退化为整仓提交，避免「同步成功但什么都没存」
    if (rawConfigured && spec.length === 0) {
      this.lastSpecFallback = true;
      const addAll = ["add", "-A"];
      await this.runGit(addAll);
      if (!(await this.hasChanges([]))) return false;
      await this.runGit(["commit", "-m", message]);
      return true;
    }
    this.lastSpecFallback = false;
    // 关键：vault 是子目录时，必须加 "." 限定，否则 git add -A 会扫到兄弟 vault
    const scoped = await this.scopedSpec(spec);
    const addArgs = ["add", "-A"];
    if (scoped.length) addArgs.push("--");
    await this.runGit(scoped.length ? addArgs.concat(scoped) : addArgs);
    if (!(await this.hasChanges(scoped))) return false;
    const commitArgs = ["commit", "-m", message];
    if (scoped.length) commitArgs.push("--");
    await this.runGit(scoped.length ? commitArgs.concat(scoped) : commitArgs);
    return true;
  }

  ensureRepoFiles() {
    const root = this.getVaultPath();
    const gi = path.join(root, ".gitignore");
    const ga = path.join(root, ".gitattributes");
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, GITIGNORE, "utf8");
    if (!fs.existsSync(ga)) fs.writeFileSync(ga, GITATTRIBUTES, "utf8");
  }

  async ensureIdentity() {
    const name = String(this.settings.userName || this.settings.username || "").trim();
    let email = String(this.settings.userEmail || "").trim();
    if (!email && this.settings.username) email = this.settings.username + "@users.noreply.github.com";
    if (name) await this.runGit(["config", "user.name", name]);
    if (email) await this.runGit(["config", "user.email", email]);
  }

  async pushWithHint() {
    try {
      await this.runGit(["push", this.authedUrl(), this.settings.branch || "main"], { timeout: 180000 });
    } catch (e) {
      const t = errText(e);
      if (/rejected|non-fast-forward|fetch first/i.test(t)) {
        throw new Error("远程仓库已有内容，无法直接覆盖。请先执行「下载（拉取远程）」，或换一个空的仓库。\n" + tail(t, 4));
      }
      if (/Authentication failed|could not read Username|403|401|Permission denied/i.test(t)) {
        throw new Error("认证失败：请检查用户名和访问令牌（PAT 需要 Contents 读写权限）。\n" + tail(t, 4));
      }
      throw e;
    }
  }

  async pullWithHint() {
    try {
      await this.runGit(
        ["pull", "--no-rebase", "--no-edit", this.authedUrl(), this.settings.branch || "main"],
        { timeout: 180000 }
      );
    } catch (e) {
      const t = errText(e);
      if (/CONFLICT|Automatic merge failed/i.test(t)) {
        throw new Error("拉取时出现冲突，请在 Obsidian 里手动解决冲突后再执行「同步」。\n" + tail(t, 6));
      }
      // 远程还是空仓库（第一次同步前）：pull 失败是正常的，交给后面的 push 建分支
      if (/couldn't find remote ref|no such ref|not our ref|does not appear to be a git repository/i.test(t)) {
        return;
      }
      throw e;
    }
  }

  async doInit() {
    this.requireRemote();
    if (!this.isRepo()) {
      await this.runGit(["init"]);
      await this.runGit(["symbolic-ref", "HEAD", "refs/heads/" + (this.settings.branch || "main")]);
    }
    this.ensureRepoFiles();
    await this.ensureIdentity();
    await this.runGit(["remote", "remove", "origin"]).catch(function () {});
    await this.runGit(["remote", "add", "origin", String(this.settings.remoteUrl).trim()]);
    const committed = await this.commitAll("初始提交 " + stamp());
    await this.pushWithHint();
    // init 后仓库结构变了，清缓存重新探测
    this._repoRoot = undefined;
    this._vaultPrefix = undefined;
    await this.detectRepoRoot();
    await this.vaultPrefix();
    this.markSynced(committed ? "首次上传完成" : "首次上传完成（无新改动）", false);
  }

  async doUpload() {
    this.requireRepo();
    const committed = await this.commitAll("vault sync " + stamp());
    await this.pushWithHint();
    this.markSynced(committed ? "已上传" : "已上传（无新改动）", false);
  }

  async doDownload() {
    this.requireRepo();
    await this.pullWithHint();
    this.markSynced("已下载", false);
  }

  async doSync(silent) {
    this.requireRepo();
    const committed = await this.commitAll("vault sync " + stamp());
    await this.pullWithHint();
    await this.pushWithHint();
    this.markSynced(committed ? "已同步" : "已同步（无新改动）", silent);
  }

  // 插件源码目录 → .obsidian/plugins/<id>/
  // 只复制 Obsidian 真正加载的文件，跳过 README/测试/数据文件
  async doInstallToObsidian() {
    const root = this.getVaultPath();
    const rawSrc = String(this.settings.pluginSourceDir || "plugins/simple-git-sync").trim();
    const pluginId = (this.manifest && this.manifest.id) || "simple-git-sync";
    // 支持绝对路径（源码放在 vault 外）和相对路径（源码在 vault 内）
    const isAbs = path.isAbsolute(rawSrc) || /^[A-Za-z]:[\\/]/.test(rawSrc);
    const srcDir = isAbs
      ? path.normalize(rawSrc)
      : path.join(root, rawSrc
          // 注意：只去掉 "./" 前缀和首尾斜杠，绝不能剥掉开头的点（.obsidian 会被毁）
          .replace(/^\.\//, "")
          .replace(/^[\\/]+/, "")
          .replace(/[\\/]+$/, ""));
    const dstDir = path.join(root, ".obsidian", "plugins", pluginId);

    if (!fs.existsSync(srcDir)) {
      throw new Error("找不到插件源码目录：\n" + srcDir + "\n请在设置里检查「插件源码目录」（可填 vault 外的绝对路径）。");
    }
    if (path.resolve(srcDir) === path.resolve(dstDir)) {
      throw new Error("插件源码目录和插件安装目录是同一个目录，无需安装。");
    }

    const FILES = ["main.js", "manifest.json", "styles.css"];
    const copied = [];
    const missing = [];

    // manifest 必须存在，否则装了也加载不了
    if (!fs.existsSync(path.join(srcDir, "manifest.json"))) {
      throw new Error("源码目录里没有 manifest.json，无法安装。");
    }
    if (!fs.existsSync(path.join(srcDir, "main.js"))) {
      throw new Error("源码目录里没有 main.js，无法安装。");
    }

    fs.mkdirSync(dstDir, { recursive: true });

    for (const f of FILES) {
      const from = path.join(srcDir, f);
      const to = path.join(dstDir, f);
      if (!fs.existsSync(from)) {
        if (f !== "styles.css") missing.push(f); // styles.css 可选
        continue;
      }
      // 内容一致就跳过，避免无谓的重载提示
      const same = fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to));
      if (same) continue;
      fs.copyFileSync(from, to);
      copied.push(f);
    }

    // 校验 manifest 里的 id 是否与目标目录一致，防止装了却加载不到
    let manifestId = "";
    try {
      manifestId = JSON.parse(fs.readFileSync(path.join(dstDir, "manifest.json"), "utf8")).id || "";
    } catch (e) {
      throw new Error("manifest.json 解析失败：" + e.message);
    }

    const lines = [];
    lines.push("源码目录: " + srcDir);
    lines.push("安装目录: .obsidian/plugins/" + pluginId);
    lines.push("");
    if (copied.length === 0) {
      lines.push("文件已是最新，无需安装。");
    } else {
      lines.push("已复制 " + copied.length + " 个文件：");
      copied.forEach(function (f) { lines.push("  · " + f); });
    }
    if (missing.length) {
      lines.push("");
      lines.push("注意：源码目录缺少 " + missing.join(", "));
    }
    if (manifestId && manifestId !== pluginId) {
      lines.push("");
      lines.push("⚠️ manifest.json 里的 id 是 \"" + manifestId + "\"，与安装目录名 \"" + pluginId + "\" 不一致，Obsidian 可能加载失败。");
    }

    this.markSynced(copied.length ? "已安装到 .obsidian" : "插件已是最新", false);

    const self = this;
    new InstallResultModal(
      this.app,
      "安装到 .obsidian",
      lines,
      copied.length > 0,
      async function () {
        // 用 Obsidian 官方 API 重载本插件
        const plugins = self.app.plugins;
        if (plugins && typeof plugins.disablePlugin === "function" && typeof plugins.enablePlugin === "function") {
          try {
            await plugins.disablePlugin(self.manifest.id);
            await plugins.enablePlugin(self.manifest.id);
            new Notice("插件已重载。");
            return;
          } catch (e) {
            new Notice("自动重载失败，请手动重启 Obsidian：" + errText(e), 10000);
            return;
          }
        }
        new Notice("当前 Obsidian 版本不支持自动重载，请重启 Obsidian。", 10000);
      }
    ).open();
  }

  doChooseFolders() {
    const folders = this.listFolders();
    const current = Array.isArray(this.settings.selectedFolders) ? this.settings.selectedFolders : [];
    const self = this;
    new FolderPickerModal(this.app, folders, current, async function (result) {
      self.settings.selectedFolders = result;
      await self.saveSettings();
      if (result.length === 0) {
        new Notice("已清空选择：之后同步会处理整个仓库。");
      } else {
        new Notice("已选择 " + result.length + " 个文件夹：" + result.join("、"));
      }
      self.updateStatusIdle();
    }).open();
  }

  async doSyncSelected() {
    this.requireRepo();
    const spec = this.selectedPathSpec();
    if (spec.length === 0) {
      throw new Error("还没有选择文件夹。请先执行命令「选择要同步的文件夹」。");
    }
    const committed = await this.commitAll("vault sync " + stamp());
    await this.pullWithHint();
    await this.pushWithHint();
    this.markSynced(
      (committed ? "已同步 " : "已同步（无改动）") + spec.join("、"),
      false
    );
  }

  async doAbortMerge() {
    this.requireRepo();
    await this.runGit(["merge", "--abort"]).catch(function () {});
    new Notice("已取消未完成的合并。");
    this.setStatus("就绪");
  }

  async guard(fn) {
    if (this.syncing) {
      new Notice("正在同步中，请稍候…");
      return;
    }
    // 每次操作重新探测仓库结构（可能刚 init 或换了 vault）
    this._repoRoot = undefined;
    this._vaultPrefix = undefined;
    this.syncing = true;
    this.setStatus("同步中…");
    try {
      await fn();
    } catch (e) {
      new Notice("同步失败：" + tail(errText(e), 6), 12000);
      this.setStatus("失败");
      console.error("[simple-git-sync]", e);
    } finally {
      this.syncing = false;
    }
  }

  markSynced(msg, silent) {
    this.settings.lastSyncAt = Date.now();
    this.settings.lastSyncResult = msg;
    this.saveData(this.settings);
    this.setStatus(msg);
    if (!silent) new Notice("Git 同步：" + msg);
  }

  setStatus(text) {
    if (!this.statusBar) return;
    if (text === "就绪") {
      const sel = this.selectedPathSpec();
      if (sel.length === 1) text = "就绪 · " + sel[0];
      else if (sel.length > 1) text = "就绪 · " + sel[0] + " 等 " + sel.length + " 个";
      else text = "就绪 · 未选文件夹";
    }
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    this.statusBar.setText("Git · " + text + " " + hh + ":" + mm);
  }

  updateStatusIdle() {
    this.setStatus("就绪");
  }

  restartTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const s = this.settings;
    if (!s || !s.autoSync) return;
    const minutes = Math.max(1, Number(s.autoSyncMinutes) || 10);
    const self = this;
    this.timer = setInterval(function () {
      if (self.syncing) return;
      if (!self.isRepo()) return;
      if (!String(self.settings.remoteUrl || "").trim()) return;
      self.guard(function () { return self.doSync(true); });
    }, minutes * 60 * 1000);
    if (!this.timerRegistered) {
      this.registerInterval(this.timer);
      this.timerRegistered = true;
    }
  }

  showStatus() {
    new ControlPanelModal(this.app, this).open();
  }
}

class SimpleGitSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const c = this.containerEl;
    c.empty();
    c.createEl("h2", { text: "Simple Git Sync 设置" });

    new Setting(c)
      .setName("仓库地址")
      .setDesc("GitHub 仓库的 HTTPS 地址，以 .git 结尾")
      .addText(function (t) {
        return t
          .setPlaceholder("https://github.com/用户名/仓库名.git")
          .setValue(this.plugin.settings.remoteUrl)
          .onChange(async function (v) {
            this.plugin.settings.remoteUrl = v.trim();
            await this.plugin.saveSettings();
          }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("分支")
      .setDesc("默认 main")
      .addText(function (t) {
        return t.setValue(this.plugin.settings.branch).onChange(async function (v) {
          this.plugin.settings.branch = v.trim() || "main";
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("GitHub 用户名")
      .addText(function (t) {
        return t.setValue(this.plugin.settings.username).onChange(async function (v) {
          this.plugin.settings.username = v.trim();
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("访问令牌 (PAT)")
      .setDesc("GitHub → Settings → Developer settings → Fine-grained tokens，权限只需 Contents: Read and write")
      .addText(function (t) {
        t.inputEl.type = "password";
        return t.setValue(this.plugin.settings.token).onChange(async function (v) {
          this.plugin.settings.token = v.trim();
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("提交作者名")
      .setDesc("留空则使用 GitHub 用户名")
      .addText(function (t) {
        return t.setValue(this.plugin.settings.userName).onChange(async function (v) {
          this.plugin.settings.userName = v.trim();
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("提交作者邮箱")
      .setDesc("留空则使用 用户名@users.noreply.github.com")
      .addText(function (t) {
        return t.setValue(this.plugin.settings.userEmail).onChange(async function (v) {
          this.plugin.settings.userEmail = v.trim();
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("Git 可执行文件路径")
      .setDesc("一般留 git 即可；找不到 git 时填 where git 输出的完整路径")
      .addText(function (t) {
        return t.setValue(this.plugin.settings.gitPath).onChange(async function (v) {
          this.plugin.settings.gitPath = v.trim() || "git";
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("插件源码目录")
      .setDesc("存放 main.js / manifest.json 的目录（相对 vault 根目录）。用于「安装到 .obsidian」命令")
      .addText(function (t) {
        return t
          .setPlaceholder("plugins/simple-git-sync")
          .setValue(this.plugin.settings.pluginSourceDir)
          .onChange(async function (v) {
            this.plugin.settings.pluginSourceDir = v.trim();
            await this.plugin.saveSettings();
          }.bind(this));
      }.bind(this));

    const selFolders = Array.isArray(this.plugin.settings.selectedFolders) ? this.plugin.settings.selectedFolders : [];
    new Setting(c)
      .setName("要同步的文件夹")
      .setDesc(
        selFolders.length === 0
          ? "未选择：同步时处理整个仓库。点「选择」挑要同步的文件夹。"
          : "当前选中 " + selFolders.length + " 个：" + selFolders.join("、")
      )
      .addButton(function (b) {
        return b.setButtonText("选择").setCta().onClick(function () {
          this.plugin.doChooseFolders();
          setTimeout(function () { this.display(); }.bind(this), 500);
        }.bind(this));
      }.bind(this))
      .addButton(function (b) {
        return b.setButtonText("清空").onClick(async function () {
          this.plugin.settings.selectedFolders = [];
          await this.plugin.saveSettings();
          this.plugin.updateStatusIdle();
          this.display();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("同步范围")
      .setDesc("每行一个目录。留空 = 整个仓库。例如：notes 和 .obsidian（不含插件目录），这样笔记同步不会碰 plugins/")
      .addTextArea(function (t) {
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
        return t
          .setPlaceholder("notes\n.obsidian")
          .setValue(this.plugin.settings.syncPaths)
          .onChange(async function (v) {
            this.plugin.settings.syncPaths = v;
            await this.plugin.saveSettings();
          }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("自动同步")
      .setDesc("按间隔自动执行「提交 + 拉取 + 推送」")
      .addToggle(function (t) {
        return t.setValue(this.plugin.settings.autoSync).onChange(async function (v) {
          this.plugin.settings.autoSync = v;
          await this.plugin.saveSettings();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("自动同步间隔（分钟）")
      .addSlider(function (s) {
        return s
          .setLimits(1, 120, 1)
          .setValue(this.plugin.settings.autoSyncMinutes)
          .setDynamicTooltip()
          .onChange(async function (v) {
            this.plugin.settings.autoSyncMinutes = v;
            await this.plugin.saveSettings();
          }.bind(this));
      }.bind(this));

    c.createEl("h3", { text: "操作" });

    new Setting(c)
      .setName("安装到 .obsidian")
      .setDesc("把源码目录里的 main.js / manifest.json 复制到 .obsidian/plugins，装完可直接重载")
      .addButton(function (b) {
        return b.setButtonText("安装").setCta().onClick(async function () {
          await this.plugin.guard(function () { return this.plugin.doInstallToObsidian(); }.bind(this));
          this.display();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("初始化仓库并首次上传")
      .setDesc("在当前 vault 目录 git init、写入 .gitignore/.gitattributes、提交并推送")
      .addButton(function (b) {
        return b.setButtonText("执行").setCta().onClick(async function () {
          await this.plugin.guard(function () { return this.plugin.doInit(); }.bind(this));
          this.display();
        }.bind(this));
      }.bind(this));

    new Setting(c)
      .setName("测试连接")
      .setDesc("执行 git ls-remote，验证地址和令牌是否可用")
      .addButton(function (b) {
        return b.setButtonText("测试").onClick(async function () {
          try {
            await this.plugin.runGit(["ls-remote", this.plugin.authedUrl(), "HEAD"], { timeout: 60000 });
            new Notice("连接成功 ✓");
          } catch (e) {
            new Notice("连接失败：" + tail(errText(e), 4), 12000);
          }
        }.bind(this));
      }.bind(this));

    c.createEl("p", {
      text: "提示：设置（含令牌）保存在 .obsidian/plugins/simple-git-sync/data.json，该文件已自动写入 .gitignore，不会被上传。"
    });
  }
}

module.exports = SimpleGitSyncPlugin;
