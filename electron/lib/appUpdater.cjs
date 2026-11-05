'use strict';
/**
 * In-place App Updater for DeckRomM (Steam Deck / SteamOS Game Mode).
 *
 * Checks GitHub for newer commits/releases and performs reliable in-place upgrades:
 *  - Running as AppImage (standard Steam Deck Game Mode install):
 *      1. Checks GitHub Releases for a pre-built DeckRomM-*.AppImage.
 *      2. Downloads asset with streaming progress directly to a .new file.
 *      3. Follows redirects without sending GitHub tokens to AWS S3 (fixes HTTP 400).
 *      4. Atomically renames .new over the running AppImage (bypassing ETXTBSY / Text file busy).
 *      5. Fallback: if no release asset exists, falls back to source update and build.
 *  - Running from source or git worktree:
 *      `git fetch`, `git reset --hard`, `npm install`, `npm run build`.
 *  - Relaunch: cleanly respawns the launcher script or AppImage process group.
 */
const { execFile, spawn } = require('child_process');
const fsp = require('fs').promises;
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { app } = require('electron');

const HOME = process.env.HOME || '/home/deck';

function getExtraPaths() {
  const list = [
    path.join(HOME, '.bun', 'bin'),
    path.join(HOME, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(HOME, '.local', 'bin'),
    path.join(HOME, '.cargo', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  try {
    const nvmNodeDir = path.join(HOME, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmNodeDir)) {
      const versions = fs.readdirSync(nvmNodeDir);
      for (const v of versions) {
        list.push(path.join(nvmNodeDir, v, 'bin'));
      }
    }
  } catch {}
  return list.filter(Boolean).join(':');
}

const EXTRA_PATHS = getExtraPaths();

const BUILD_ENV = {
  ...process.env,
  PATH: process.env.PATH ? `${EXTRA_PATHS}:${process.env.PATH}` : EXTRA_PATHS,
  CI: 'true',
};

const APP_VERSION = '1.3.0';

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
    const parsed = new URL(url);
    const headers = {
      'User-Agent': `DeckRomM-Updater/${APP_VERSION}`,
      Accept: 'application/vnd.github.v3+json',
    };
    if (token && parsed.hostname.endsWith('github.com')) {
      headers.Authorization = `Bearer ${token}`;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        return fetchJson(nextUrl, token).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) {
        res.resume();
        return resolve({ notFound: true, status: 404 });
      }
      if (res.statusCode === 403) {
        res.resume();
        return resolve({ rateLimited: true, status: 403 });
      }
      if (res.statusCode !== 200) {
        res.resume();
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
    const isAppImage = Boolean(process.env.APPIMAGE || (app && app.isPackaged));

    // If running in development / source mode, check git worktree directly
    if (!isAppImage) {
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
            isAppImage: false,
            gitDir,
            commit: commitRes.stdout,
            repo: repo || 'silayo10/deckromm',
            branch,
          };
        }
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
              isAppImage,
              gitDir: null,
              commit: parsed.commit || (parsed.version ? `v${parsed.version}` : `v${APP_VERSION}`),
              repo: parsed.repo || 'silayo10/deckromm',
              branch: parsed.branch || 'main',
            };
          }
        }
      } catch {}
    }

    const version = app ? app.getVersion() : APP_VERSION;
    return {
      isGit: false,
      isAppImage,
      gitDir: null,
      commit: version ? `v${version}` : `v${APP_VERSION}`,
      repo: 'silayo10/deckromm',
      branch: 'main',
    };
  }

  /**
   * Persist build/version info to disk so subsequent launches know the current commit.
   */
  recordBuildInfo({ commit, repo }) {
    try {
      const data = JSON.stringify({ commit, repo, version: APP_VERSION, updatedAt: new Date().toISOString() }, null, 2);
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
      const targetRepo = config.githubRepo ? this.parseRepo(config.githubRepo) : (gitInfo.repo || 'silayo10/deckromm');
      const targetBranch = config.githubBranch || gitInfo.branch || 'main';

      if (!targetRepo) {
        return {
          hasUpdate: false,
          error: 'Please configure your GitHub Repository (e.g. silayo10/deckromm) in Settings > App Updates.',
          currentCommit: gitInfo.commit.slice(0, 7),
          branch: targetBranch,
        };
      }

      this.log(`[updater] Checking GitHub for ${targetRepo} on branch ${targetBranch}...`);

      // 1. Check releases if running as an AppImage
      let releaseAsset = null;
      let releaseTag = '';
      try {
        const release = await fetchJson(`https://api.github.com/repos/${targetRepo}/releases/latest`, config.githubToken);
        if (release && !release.notFound && !release.rateLimited && release.assets) {
          const appImageAsset = release.assets.find((a) => a.name.endsWith('.AppImage'));
          if (appImageAsset) {
            releaseAsset = appImageAsset;
            releaseTag = release.tag_name || '';
          }
        }
      } catch (err) {
        this.log(`[updater] Latest release check note: ${err.message}`);
      }

      // Fallback: check releases list (e.g. rolling 'latest' release or pre-releases)
      if (!releaseAsset) {
        try {
          const releases = await fetchJson(`https://api.github.com/repos/${targetRepo}/releases`, config.githubToken);
          if (Array.isArray(releases) && !releases.rateLimited) {
            for (const r of releases) {
              const appImageAsset = r.assets?.find((a) => a.name.endsWith('.AppImage'));
              if (appImageAsset) {
                releaseAsset = appImageAsset;
                releaseTag = r.tag_name || '';
                break;
              }
            }
          }
        } catch (err) {
          this.log(`[updater] Releases list note: ${err.message}`);
        }
      }

      // 2. Check latest commit on target branch
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
        // If commits API failed but release exists
        if (releaseTag) {
          const isDifferentTag = gitInfo.commit !== releaseTag && `v${APP_VERSION}` !== releaseTag;
          return {
            hasUpdate: isDifferentTag,
            currentCommit: gitInfo.commit.slice(0, 7),
            latestCommit: releaseTag,
            fullSha: releaseTag,
            message: `Release ${releaseTag}`,
            fullMessage: `GitHub Release ${releaseTag}`,
            author: 'DeckRomM',
            date: '',
            repo: targetRepo,
            branch: targetBranch,
            isGit: gitInfo.isGit,
            isAppImage: gitInfo.isAppImage,
            hasReleaseAsset: Boolean(releaseAsset),
          };
        }

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

      const isReleaseDifferent = Boolean(
        releaseTag &&
        releaseTag !== `v${APP_VERSION}` &&
        releaseTag !== currentSha
      );

      const isCommitDifferent = Boolean(
        latestSha &&
        (!currentSha || (
          !latestSha.startsWith(currentSha) &&
          !currentSha.startsWith(latestSha)
        ))
      );

      const isDifferent = isReleaseDifferent || isCommitDifferent;

      return {
        hasUpdate: isDifferent,
        currentCommit: currentSha.slice(0, 7),
        latestCommit: latestSha.slice(0, 7),
        fullSha: latestSha,
        releaseTag: releaseTag || null,
        hasReleaseAsset: Boolean(releaseAsset),
        message: commitMsg.split('\n')[0],
        fullMessage: commitMsg,
        author,
        date,
        repo: targetRepo,
        branch: targetBranch,
        isGit: gitInfo.isGit,
        isAppImage: gitInfo.isAppImage,
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
   * Download file following redirects safely without leaking Authorization header to S3.
   */
  downloadFile(url, dest, token) {
    return new Promise((resolve, reject) => {
      const get = (targetUrl) => {
        let parsedUrl;
        try {
          parsedUrl = new URL(targetUrl);
        } catch (e) {
          return reject(e);
        }

        const isGithubDomain = parsedUrl.hostname.endsWith('github.com');
        const headers = {
          'User-Agent': `DeckRomM-Updater/${APP_VERSION}`,
        };
        // ONLY send Authorization header if directly communicating with github.com.
        // AWS S3 and objects.githubusercontent.com will REJECT requests with HTTP 400
        // if both signed URL queries and Authorization headers are present.
        if (token && isGithubDomain) {
          headers.Authorization = `Bearer ${token}`;
        }

        const client = parsedUrl.protocol === 'http:' ? http : https;
        const req = client.get(targetUrl, { headers, timeout: 60000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Must resume/drain stream to avoid socket hang
            res.resume();
            const nextUrl = new URL(res.headers.location, targetUrl).toString();
            return get(nextUrl);
          }

          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed: HTTP ${res.statusCode} ${res.statusMessage || ''}`));
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let downloadedBytes = 0;
          let lastReport = 0;

          const file = fs.createWriteStream(dest);
          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (totalBytes > 0 && now - lastReport > 300) {
              lastReport = now;
              const pct = Math.min(95, Math.round(25 + (downloadedBytes / totalBytes) * 65));
              const mb = (downloadedBytes / 1048576).toFixed(1);
              const totalMb = (totalBytes / 1048576).toFixed(1);
              this.emit('app:update-progress', {
                stage: 'downloading',
                percent: pct,
                message: `Downloading update (${mb} / ${totalMb} MB)...`,
              });
            }
          });

          res.pipe(file);
          file.on('finish', () => {
            file.close(resolve);
          });
          file.on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
          });
        });

        req.on('timeout', () => {
          req.destroy();
          fs.unlink(dest, () => {});
          reject(new Error('Download timed out'));
        });

        req.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      };

      get(url);
    });
  }

  /**
   * Perform an in-place upgrade on SteamOS.
   */
  async performUpdate(options = {}) {
    if (this.isUpdating) {
      return { ok: false, message: 'An update is already in progress' };
    }
    this.isUpdating = true;

    try {
      const gitInfo = await this.detectGitInfo();
      const config = this.configStore ? this.configStore.get() : {};
      const targetRepo = options.repo || config.githubRepo || gitInfo.repo || 'silayo10/deckromm';
      const targetBranch = options.branch || config.githubBranch || gitInfo.branch || 'main';

      if (!targetRepo) {
        return { ok: false, message: 'No target GitHub repository specified' };
      }

      this.emit('app:update-progress', {
        stage: 'starting',
        percent: 5,
        message: 'Preparing in-place update...',
      });

      const isAppImage = Boolean(process.env.APPIMAGE || (app && app.isPackaged));
      const appImagePath = process.env.APPIMAGE || path.join(HOME, 'Applications/DeckRomM/DeckRomM.AppImage');

      // =========================================================================
      // STRATEGY A (PRIMARY FOR STEAM DECK): Download Release AppImage from GitHub
      // =========================================================================
      if (isAppImage) {
        this.emit('app:update-progress', {
          stage: 'checking_releases',
          percent: 15,
          message: `Checking GitHub Releases for ${targetRepo}...`,
        });

        let release = null;
        try {
          release = await fetchJson(`https://api.github.com/repos/${targetRepo}/releases/latest`, config.githubToken);
        } catch (e) {
          this.log(`[updater] Could not query releases: ${e.message}`);
        }

        let asset = release?.assets?.find((a) => a.name.endsWith('.AppImage'));
        if (!asset) {
          try {
            const releases = await fetchJson(`https://api.github.com/repos/${targetRepo}/releases`, config.githubToken);
            if (Array.isArray(releases) && !releases.rateLimited) {
              for (const r of releases) {
                const found = r.assets?.find((a) => a.name.endsWith('.AppImage'));
                if (found) {
                  asset = found;
                  release = r;
                  break;
                }
              }
            }
          } catch (e) {
            this.log(`[updater] Releases list query note: ${e.message}`);
          }
        }

        if (asset && asset.browser_download_url) {
          const sizeMb = asset.size ? (asset.size / 1048576).toFixed(1) : 'download';
          this.emit('app:update-progress', {
            stage: 'downloading',
            percent: 25,
            message: `Downloading new AppImage (${sizeMb} MB)...`,
          });

          // Ensure parent directory exists
          await fsp.mkdir(path.dirname(appImagePath), { recursive: true });

          // Write to a temporary file first, then atomically rename
          // This avoids 'Text file busy' (ETXTBSY) when replacing the running AppImage on Linux
          const tmpDest = `${appImagePath}.new-${Date.now()}`;
          await this.downloadFile(asset.browser_download_url, tmpDest, config.githubToken);
          await fsp.chmod(tmpDest, 0o755);
          await fsp.rename(tmpDest, appImagePath);

          // Synchronize canonical and versioned aliases in ~/Applications/DeckRomM
          // in case Steam shortcut points directly to DeckRomM-1.3.0-x86_64.AppImage or DeckRomM.AppImage
          const appsDir = path.join(HOME, 'Applications/DeckRomM');
          const canonical = path.join(appsDir, 'DeckRomM.AppImage');
          const versioned13 = path.join(appsDir, 'DeckRomM-1.3.0-x86_64.AppImage');

          for (const target of [canonical, versioned13]) {
            if (target !== appImagePath) {
              try {
                await fsp.mkdir(path.dirname(target), { recursive: true });
                const copyTmp = `${target}.new-${Date.now()}`;
                await fsp.copyFile(appImagePath, copyTmp);
                await fsp.chmod(copyTmp, 0o755);
                await fsp.rename(copyTmp, target);
              } catch {}
            }
          }

          this.recordBuildInfo({ commit: release.tag_name || asset.name, repo: targetRepo });

          this.emit('app:update-progress', {
            stage: 'complete',
            percent: 100,
            message: 'AppImage upgraded successfully! Ready to restart.',
          });

          return {
            ok: true,
            commit: (release.tag_name || asset.name).slice(0, 10),
            message: `DeckRomM upgraded to ${release.tag_name || 'latest'} successfully. Restart to run the new version.`,
          };
        }
      }

      // =========================================================================
      // STRATEGY B: Git-based in-place pull and rebuild (for dev or local repo)
      // =========================================================================
      const gitDir = this.findGitDirectory();
      if (gitDir && (!isAppImage || !gitInfo.hasReleaseAsset)) {
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

        // If packaging is needed (when running AppImage)
        const buildScript = path.join(gitDir, 'build-appimage.sh');
        if (isAppImage && fs.existsSync(buildScript)) {
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
          message: 'DeckRomM upgraded in place successfully. Restart to apply changes.',
        };
      }

      // =========================================================================
      // STRATEGY C: Source archive fallback
      // =========================================================================
      const buildDir = path.join(HOME, 'deckromm');
      fs.mkdirSync(buildDir, { recursive: true });

      this.emit('app:update-progress', {
        stage: 'downloading',
        percent: 25,
        message: `Downloading repository archive from GitHub (${targetBranch})...`,
      });

      const tmpTar = path.join(HOME, `.deckromm-update-${Date.now()}.tar.gz`);
      await this.downloadFile(`https://api.github.com/repos/${targetRepo}/tarball/${targetBranch}`, tmpTar, config.githubToken);
      await this.runSpawn('tar', ['-xzf', tmpTar, '--strip-components=1', '-C', buildDir], buildDir, 'extracting', 40, 50);
      await fsp.unlink(tmpTar).catch(() => {});

      this.emit('app:update-progress', {
        stage: 'building',
        percent: 60,
        message: 'Building application...',
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
        await this.runSpawn(bunCmd, ['install'], buildDir, 'installing', 60, 75);
        await this.runSpawn(bunCmd, ['run', 'build'], buildDir, 'building', 75, 95);
      }

      this.recordBuildInfo({ commit: 'latest', repo: targetRepo });

      this.emit('app:update-progress', {
        stage: 'complete',
        percent: 100,
        message: 'Upgrade completed successfully! Ready to restart.',
      });

      return {
        ok: true,
        commit: 'latest',
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

  /**
   * Relaunch the application cleanly in SteamOS Game Mode or Desktop Mode.
   */
  relaunch() {
    this.log('[updater] Relaunching application on SteamOS...');
    if (app) {
      const launcherPath = path.join(HOME, 'Applications/DeckRomM/launch_deckromm.sh');
      const appImagePath = process.env.APPIMAGE || path.join(HOME, 'Applications/DeckRomM/DeckRomM.AppImage');

      // 1. If running under Steam with the official launcher script
      if (fs.existsSync(launcherPath)) {
        try {
          spawn('bash', [launcherPath], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          }).unref();
          app.exit(0);
          return;
        } catch {}
      }

      // 2. If running directly as an AppImage binary
      if (process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE)) {
        try {
          spawn(process.env.APPIMAGE, process.argv.slice(1), {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          }).unref();
          app.exit(0);
          return;
        } catch {}
      }

      // 3. Fallback standard Electron relaunch
      app.relaunch();
      app.exit(0);
    }
  }
}

module.exports = { AppUpdater };
