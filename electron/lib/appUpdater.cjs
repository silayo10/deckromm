'use strict';
/**
 * In-place App Updater for DeckRomM.
 *
 * Checks GitHub for newer commits/versions and performs in-place upgrades:
 *  - If running in a git clone: `git fetch`, `git reset --hard`, `npm install`, `npm run build`.
 *  - If running as an AppImage: fetches latest release asset, writes .new and atomically swaps.
 *  - If running as standalone files: pulls GitHub tarball, updates in-place, and builds.
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

function execP(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30000, ...opts }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        code: err ? err.code : 0,
      });
    });
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
    this.appDir = app ? app.getAppPath() : process.cwd();
  }

  /**
   * Parse owner/repo from a git remote URL or string.
   */
  parseRepo(urlOrSlug) {
    if (!urlOrSlug) return null;
    const clean = String(urlOrSlug).trim().replace(/\.git$/i, '');
    const githubMatch = clean.match(/github\.com[:/]([^/]+)\/([^/]+)/i);
    if (githubMatch) return `${githubMatch[1]}/${githubMatch[2]}`;
    const simpleMatch = clean.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (simpleMatch) return clean;
    return null;
  }

  /**
   * Auto-detect the GitHub repo and current git commit hash.
   */
  async detectGitInfo() {
    const isGit = await execP('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.appDir });
    if (!isGit.ok) {
      // Check .build-info.json if present
      try {
        const infoPath = path.join(this.appDir, '.build-info.json');
        const raw = await fsp.readFile(infoPath, 'utf8');
        const parsed = JSON.parse(raw);
        return { isGit: false, commit: parsed.commit || '', repo: parsed.repo || '' };
      } catch {
        return { isGit: false, commit: '', repo: '' };
      }
    }

    const [commitRes, remoteRes, branchRes] = await Promise.all([
      execP('git', ['rev-parse', 'HEAD'], { cwd: this.appDir }),
      execP('git', ['config', '--get', 'remote.origin.url'], { cwd: this.appDir }),
      execP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.appDir }),
    ]);

    const currentCommit = commitRes.ok ? commitRes.stdout : '';
    const repo = remoteRes.ok ? this.parseRepo(remoteRes.stdout) : null;
    const branch = branchRes.ok && branchRes.stdout !== 'HEAD' ? branchRes.stdout : 'main';

    return {
      isGit: true,
      commit: currentCommit,
      repo: repo || '',
      branch,
    };
  }

  /**
   * Check GitHub for newer commits or releases.
   */
  async checkForUpdates() {
    try {
      const gitInfo = await this.detectGitInfo();
      const config = this.configStore ? this.configStore.get() : {};
      const targetRepo = config.githubRepo ? this.parseRepo(config.githubRepo) : gitInfo.repo || 'deckromm/deckromm';
      const targetBranch = config.githubBranch || gitInfo.branch || 'main';

      if (!targetRepo) {
        return {
          hasUpdate: false,
          error: 'No GitHub repository specified. Set repository in Settings > App Updates.',
          currentCommit: gitInfo.commit.slice(0, 7),
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
          error: 'GitHub API rate limit reached. Please wait or set a GitHub Personal Token in Settings.',
          currentCommit: gitInfo.commit.slice(0, 7),
          repo: targetRepo,
          branch: targetBranch,
        };
      }

      if (!data || !data.sha) {
        return {
          hasUpdate: false,
          error: data?.notFound ? `Repository ${targetRepo} or branch ${targetBranch} not found on GitHub` : 'Unable to parse GitHub response',
          currentCommit: gitInfo.commit.slice(0, 7),
          repo: targetRepo,
          branch: targetBranch,
        };
      }

      const latestSha = data.sha;
      const currentSha = gitInfo.commit || '';
      const commitMsg = data.commit?.message || 'New commit on GitHub';
      const author = data.commit?.author?.name || data.author?.login || 'DeckRomM';
      const date = data.commit?.author?.date || '';

      const isDifferent = Boolean(currentSha && latestSha && !latestSha.startsWith(currentSha) && !currentSha.startsWith(latestSha));

      // Also check release assets if AppImage is running
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
   */
  runSpawn(cmd, args, cwd, stage, basePercent, maxPercent) {
    return new Promise((resolve, reject) => {
      this.log(`[updater] ${cmd} ${args.join(' ')} (cwd: ${cwd})`);
      const proc = spawn(cmd, args, { cwd, env: { ...process.env, CI: 'true' } });
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

      this.emit('app:update-progress', {
        stage: 'starting',
        percent: 5,
        message: 'Preparing in-place update...',
      });

      // -------------------------------------------------------------
      // PATH 1: Git-based in-place upgrade (standard Steam Deck clone)
      // -------------------------------------------------------------
      if (gitInfo.isGit) {
        this.emit('app:update-progress', {
          stage: 'pulling',
          percent: 20,
          message: `Fetching latest code from ${targetBranch}...`,
        });

        // 1. Fetch latest
        await this.runSpawn('git', ['fetch', 'origin', targetBranch], this.appDir, 'fetching', 25, 40);

        // 2. Reset hard to origin/branch to ensure clean update
        this.emit('app:update-progress', {
          stage: 'updating_files',
          percent: 45,
          message: 'Applying latest file changes...',
        });
        await this.runSpawn('git', ['reset', '--hard', `origin/${targetBranch}`], this.appDir, 'resetting', 45, 55);

        // 3. Package manager dependencies install
        this.emit('app:update-progress', {
          stage: 'installing_deps',
          percent: 60,
          message: 'Installing dependencies...',
        });

        const hasBun = (await execP('which', ['bun'])).ok;
        if (hasBun) {
          await this.runSpawn('bun', ['install'], this.appDir, 'installing', 65, 75);
        } else {
          await this.runSpawn('npm', ['install', '--no-audit', '--no-fund'], this.appDir, 'installing', 65, 75);
        }

        // 4. Build Vite & TypeScript bundle in-place
        this.emit('app:update-progress', {
          stage: 'building',
          percent: 80,
          message: 'Building application bundle...',
        });

        if (hasBun) {
          await this.runSpawn('bun', ['run', 'build'], this.appDir, 'building', 85, 95);
        } else {
          await this.runSpawn('npm', ['run', 'build'], this.appDir, 'building', 85, 95);
        }

        // Save build info
        const newCommit = (await execP('git', ['rev-parse', 'HEAD'], { cwd: this.appDir })).stdout;
        await fsp.writeFile(
          path.join(this.appDir, '.build-info.json'),
          JSON.stringify({ commit: newCommit, repo: targetRepo, updatedAt: new Date().toISOString() }, null, 2)
        ).catch(() => {});

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
      // PATH 2: AppImage in-place upgrade (Steam Deck ~/Applications)
      // -------------------------------------------------------------
      const appImagePath = process.env.APPIMAGE || path.join(HOME, 'Applications/DeckRomM/DeckRomM.AppImage');
      if (fs.existsSync(appImagePath)) {
        this.emit('app:update-progress', {
          stage: 'downloading',
          percent: 30,
          message: 'Checking for release AppImage...',
        });

        const release = await fetchJson(`https://api.github.com/repos/${targetRepo}/releases/latest`, config.githubToken);
        const asset = release?.assets?.find((a) => a.name.endsWith('.AppImage'));

        if (asset && asset.browser_download_url) {
          this.emit('app:update-progress', {
            stage: 'downloading',
            percent: 50,
            message: `Downloading new AppImage (${(asset.size / 1e6).toFixed(1)} MB)...`,
          });

          const tmpDest = `${appImagePath}.new-${Date.now()}`;
          await this.downloadFile(asset.browser_download_url, tmpDest);
          await fsp.chmod(tmpDest, 0o755);
          await fsp.rename(tmpDest, appImagePath);

          this.emit('app:update-progress', {
            stage: 'complete',
            percent: 100,
            message: 'AppImage upgraded successfully! Ready to restart.',
          });

          return { ok: true, message: 'AppImage upgraded successfully. Relaunch to start the new version.' };
        }
      }

      // -------------------------------------------------------------
      // PATH 3: Tarball download & in-place overwrite
      // -------------------------------------------------------------
      this.emit('app:update-progress', {
        stage: 'downloading',
        percent: 25,
        message: `Downloading repository archive from GitHub (${targetBranch})...`,
      });

      const archiveUrl = `https://api.github.com/repos/${targetRepo}/tarball/${targetBranch}`;
      const tmpTar = path.join(this.appDir, `.update-${Date.now()}.tar.gz`);

      await this.downloadFile(archiveUrl, tmpTar, config.githubToken);

      this.emit('app:update-progress', {
        stage: 'extracting',
        percent: 55,
        message: 'Extracting update files in place...',
      });

      await this.runSpawn('tar', ['-xzf', tmpTar, '--strip-components=1', '-C', this.appDir], this.appDir, 'extracting', 55, 65);
      await fsp.unlink(tmpTar).catch(() => {});

      // Build in-place
      this.emit('app:update-progress', {
        stage: 'building',
        percent: 75,
        message: 'Building updated app bundle...',
      });

      const hasBun = (await execP('which', ['bun'])).ok;
      if (hasBun) {
        await this.runSpawn('bun', ['install'], this.appDir, 'installing', 75, 85);
        await this.runSpawn('bun', ['run', 'build'], this.appDir, 'building', 85, 95);
      } else {
        await this.runSpawn('npm', ['install', '--no-audit', '--no-fund'], this.appDir, 'installing', 75, 85);
        await this.runSpawn('npm', ['run', 'build'], this.appDir, 'building', 85, 95);
      }

      this.emit('app:update-progress', {
        stage: 'complete',
        percent: 100,
        message: 'Upgrade completed successfully! Ready to restart.',
      });

      return {
        ok: true,
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
      app.relaunch();
      app.exit(0);
    }
  }
}

module.exports = { AppUpdater };
