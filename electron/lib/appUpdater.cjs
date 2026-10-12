'use strict';
/**
 * In-place App Updater for DeckRomM.
 *
 * Checks GitHub for newer commits/versions and performs in-place upgrades:
 *  - If running in a git clone: `git fetch`, `git reset --hard`, `npm install`, `npm run build`.
 *  - If running as an AppImage: fetches latest release asset, writes .new and atomically swaps.
 *  - If running as standalone files or source: clones/updates and rebuilds AppImage.
 *
 * Reports live progress over the `app:update-progress` event and triggers clean relaunch.
 */
const { execFile, spawn } = require('child_process');
const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');

const HOME = process.env.HOME || '/home/deck';
const EXTRA_PATHS = [
  path.join(HOME, '.bun', 'bin'),
  path.join(HOME, '.nvm', 'versions', 'node', 'current', 'bin'),
  path.join(HOME, '.local', 'bin'),
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
].join(':');

const BUILD_ENV = {
  ...process.env,
  PATH: process.env.PATH ? `${EXTRA_PATHS}:${process.env.PATH}` : EXTRA_PATHS,
  CI: 'true',
};

/**
 * Validates and returns a real, existing directory on disk.
 * If given a file path (or an .asar archive path), returns its parent directory.
 */
function getValidDir(candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  try {
    let p = candidate;
    if (p.endsWith('.asar')) {
      p = path.dirname(p);
    }
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) return p;
      if (stat.isFile()) return path.dirname(p);
    }
  } catch {}
  return null;
}

/**
 * Safe execFile wrapper with timeout and guaranteed directory cwd.
 * Never throws synchronously or rejects with spawn ENOTDIR.
 */
function execP(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let cleanCwd = opts.cwd ? getValidDir(opts.cwd) : null;
    if (!cleanCwd) {
      cleanCwd = getValidDir(process.cwd()) || HOME;
    }
    const cleanOpts = { timeout: 30000, env: BUILD_ENV, ...opts, cwd: cleanCwd };
    try {
      execFile(cmd, args, cleanOpts, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || '').trim(),
          stderr: String(stderr || '').trim(),
          code: err ? (err.code || 1) : 0,
        });
      });
    } catch (err) {
      resolve({
        ok: false,
        stdout: '',
        stderr: err.message || String(err),
        code: -1,
      });
    }
  });
}

