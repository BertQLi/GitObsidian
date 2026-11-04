"use strict";

const { Plugin, PluginSettingTab, Setting, Notice, Modal, requestUrl, requireApiVersion } = require("obsidian");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { Script } = require("vm");
const UPDATE_REPO = "BertQLi/GitObsidian";
const UPDATE_API = "https://github.com/" + UPDATE_REPO + "/releases/latest/download/update.json";

const GITIGNORE = [
  "# 每台设备自己的界面布局，同步会冲突",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/cache",
  "",
  "# 本插件设置里存着访问令牌，绝对不能提交",
  ".obsidian/plugins/simple-git-sync/",
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
  autoUpdate: true,
  lastUpdateCheckAt: 0,
  autoSync: false,
  autoSyncMinutes: 10,
  lastSyncAt: 0,
  lastSyncResult: ""
};

function errText(e) {
  if (!e) return "";
  return String((e.stdout || "") + (e.stderr || "") + (e.message || "")).trim();
}

function redactGitText(value, token) {
  let result = String(value || "").replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1***:***@");
  if (token) {
    for (const secret of [token, encodeURIComponent(token)]) {
      if (secret) result = result.split(secret).join("***");
    }
  }
  return result;
}

function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function normalizeScopePath(value) {
  const raw = String(value || "").trim().replace(/^\.\//, "").replace(/[\\/]+$/, "");
  const parts = raw.replace(/\\/g, "/").split("/");
  if (!raw || raw === "." || path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) ||
      parts.some((part) => !part || part === "." || part === "..") ||
      /[\[\]*?]/.test(raw) || raw.startsWith(":")) {
    throw new Error("同步范围包含无效路径：" + value);
  }
  return parts.join("/");
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
    if (this.plugin.panels) this.plugin.panels.add(this);
    this.render();
  }

  render() {
    const p = this.plugin;
    const el = this.contentEl;
    el.empty();

    el.createEl("h3", { text: "Git 同步" });

    // 常用状态压成一行；完整仓库信息和同步记录放在“详细信息”。
    const info = el.createDiv();
    info.style.fontSize = "12px";
    info.style.color = "var(--text-muted)";
    info.style.lineHeight = "1.7";
    info.style.marginBottom = "12px";
    let state = "就绪";
    if (!p.isRepo()) state = p._repoRoot ? "仓库待调整" : "未初始化";
    else if (p.lastOperationError) state = "需要处理";
    else if (p.autoSyncPaused) state = "同步已暂停";
    else {
      const result = String(p.settings.lastSyncResult || "").match(/^(已同步|已上传|已下载)/);
      if (result) state = result[1];
    }
    const lastTime = p.settings.lastSyncAt ? new Date(p.settings.lastSyncAt).toLocaleString("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
    }) : "";
    info.setText([state, this.scopeText(), lastTime].filter(Boolean).join(" · "));
    const warning = p.lastOperationError || (p.autoSyncPaused ? "自动同步已暂停，请先处理合并冲突。" :
      (!p.isRepo() && p._repoRoot ? "位于父仓库内，请拆分仓库后同步。" : ""));
    if (warning) {
      const message = el.createEl("p", { text: warning });
      message.style.fontSize = "12px";
      message.style.color = "var(--text-error)";
    }

    const busy = p.syncing || p.updating;
    const mkBtn = (parent, label, cta, onClick, tooltip) => {
      const b = parent.createEl("button", { text: label });
      b.style.marginRight = "6px";
      b.style.marginBottom = "6px";
      b.disabled = !!busy;
      if (cta) b.addClass("mod-cta");
      if (tooltip) b.title = tooltip;
      b.addEventListener("click", async () => {
        if (p.syncing || p.updating) return;
        const pending = onClick();
        this.render();
        await pending;
        if (p.unloaded) { this.close(); return; }
        this.detailText = undefined;
        this.render();
      });
      return b;
    };
    const run = (fn) => p.guard(fn);
    const primary = el.createDiv();
    const label = busy ? (p.phase || "处理中…") : (p.isRepo() ? "立即同步" : "初始化并首次同步");
    mkBtn(primary, label, true, () => run(() => p.isRepo() ? p.doSync(false) : p.doInit()),
      "同步当前提交范围");

    const options = el.createDiv();
    mkBtn(options, "提交范围", false, async () => p.doChooseFolders(() => this.render()));
    mkBtn(options, "检查更新", false, () => run(() => p.checkForUpdates(false)));
    options.createEl("small", { text: "v" + p.manifest.version });

    const advanced = el.createEl("details");
    advanced.style.marginTop = "12px";
    advanced.createEl("summary", { text: "高级操作" });
    const actions = advanced.createDiv();
    actions.style.marginTop = "8px";
    mkBtn(actions, "仅上传", false, () => run(() => p.doUpload()), "提交所选范围并推送整个分支，不下载");
    mkBtn(actions, "仅下载", false, () => run(() => p.doDownload()), "拉取整个分支，不提交本地改动");
    mkBtn(actions, "同步整个 vault", false, () => run(() => p.doSync(false, true)), "本次忽略提交范围，包含整个 vault");
    if (p.isRepo()) mkBtn(actions, "取消未完成的合并", false, () => run(() => p.doAbortMerge()));
    mkBtn(actions, "从本地源码安装", false, () => run(() => p.doInstallToObsidian()));
    mkBtn(actions, "刷新状态", false, async () => { this.detailText = undefined; });

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

  scopeText() {
    const p = this.plugin;
    try {
      const sel = p.selectedPathSpec();
      if (Array.isArray(p.settings.selectedFolders) && p.settings.selectedFolders.length) {
        return sel.length ? sel.join("、") : "所选文件夹不存在";
      }
      if (String(p.settings.syncPaths || "").trim()) {
        const paths = p.pathSpec();
        return paths.length ? paths.join("、") : "配置的范围不存在";
      }
      return "整个 vault";
    } catch (e) {
      return "范围配置无效";
    }
  }

  buildDetailText() {
    const p = this.plugin;
    const lines = [];
    lines.push("仓库状态: " + (p.isRepo() ? "已初始化（当前 vault 是独立仓库）" : "未初始化"));
    lines.push("仓库目录: " + p.getVaultPath());
    lines.push("提交范围: " + this.scopeText());
    lines.push("上次成功: " + (p.settings.lastSyncAt ? new Date(p.settings.lastSyncAt).toLocaleString("zh-CN") : "从未"));
    lines.push("上次结果: " + (p.settings.lastSyncResult || "无"));
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
    if (this.plugin.panels) this.plugin.panels.delete(this);
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
      text: "只提交并推送勾选的文件夹；拉取远程时仍可能更新其他文件夹。"
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
    this.panels = new Set();
    this.updating = false;
    this.unloaded = false;

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
    this.addCommand({ id: "hide-repo-files", name: "隐藏 .gitignore / .gitattributes（从仓库移除）", callback: () => this.guard(() => this.doHideRepoFiles()) });
    this.addCommand({ id: "check-update", name: "检查插件更新", callback: () => this.guard(() => this.checkForUpdates(false)) });

    this.addSettingTab(new SimpleGitSyncSettingTab(this.app, this));
    await this.detectRepoRoot();
    await this.loadRemoteFromOrigin();
    this.updateStatusIdle();
    this.restartTimer();
    this.restartUpdateTimer();
  }

  onunload() {
    this.unloaded = true;
    if (this.panels) Array.from(this.panels).forEach((panel) => panel.close());
    clearTimeout(this.updateTimer);
    clearInterval(this.updateInterval);
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
    this.restartUpdateTimer();
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
            const token = String(self.settings.token || "").trim();
            const safe = new Error(redactGitText(err.message, token));
            safe.code = err.code;
            safe.stdout = redactGitText(stdout, token);
            safe.stderr = redactGitText(stderr, token);
            reject(safe);
            return;
          }
          resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
        }
      );
    });
  }

  // 每个 vault 必须有自己的 .git；父目录的仓库不算当前 vault 的仓库。
  isRepo() {
    try {
      return fs.existsSync(path.join(this.getVaultPath(), ".git"));
    } catch (err) {
      return false;
    }
  }

  // 用于识别误放在父目录的旧仓库；不把它当作当前 vault 的仓库。
  async detectRepoRoot() {
    try {
      const r = await this.runGit(["rev-parse", "--show-toplevel"], { timeout: 5000 });
      this._repoRoot = r.stdout.trim().replace(/\\/g, "/");
    } catch (e) {
      this._repoRoot = null;
    }
    return this._repoRoot;
  }

  async loadRemoteFromOrigin() {
    if (!this.isRepo() || String(this.settings.remoteUrl || "").trim()) return;
    try {
      const r = await this.runGit(["remote", "get-url", "origin"], { timeout: 5000 });
      let remote = r.stdout.trim();
      if (/^https?:\/\//i.test(remote)) {
        const u = new URL(remote);
        u.username = "";
        u.password = "";
        remote = u.toString();
      }
      if (remote) {
        this.settings.remoteUrl = remote;
        await this.saveData(this.settings);
      }
    } catch (e) {
      // 未设置 origin 时仍可在插件设置里手动填写。
    }
  }

  requireRepo() {
    if (!this.isRepo()) {
      throw new Error("当前 vault 根目录不是独立 Git 仓库。请在此初始化，或将远程仓库克隆为这个 vault。");
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
      const safe = normalizeScopePath(name);
      if (safe !== name || safe.includes("/")) throw new Error("选中的文件夹路径无效：" + name);
      // 只保留真实存在的目录，避免 git add 报 pathspec 不匹配
      try {
        return fs.statSync(path.join(root, safe)).isDirectory();
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
    return raw
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .map(normalizeScopePath)
      // 目录还不存在时不能传给 git，否则 git add 会 fatal: pathspec did not match
      .filter(function (s) { return fs.existsSync(path.join(root, s)); })
      .filter(function (s) { return s !== ".git" && s.indexOf(".git/") !== 0; });
  }

  async hasChanges(spec) {
    const args = ["status", "--porcelain"];
    if (spec && spec.length) args.push("--");
    const r = await this.runGit(spec && spec.length ? args.concat(spec) : args);
    return r.stdout.trim().length > 0;
  }

  async commitAll(message, forceAll) {
    this.requireRepo();
    const unmerged = await this.runGit(["diff", "--name-only", "--diff-filter=U", "-z"]);
    if (unmerged.stdout) {
      this.autoSyncPaused = true;
      throw new Error("仍有未解决的合并冲突，请先解决冲突或取消合并，再同步。");
    }
    // 配置过范围时，绝不能因目录暂时不存在而提交整仓。
    const selected = Array.isArray(this.settings.selectedFolders) ? this.settings.selectedFolders : [];
    const configured = String(this.settings.syncPaths || "").trim();
    const spec = forceAll ? [] : (selected.length ? this.selectedPathSpec() : this.pathSpec());
    if (!forceAll && (selected.length || configured) && spec.length === 0) {
      throw new Error("配置的同步文件夹不存在，请检查同步范围；本次没有提交任何文件。");
    }
    await this.ensureRepoFiles();
    await this.assertNoTrackedPrivateFiles();
    // 优先用「选中的文件夹」，没选则回退到 syncPaths，再没有就整仓
    const scoped = spec;
    const addArgs = ["add", "-A"];
    if (scoped.length) addArgs.push("--");
    await this.runGit(scoped.length ? addArgs.concat(scoped) : addArgs);

    if (!(await this.hasChanges(scoped))) return false;

    // 带 pathspec 提交，避免把其他已暂存的改动混进选定文件夹。
    const commitArgs = ["commit", "-m", message];
    if (scoped.length) commitArgs.push("--");
    await this.runGit(scoped.length ? commitArgs.concat(scoped) : commitArgs);
    return true;
  }

  // 必须排除的文件（硬编码，不依赖 .gitignore 是否存在）
  // 这些规则同时写进 .git/info/exclude —— 它不进仓库，所以远程看不到 .gitignore
  protectedPatterns() {
    return [
      "**/.obsidian/plugins/simple-git-sync/",
      "**/.obsidian/plugins/simple-git-sync/.update-backup/",
      "**/.obsidian/plugins/simple-git-sync/.update-*.tmp",
      "**/.obsidian/workspace.json",
      "**/.obsidian/workspace-mobile.json",
      "**/.obsidian/cache",
      "**/.obsidian/plugins/*/data.json",
      "**/.trash/",
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      "*.tmp",
      // 仓库根这两个文件也不上传（本插件自己维护）
      // 注意：不能写 "/.gitignore"，exclude 里的前导斜杠不匹配，要用不带斜杠的写法
      ".gitignore",
      ".gitattributes"
    ];
  }

  // 把保护规则写进 .git/info/exclude（本地生效，不随仓库同步）
  async ensureRepoFiles() {
    // 写 .gitignore / .gitattributes 到文件系统（本地仍需要，git 读它们）
    const root = this.getVaultPath();
    const gi = path.join(root, ".gitignore");
    const ga = path.join(root, ".gitattributes");
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, GITIGNORE, "utf8");
    if (!fs.existsSync(ga)) fs.writeFileSync(ga, GITATTRIBUTES, "utf8");

    // 关键：把它们本身加入本地 exclude，这样不会被提交
    try {
      // 注意：--git-path 返回相对当前目录的路径，在 vault 子目录里会拼错
      // 用 --absolute-git-dir 拿绝对路径
      const r = await this.runGit(["rev-parse", "--absolute-git-dir"]);
      const gitDir = r.stdout.trim().replace(/\\/g, "/");
      const excludePath = path.join(gitDir, "info", "exclude");
      const marker = "# simple-git-sync";
      const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
      const rules = existing.split(/\r?\n/);
      const missing = this.protectedPatterns().filter((rule) => !rules.includes(rule));
      if (missing.length) {
        const block = "\n" + marker + "\n" + missing.join("\n") + "\n";
        fs.mkdirSync(path.dirname(excludePath), { recursive: true });
        fs.appendFileSync(excludePath, block, "utf8");
      }
    } catch (e) {
      throw new Error("无法写入 Git 本地排除规则，已停止提交以保护访问令牌：" + errText(e));
    }
  }

  async assertNoTrackedPrivateFiles() {
    const r = await this.runGit(["ls-files", "-z", "--cached"]);
    const files = r.stdout.split("\0").filter(Boolean);
    const privateFiles = files.filter(function (file) {
      const name = file.replace(/\\/g, "/");
      return /(^|\/)\.obsidian\/(workspace(?:-mobile)?\.json|cache(?:\/|$))/.test(name) ||
        /(^|\/)\.obsidian\/plugins\/[^/]+\/data\.json$/.test(name);
    });
    if (privateFiles.length) {
      throw new Error("这些本地私有文件已被 Git 跟踪，已停止同步以免上传令牌或设备状态：" +
        privateFiles.join("、") + "。请先用 git rm --cached 移除跟踪，并检查远程历史。");
    }
  }

  // 检查索引里是否有已删除的条目（用于捕获 .gitxxx 的移除）
  async hasStagedRemoval() {
    try {
      const r = await this.runGit(["diff", "--cached", "--name-only", "--diff-filter=D"]);
      return r.stdout.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  // 如果 .gitignore/.gitattributes 之前被跟踪过，从索引移除（本地文件保留）
  async untrackRepoFiles() {
    // 注意：在 vault 子目录执行时，":.gitignore" 会被解析成 vaultA/.gitignore
    // 必须用 ":(top)" 魔法前缀指向仓库根
    for (const f of [".gitignore", ".gitattributes"]) {
      await this.runGit(["rm", "--cached", "--ignore-unmatch", "--", ":(top)" + f]);
    }
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
      await this.runGit(["push", this.authedUrl(), "HEAD:refs/heads/" + (this.settings.branch || "main")], { timeout: 180000 });
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
      return true;
    } catch (e) {
      const t = errText(e);
      if (/CONFLICT|Automatic merge failed/i.test(t)) {
        this.autoSyncPaused = true;
        throw new Error("拉取时出现冲突，请在 Obsidian 里手动解决冲突后再执行「同步」。\n" + tail(t, 6));
      }
      // 远程还是空仓库（第一次同步前）：pull 失败是正常的，交给后面的 push 建分支
      if (/couldn't find remote ref|no such ref|not our ref/i.test(t)) {
        return false;
      }
      throw e;
    }
  }

  async doInit() {
    if (this.isRepo()) throw new Error("当前 vault 已位于 Git 仓库中，请用「上传」；初始化会改动现有仓库的远程配置。");
    const parentRoot = await this.detectRepoRoot();
    if (parentRoot) throw new Error("当前 vault 位于父目录的 Git 仓库内。请先把每个 vault 拆成独立仓库，再初始化。");
    this.requireRemote();
    await this.runGit(["init"]);
    await this.runGit(["symbolic-ref", "HEAD", "refs/heads/" + (this.settings.branch || "main")]);
    await this.ensureRepoFiles();
    await this.ensureIdentity();
    await this.runGit(["remote", "add", "origin", String(this.settings.remoteUrl).trim()]);
    const committed = await this.commitAll("初始提交 " + stamp());
    await this.pushWithHint();
    // init 后仓库结构变了，重新探测。
    await this.detectRepoRoot();
    this.markSynced(committed ? "首次上传完成" : "首次上传完成（无新改动）", false);
  }

  async doUpload() {
    this.requireRepo();
    await this.ensureIdentity();
    this.setPhase("提交并上传…");
    const committed = await this.commitAll("vault sync " + stamp());
    await this.pushWithHint();
    this.markSynced(committed ? "已上传" : "已上传（无新改动）", false);
  }

  async doDownload() {
    this.requireRepo();
    this.setPhase("下载远程改动…");
    const pulled = await this.pullWithHint();
    this.markSynced(pulled ? "已下载" : "远程暂无可下载内容", false);
  }

  async doSync(silent, forceAll) {
    this.requireRepo();
    await this.ensureIdentity();
    this.setPhase("1/3 保存本地改动…");
    const committed = await this.commitAll("vault sync " + stamp(), forceAll);
    this.setPhase("2/3 合并远程改动…");
    await this.pullWithHint();
    this.setPhase("3/3 上传…");
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

  doChooseFolders(onSaved) {
    const folders = this.listFolders();
    const current = Array.isArray(this.settings.selectedFolders) ? this.settings.selectedFolders : [];
    const self = this;
    new FolderPickerModal(this.app, folders, current, async function (result) {
      self.settings.selectedFolders = result;
      self.settings.syncPaths = "";
      await self.saveSettings();
      if (result.length === 0) {
        new Notice("已清空选择：之后同步会处理整个仓库。");
      } else {
        new Notice("已选择 " + result.length + " 个文件夹：" + result.join("、"));
      }
      self.updateStatusIdle();
      if (onSaved) onSaved();
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

  // 把 .gitignore/.gitattributes 从仓库移除，同时保证保护规则仍然生效
  async doHideRepoFiles() {
    this.requireRepo();
    await this.ensureRepoFiles();   // 确保本地文件存在 + info/exclude 已写入
    await this.assertNoTrackedPrivateFiles();
    const staged = await this.runGit(["diff", "--cached", "--name-only"]);
    if (staged.stdout.trim()) throw new Error("索引中已有暂存改动，请先处理这些改动，再隐藏 .gitignore/.gitattributes。");
    await this.untrackRepoFiles();  // 从索引移除
    const committed = await this.hasStagedRemoval();
    if (committed) {
      await this.ensureIdentity();
      await this.runGit(["commit", "-m", "隐藏 .gitignore / .gitattributes（改用 .git/info/exclude）"]);
    }
    await this.pushWithHint();
    this.markSynced(committed ? "已隐藏 .gitxxx 并推送" : "已隐藏 .gitxxx", false);
  }

  async doAbortMerge() {
    this.requireRepo();
    const merge = await this.runGit(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).catch(function () { return null; });
    if (!merge) throw new Error("当前没有未完成的合并。");
    await this.runGit(["merge", "--abort"]);
    this.autoSyncPaused = false;
    this.lastOperationError = "";
    new Notice("已取消未完成的合并。");
    this.setStatus("就绪");
  }

  async guard(fn) {
    if (this.syncing || this.updating) {
      new Notice("正在处理中，请稍候…");
      return;
    }
    // 每次操作重新探测仓库结构（可能刚 init 或换了 vault）
    this._repoRoot = undefined;
    this.syncing = true;
    this.lastOperationError = "";
    this.setPhase("处理中…");
    try {
      await fn();
    } catch (e) {
      this.lastOperationError = (this.phase || "操作失败") + " " + tail(errText(e), 2);
      new Notice("操作失败：" + tail(errText(e), 6), 12000);
      this.setStatus("失败");
      console.error("[simple-git-sync]", e);
    } finally {
      this.syncing = false;
      this.phase = "";
      if (this.panels) this.panels.forEach((panel) => panel.render());
    }
  }

  setPhase(text) {
    this.phase = text;
    this.setStatus(text);
    if (this.panels) this.panels.forEach((panel) => panel.render());
  }

  markSynced(msg, silent) {
    this.lastOperationError = "";
    this.autoSyncPaused = false;
    this.settings.lastSyncAt = Date.now();
    this.settings.lastSyncResult = msg;
    this.saveData(this.settings);
    this.setStatus(msg);
    if (!silent) new Notice("Git 同步：" + msg);
  }

  setStatus(text) {
    if (!this.statusBar) return;
    if (text === "就绪") {
      let sel;
      try { sel = this.selectedPathSpec(); }
      catch (e) { sel = []; text = "范围配置错误"; }
      if (sel.length === 1) text = "就绪 · " + sel[0];
      else if (sel.length > 1) text = "就绪 · " + sel[0] + " 等 " + sel.length + " 个";
      else if (text === "就绪") text = String(this.settings.syncPaths || "").trim() ? "就绪 · 指定范围" : "就绪 · 整个 vault";
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
      if (self.syncing || self.updating || self.autoSyncPaused) return;
      if (!self.isRepo()) return;
      if (!String(self.settings.remoteUrl || "").trim()) return;
      self.guard(function () { return self.doSync(true); });
    }, minutes * 60 * 1000);
    if (!this.timerRegistered) {
      this.registerInterval(this.timer);
      this.timerRegistered = true;
    }
  }

  getPluginDir() {
    return path.join(this.getVaultPath(), this.app.vault.configDir || ".obsidian", "plugins", this.manifest.id || "simple-git-sync");
  }

  restartUpdateTimer() {
    clearTimeout(this.updateTimer);
    clearInterval(this.updateInterval);
    if (!this.settings.autoUpdate || typeof requestUrl !== "function" || this.unloaded) return;
    const check = () => this.checkForUpdates(true).catch((e) => console.error("[simple-git-sync] 更新检查失败", e.message));
    this.updateTimer = setTimeout(check, 30000);
    this.updateInterval = setInterval(check, 24 * 60 * 60 * 1000);
  }

  async checkForUpdates(automatic) {
    if (this.updating || (automatic && this.syncing) || this.unloaded) return;
    if (automatic && Date.now() - (this.settings.lastUpdateCheckAt || 0) < 24 * 60 * 60 * 1000) return;
    this.updating = true;
    try {
      this.setPhase("检查插件更新…");
      const response = await requestUrl({ url: UPDATE_API + "?check=" + Date.now(), headers: { "Cache-Control": "no-cache" }, throw: false });
      if (response.status === 404) {
        if (!automatic) new Notice("还没有正式发布的插件版本。");
        return;
      }
      if (response.status !== 200) throw new Error("更新服务返回 HTTP " + response.status + "，请稍后重试。");
      const release = response.json;
      if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name || "")) {
        throw new Error("更新服务返回了无效的正式版本。");
      }
      const version = release.tag_name.replace(/^v/, "");
      const current = this.installedUpdateVersion || this.manifest.version;
      if (compareVersions(version, current) <= 0) {
        if (!automatic) new Notice("当前已是最新版本 v" + current);
      } else {
        await this.installRelease(release, version);
      }
      if (!this.unloaded) {
        this.settings.lastUpdateCheckAt = Date.now();
        await this.saveData(this.settings);
      }
    } catch (e) {
      if (!automatic) throw e;
      console.error("[simple-git-sync] 自动更新失败", e.message);
    } finally {
      this.updating = false;
      this.phase = "";
      if (!this.unloaded) {
        this.updateStatusIdle();
        if (this.panels) this.panels.forEach((panel) => panel.render());
      }
    }
  }

  async downloadReleaseAsset(release, name) {
    const asset = (release.assets || []).find((a) => a.name === name);
    if (!asset) throw new Error("发布版本缺少 " + name);
    const expected = "https://github.com/" + UPDATE_REPO + "/releases/download/" + release.tag_name + "/" + name;
    if (asset.browser_download_url !== expected || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || "")) {
      throw new Error(name + " 的来源或校验信息无效，已停止更新。");
    }
    const response = await requestUrl({ url: expected, throw: false });
    if (response.status !== 200) throw new Error("下载 " + name + " 失败（HTTP " + response.status + "）。");
    const bytes = Buffer.from(response.arrayBuffer);
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024 || (asset.size && bytes.length !== asset.size)) {
      throw new Error(name + " 文件大小异常，已停止更新。");
    }
    const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    if (digest !== asset.digest) throw new Error(name + " 校验失败，已停止更新。");
    return bytes;
  }

  async installRelease(release, version) {
    this.setPhase("下载插件 v" + version + "…");
    const files = {};
    // 全部下载并校验成功后才接触安装目录。
    files["main.js"] = await this.downloadReleaseAsset(release, "main.js");
    files["manifest.json"] = await this.downloadReleaseAsset(release, "manifest.json");
    if ((release.assets || []).some((a) => a.name === "styles.css")) {
      files["styles.css"] = await this.downloadReleaseAsset(release, "styles.css");
    }
    const manifest = JSON.parse(files["manifest.json"].toString("utf8"));
    if (manifest.id !== this.manifest.id || manifest.version !== version || release.tag_name.replace(/^v/, "") !== version) {
      throw new Error("更新包的插件 ID 或版本不匹配。");
    }
    if (typeof requireApiVersion === "function" && !requireApiVersion(manifest.minAppVersion || "1.0.0")) {
      throw new Error("此版本需要 Obsidian " + manifest.minAppVersion + " 或更新版本。");
    }
    new Script(files["main.js"].toString("utf8"), { filename: "main.js" });

    const dir = this.getPluginDir();
    const backupDir = path.join(dir, ".update-backup");
    const old = {};
    const names = ["main.js", "styles.css", "manifest.json"];
    for (const name of names) {
      const file = path.join(dir, name);
      old[name] = fs.existsSync(file) ? fs.readFileSync(file) : null;
    }
    fs.mkdirSync(backupDir, { recursive: true });
    for (const name of names) {
      const target = path.join(backupDir, name);
      if (old[name]) fs.writeFileSync(target, old[name]);
      else if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    const restore = () => {
      for (const name of names) {
        const file = path.join(dir, name);
        if (old[name]) fs.writeFileSync(file, old[name]);
        else if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    };
    try {
      for (const name of Object.keys(files)) fs.writeFileSync(path.join(dir, ".update-" + name + ".tmp"), files[name]);
      // manifest 最后替换；若进程中断，下次检查仍会发现待更新版本。
      for (const name of names) {
        if (files[name]) fs.renameSync(path.join(dir, ".update-" + name + ".tmp"), path.join(dir, name));
        else if (name === "styles.css" && fs.existsSync(path.join(dir, name))) fs.unlinkSync(path.join(dir, name));
      }
      await this.saveData(this.settings);
      this.installedUpdateVersion = version;
      await this.reloadUpdatedPlugin(restore);
      new Notice("插件已更新到 v" + version + (this.unloaded ? "。" : "，重启 Obsidian 后生效。"), 8000);
    } catch (e) {
      restore();
      this.installedUpdateVersion = undefined;
      throw new Error("插件更新失败，已恢复上一版：" + e.message);
    } finally {
      for (const name of names) {
        const tmp = path.join(dir, ".update-" + name + ".tmp");
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    }
  }

  async reloadUpdatedPlugin(restore) {
    const plugins = this.app.plugins;
    const id = this.manifest.id;
    if (!plugins || typeof plugins.disablePlugin !== "function" || typeof plugins.enablePlugin !== "function") return;
    const previousManifest = plugins.manifests && plugins.manifests[id];
    const nextManifest = JSON.parse(fs.readFileSync(path.join(this.getPluginDir(), "manifest.json"), "utf8"));
    await plugins.disablePlugin(id);
    try {
      // enablePlugin 使用宿主缓存的 manifest，而不是重新读取磁盘。
      if (plugins.manifests) plugins.manifests[id] = Object.assign({}, previousManifest || this.manifest, nextManifest);
      await plugins.enablePlugin(id);
      if (plugins.plugins && (!plugins.plugins[id] || plugins.plugins[id].manifest.version !== this.installedUpdateVersion)) {
        throw new Error("新版插件未能加载");
      }
    } catch (e) {
      restore();
      if (plugins.manifests) plugins.manifests[id] = previousManifest || this.manifest;
      await plugins.enablePlugin(id);
      throw e;
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
      .setDesc("首次上传时填写仓库地址；从远程克隆的 vault 会自动读取 origin，也可在这里修改")
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
      .setName("提交范围（可选）")
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
      .setName("手动指定提交路径（可选）")
      .setDesc("每行一个目录，限制提交和推送的本地改动；拉取仍更新整个仓库。留空 = 当前 vault 的全部文件")
      .addTextArea(function (t) {
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
        return t
          .setPlaceholder("notes\n.obsidian")
          .setValue(this.plugin.settings.syncPaths)
          .onChange(async function (v) {
            this.plugin.settings.syncPaths = v;
            this.plugin.settings.selectedFolders = [];
            await this.plugin.saveSettings();
          }.bind(this));
      }.bind(this));

    c.createEl("h3", { text: "插件更新" });
    new Setting(c)
      .setName("自动更新插件")
      .setDesc("每天检查 GitHub 正式 Release，校验文件后安装并重载；保留上一版备份")
      .addToggle((t) => t.setValue(this.plugin.settings.autoUpdate).onChange(async (v) => {
        this.plugin.settings.autoUpdate = v;
        await this.plugin.saveSettings();
      }));
    new Setting(c)
      .setName("当前版本 v" + this.plugin.manifest.version)
      .setDesc("更新来源：github.com/BertQLi/GitObsidian")
      .addButton((b) => b.setButtonText("检查更新").onClick(async () => {
        await this.plugin.guard(() => this.plugin.checkForUpdates(false));
        this.display();
      }));

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
      text: "提示：设置（含令牌）保存在 .obsidian/plugins/simple-git-sync/data.json。同步前会设置本地排除规则；若文件已被 Git 跟踪，同步会停止。"
    });
  }
}

module.exports = SimpleGitSyncPlugin;