function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'DeckRomM-Updater/1.3.0',
      Accept: 'application/vnd.github.v3+json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = https.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, token).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) {
        return resolve({ notFound: true, status: 404 });
      }
      if (res.statusCode === 403) {
        return resolve({ rateLimited: true, status: 403 });
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`GitHub returned HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub request timed out'));
    });
  });
}

class AppUpdater {
  /**
   * @param {{ emit: (channel: string, payload: any) => void, log: Function, configStore: any }} deps
   */
  constructor({ emit, log, configStore }) {
    this.emit = emit;
    this.log = log || console.log;
    this.configStore = configStore;
    this.isUpdating = false;
  }

  /**
   * Parse owner/repo from a git remote URL or string.
   */
  parseRepo(urlOrSlug) {
    if (!urlOrSlug) return null;
    const clean = String(urlOrSlug).trim().replace(/\.git$/i, '');
    const githubMatch = clean.match(/github\.com[:/]([^/]+)\/([^/]+)/i);
    if (githubMatch) return `${githubMatch[1]}/${githubMatch[2]}`;
    const simpleMatch = clean.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (simpleMatch) return clean;
    return null;
  }

  /**
   * Search for a valid local git worktree on the Steam Deck.
   */
  findGitDirectory() {
    const candidates = [
      app && !app.isPackaged ? app.getAppPath() : null,
      process.cwd(),
      path.join(HOME, 'deckromm'),
      path.join(HOME, 'DeckRomM'),
      path.join(HOME, 'Applications/DeckRomM/source'),
      path.join(HOME, 'Applications/DeckRomM/src'),
      path.join(HOME, 'Desktop/deckromm'),
    ].filter(Boolean);

    for (const dir of candidates) {
      const validDir = getValidDir(dir);
      if (!validDir) continue;
      try {
        const gitDir = path.join(validDir, '.git');
        if (fs.existsSync(gitDir)) {
          return validDir;
        }
      } catch {}
    }
    return null;
  }

  /**
   * Auto-detect the GitHub repo and current git commit hash safely.
   * If running packaged as an AppImage with no git clone, returns build info.
   */
  async detectGitInfo() {
    const gitDir = this.findGitDirectory();
    if (gitDir) {
      const [insideRes, commitRes, remoteRes, branchRes] = await Promise.all([
        execP('git', ['rev-parse', '--is-inside-work-tree'], { cwd: gitDir }),
        execP('git', ['rev-parse', 'HEAD'], { cwd: gitDir }),
        execP('git', ['config', '--get', 'remote.origin.url'], { cwd: gitDir }),
        execP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gitDir }),
      ]);

      if (insideRes.ok && commitRes.ok) {
        const repo = remoteRes.ok ? this.parseRepo(remoteRes.stdout) : null;
        const branch = branchRes.ok && branchRes.stdout !== 'HEAD' ? branchRes.stdout : 'main';
        return {
          isGit: true,
          gitDir,
          commit: commitRes.stdout,
          repo: repo || '',
          branch,
        };
      }
    }

    // Check .build-info.json in known locations
    const buildInfoCandidates = [
      path.join(HOME, 'Applications/DeckRomM/.build-info.json'),
      path.join(HOME, '.config/DeckRomM/.build-info.json'),
      path.join(app ? app.getAppPath() : '', '.build-info.json'),
      path.join(app ? app.getAppPath() : '', 'dist/.build-info.json'),
    ];

    for (const infoPath of buildInfoCandidates) {
      try {
        if (fs.existsSync(infoPath)) {
          const raw = fs.readFileSync(infoPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.commit || parsed.repo)) {
            return {
              isGit: false,
              gitDir: null,
              commit: parsed.commit || '',
              repo: parsed.repo || '',
              branch: parsed.branch || 'main',
            };
          }
        }
      } catch {}
    }

    const version = app ? app.getVersion() : '1.3.0';
    return {
      isGit: false,
      gitDir: null,
      commit: version ? `v${version}` : '',
      repo: '',
      branch: 'main',
    };
  }

  /**
   * Persist build/version info to disk so subsequent launches know the current commit.
   */
  recordBuildInfo({ commit, repo }) {
    try {
      const data = JSON.stringify({ commit, repo, updatedAt: new Date().toISOString() }, null, 2);
      const paths = [
        path.join(HOME, 'Applications/DeckRomM/.build-info.json'),
        path.join(HOME, '.config/DeckRomM/.build-info.json'),
      ];
      for (const p of paths) {
        try {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, data);
        } catch {}
      }
    } catch {}
  }

  /**
   * Check GitHub for newer commits or releases.
   */
  async checkForUpdates() {
    try {
      const gitInfo = await this.detectGitInfo();
      const config = this.configStore ? this.configStore.get() : {};
      const targetRepo = config.githubRepo ? this.parseRepo(config.githubRepo) : gitInfo.repo;
      const targetBranch = config.githubBranch || gitInfo.branch || 'main';

      if (!targetRepo) {
        return {
          hasUpdate: false,
          error: 'Please configure your GitHub Repository (e.g. yourname/deckromm) in Settings > App Updates.',
          currentCommit: gitInfo.commit.slice(0, 7),
          branch: targetBranch,
        };
      }

      this.log(`[updater] Checking GitHub for ${targetRepo} on branch ${targetBranch}...`);

      let data = await fetchJson(`https://api.github.com/repos/${targetRepo}/commits/${targetBranch}`, config.githubToken);

      // If branch not found (e.g. 'main' vs 'master'), try fallback
      if (data && data.notFound && targetBranch === 'main') {
        this.log(`[updater] Branch 'main' not found, trying 'master'...`);
        data = await fetchJson(`https://api.github.com/repos/${targetRepo}/commits/master`, config.githubToken);
      }

      if (data && data.rateLimited) {
        return {
          hasUpdate: false,
          error: 'GitHub API rate limit reached. Please wait a few minutes or add a GitHub Personal Token in Settings.',
          currentCommit: gitInfo.commit.slice(0, 7),
          repo: targetRepo,
          branch: targetBranch,
        };
      }

      if (!data || !data.sha) {
        return {
          hasUpdate: false,
          error: data?.notFound ? `Repository ${targetRepo} or branch ${targetBranch} not found on GitHub. Check repository name.` : 'Unable to parse GitHub response',
          currentCommit: gitInfo.commit.slice(0, 7),
          repo: targetRepo,
          branch: targetBranch,
        };
      }

      const latestSha = data.sha;
      const currentSha = gitInfo.commit || '';
      const commitMsg = data.commit?.message || 'New commit on GitHub';
      const author = data.commit?.author?.name || data.author?.login || 'GitHub';
      const date = data.commit?.author?.date || '';

      const isDifferent = Boolean(
        !currentSha ||
        (latestSha && !latestSha.startsWith(currentSha) && !currentSha.startsWith(latestSha))
      );

      const isAppImage = Boolean(process.env.APPIMAGE || (app && app.isPackaged));

      return {
        hasUpdate: isDifferent,
        currentCommit: currentSha.slice(0, 7),
        latestCommit: latestSha.slice(0, 7),
        fullSha: latestSha,
        message: commitMsg.split('\n')[0],
        fullMessage: commitMsg,
        author,
        date,
        repo: targetRepo,
        branch: targetBranch,
        isGit: gitInfo.isGit,
        isAppImage,
        releaseUrl: data.html_url,
      };
    } catch (e) {
      this.log(`[updater] Check failed: ${e.message}`);
      return {
        hasUpdate: false,
        error: `Update check failed: ${e.message}`,
        currentCommit: '',
      };
    }
  }

  /**
   * Run command with live output streaming to updater progress.
   * Ensures cwd is always a valid directory.
   */
  runSpawn(cmd, args, cwd, stage, basePercent, maxPercent) {
    return new Promise((resolve, reject) => {
      const safeCwd = getValidDir(cwd) || HOME;
      this.log(`[updater] ${cmd} ${args.join(' ')} (cwd: ${safeCwd})`);
      
      let proc;
      try {
        proc = spawn(cmd, args, { cwd: safeCwd, env: BUILD_ENV });
      } catch (err) {
        return reject(err);
      }

      let output = '';

      proc.stdout.on('data', (d) => {
        const line = d.toString();
        output += line;
        this.emit('app:update-progress', {
          stage,
          percent: basePercent,
          message: `${stage}: ${line.trim().slice(0, 80)}`,
          log: line,
        });
      });

      proc.stderr.on('data', (d) => {
        const line = d.toString();
        output += line;
        this.emit('app:update-progress', {
          stage,
          percent: basePercent,
          message: `${stage}: ${line.trim().slice(0, 80)}`,
          log: line,
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`${cmd} exited with code ${code}: ${output.slice(-200)}`));
        }
      });
      proc.on('error', reject);
    });
  }

  /**
   * Perform an in-place upgrade.
   */
  async performUpdate(options = {}) {
    if (this.isUpdating) {
      return { ok: false, message: 'An update is already in progress' };
    }
    this.isUpdating = true;

    try {
      const gitInfo = await this.detectGitInfo();
      const config = this.configStore ? this.configStore.get() : {};
      const targetRepo = options.repo || config.githubRepo || gitInfo.repo;
      const targetBranch = options.branch || config.githubBranch || gitInfo.branch || 'main';

      if (!targetRepo) {
        return { ok: false, message: 'No target GitHub repository specified' };
      }

      this.emit('app:update-progress', {
        stage: 'starting',
        percent: 5,
        message: 'Preparing in-place update...',
      });

      // -------------------------------------------------------------
      // PATH 1: Git-based in-place upgrade
      // -------------------------------------------------------------
      if (gitInfo.isGit && gitInfo.gitDir) {
        const gitDir = gitInfo.gitDir;
        this.emit('app:update-progress', {
          stage: 'pulling',
          percent: 20,
          message: `Fetching latest code from ${targetBranch}...`,
        });

        await this.runSpawn('git', ['fetch', 'origin', targetBranch], gitDir, 'fetching', 25, 40);
        await this.runSpawn('git', ['reset', '--hard', `origin/${targetBranch}`], gitDir, 'resetting', 45, 55);

        this.emit('app:update-progress', {
          stage: 'installing_deps',
          percent: 60,
          message: 'Installing dependencies...',
        });

        const hasBun = (await execP('which', ['bun'])).ok || fs.existsSync(path.join(HOME, '.bun', 'bin', 'bun'));
        const bunCmd = hasBun ? (fs.existsSync(path.join(HOME, '.bun', 'bin', 'bun')) ? path.join(HOME, '.bun', 'bin', 'bun') : 'bun') : 'npm';
        if (hasBun) {
          await this.runSpawn(bunCmd, ['install'], gitDir, 'installing', 65, 75);
        } else {
          await this.runSpawn('npm', ['install', '--no-audit', '--no-fund'], gitDir, 'installing', 65, 75);
        }

        this.emit('app:update-progress', {
          stage: 'building',
          percent: 80,
          message: 'Building application bundle...',
        });

        if (hasBun) {
          await this.runSpawn(bunCmd, ['run', 'build'], gitDir, 'building', 80, 90);
        } else {
          await this.runSpawn('npm', ['run', 'build'], gitDir, 'building', 80, 90);
        }

        // Package new AppImage and install if scripts exist
        const buildScript = path.join(gitDir, 'build-appimage.sh');
        if (fs.existsSync(buildScript)) {
          await fsp.chmod(buildScript, 0o755).catch(() => {});
          this.emit('app:update-progress', {
            stage: 'packaging',
            percent: 92,
            message: 'Packaging AppImage for SteamOS...',
          });
          await this.runSpawn('bash', [buildScript], gitDir, 'packaging', 92, 98);
          const installScript = path.join(gitDir, 'installer.sh');
          if (fs.existsSync(installScript)) {
            await fsp.chmod(installScript, 0o755).catch(() => {});
            await this.runSpawn('bash', [installScript], gitDir, 'installing', 98, 99);
          }
        }

        const newCommit = (await execP('git', ['rev-parse', 'HEAD'], { cwd: gitDir })).stdout;
        this.recordBuildInfo({ commit: newCommit, repo: targetRepo });

        this.emit('app:update-progress', {
          stage: 'complete',
          percent: 100,
          message: 'Upgrade completed successfully! Ready to restart.',
        });

        return {
          ok: true,
          commit: newCommit.slice(0, 7),
          message: 'Application upgraded successfully in place. Restart to apply changes.',
        };
      }

      // -------------------------------------------------------------
      // PATH 2: AppImage in-place upgrade via GitHub Release
      // -------------------------------------------------------------
      const appImagePath = process.env.APPIMAGE || path.join(HOME, 'Applications/DeckRomM/DeckRomM.AppImage');

      this.emit('app:update-progress', {
        stage: 'checking_releases',
        percent: 20,
        message: 'Checking for release AppImage...',
      });

      const release = await fetchJson(`https://api.github.com/repos/${targetRepo}/releases/latest`, config.githubToken);
      const asset = release?.assets?.find((a) => a.name.endsWith('.AppImage'));

      if (asset && asset.browser_download_url) {
        this.emit('app:update-progress', {
          stage: 'downloading',
          percent: 40,
          message: `Downloading new AppImage (${(asset.size / 1e6).toFixed(1)} MB)...`,
        });

        const tmpDest = `${appImagePath}.new-${Date.now()}`;
        await this.downloadFile(asset.browser_download_url, tmpDest);
        await fsp.chmod(tmpDest, 0o755);
        await fsp.rename(tmpDest, appImagePath);

        this.recordBuildInfo({ commit: release.tag_name || asset.name, repo: targetRepo });

        this.emit('app:update-progress', {
          stage: 'complete',
          percent: 100,
          message: 'AppImage upgraded successfully! Ready to restart.',
        });

        return { ok: true, message: 'AppImage upgraded successfully. Relaunch to start the new version.' };
      }

      // -------------------------------------------------------------
      // PATH 3: Source clone & build on Steam Deck
      // -------------------------------------------------------------
      const buildDir = path.join(HOME, 'deckromm');
      fs.mkdirSync(buildDir, { recursive: true });

      const hasGit = (await execP('which', ['git'])).ok;
      if (hasGit) {
        this.emit('app:update-progress', {
          stage: 'fetching_source',
          percent: 25,
          message: `Updating repository source from GitHub (${targetBranch})...`,
        });

        const gitDir = path.join(buildDir, '.git');
        if (fs.existsSync(gitDir)) {
          await this.runSpawn('git', ['fetch', 'origin', targetBranch], buildDir, 'fetching', 25, 40);
          await this.runSpawn('git', ['reset', '--hard', `origin/${targetBranch}`], buildDir, 'resetting', 40, 50);
        } else {
          // Initialize git in existing directory to avoid "destination path '.' already exists and is not an empty directory"
          await execP('git', ['init'], { cwd: buildDir });
          await execP('git', ['remote', 'add', 'origin', `https://github.com/${targetRepo}.git`], { cwd: buildDir }).catch(() => {
            return execP('git', ['remote', 'set-url', 'origin', `https://github.com/${targetRepo}.git`], { cwd: buildDir });
          });
          await this.runSpawn('git', ['fetch', '--depth', '1', 'origin', targetBranch], buildDir, 'fetching', 25, 40);
          await this.runSpawn('git', ['reset', '--hard', 'FETCH_HEAD'], buildDir, 'resetting', 40, 50);
        }
      } else {
        // Tarball fallback
        this.emit('app:update-progress', {
          stage: 'downloading',
          percent: 25,
          message: `Downloading repository archive from GitHub (${targetBranch})...`,
        });
        const tmpTar = path.join(HOME, `.deckromm-update-${Date.now()}.tar.gz`);
        await this.downloadFile(`https://api.github.com/repos/${targetRepo}/tarball/${targetBranch}`, tmpTar, config.githubToken);
        await this.runSpawn('tar', ['-xzf', tmpTar, '--strip-components=1', '-C', buildDir], buildDir, 'extracting', 40, 50);
        await fsp.unlink(tmpTar).catch(() => {});
      }

      this.emit('app:update-progress', {
        stage: 'building',
        percent: 60,
        message: 'Building updated AppImage...',
      });

      const buildScript = path.join(buildDir, 'build-appimage.sh');
      if (fs.existsSync(buildScript)) {
        await fsp.chmod(buildScript, 0o755).catch(() => {});
        await this.runSpawn('bash', [buildScript], buildDir, 'building', 60, 90);
        const installScript = path.join(buildDir, 'installer.sh');
        if (fs.existsSync(installScript)) {
          await fsp.chmod(installScript, 0o755).catch(() => {});
          await this.runSpawn('bash', [installScript], buildDir, 'installing', 90, 98);
        }
      } else {
        const hasBun = (await execP('which', ['bun'])).ok || fs.existsSync(path.join(HOME, '.bun', 'bin', 'bun'));
        const bunCmd = hasBun ? (fs.existsSync(path.join(HOME, '.bun', 'bin', 'bun')) ? path.join(HOME, '.bun', 'bin', 'bun') : 'bun') : 'npm';
        if (hasBun) {
          await this.runSpawn(bunCmd, ['install'], buildDir, 'installing', 60, 75);
          await this.runSpawn(bunCmd, ['run', 'build'], buildDir, 'building', 75, 95);
        } else {
          await this.runSpawn('npm', ['install', '--no-audit', '--no-fund'], buildDir, 'installing', 60, 75);
          await this.runSpawn('npm', ['run', 'build'], buildDir, 'building', 75, 95);
        }
      }

      const latestCommit = (await execP('git', ['rev-parse', 'HEAD'], { cwd: buildDir })).stdout || 'latest';
      this.recordBuildInfo({ commit: latestCommit, repo: targetRepo });

      this.emit('app:update-progress', {
        stage: 'complete',
        percent: 100,
        message: 'Upgrade completed successfully! Ready to restart.',
      });

      return {
        ok: true,
        commit: latestCommit.slice(0, 7),
        message: 'DeckRomM upgraded in place successfully. Restart to run the latest version.',
      };
    } catch (e) {
      this.log(`[updater] Upgrade failed: ${e.message}`);
      this.emit('app:update-progress', {
        stage: 'error',
        percent: 0,
        message: `Upgrade error: ${e.message}`,
      });
      return { ok: false, message: e.message || String(e) };
    } finally {
      this.isUpdating = false;
    }
  }

  downloadFile(url, dest, token) {
    return new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'DeckRomM-Updater/1.3.0' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const get = (targetUrl) => {
        https.get(targetUrl, { headers }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return get(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', reject);
        }).on('error', reject);
      };
      get(url);
    });
  }

  /**
   * Relaunch the application cleanly.
   */
  relaunch() {
    this.log('[updater] Relaunching application...');
    if (app) {
      const launcherPath = path.join(HOME, 'Applications/DeckRomM/launch_deckromm.sh');
      if (fs.existsSync(launcherPath)) {
        app.relaunch({ execPath: launcherPath });
      } else {
        app.relaunch();
      }
      app.exit(0);
    }
  }
}

module.exports = { AppUpdater };
