import React, { useState, useEffect } from 'react';
import {
  X,
  GitBranch,
  GitCommit,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  RotateCcw,
  Terminal,
  Settings,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { FocusScope } from './FocusScope';
import { bridge, isNativeApp } from '../services/bridge';
import { AppUpdateInfo, AppUpdateProgressEvent, RommConfig } from '../types';

interface UpdateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: RommConfig;
  onChangeConfig: (patch: Partial<RommConfig>) => void;
  onToast: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
  initialUpdateInfo?: AppUpdateInfo | null;
}

export const UpdateManagerModal: React.FC<UpdateManagerModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  onToast,
  initialUpdateInfo,
}) => {
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(initialUpdateInfo || null);
  const [checking, setChecking] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeProgress, setUpgradeProgress] = useState<AppUpdateProgressEvent | null>(null);
  const [upgradeLogs, setUpgradeLogs] = useState<string[]>([]);
  const [upgradeFinished, setUpgradeFinished] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [repoInput, setRepoInput] = useState(config.githubRepo || '');
  const [branchInput, setBranchInput] = useState(config.githubBranch || 'main');

  const checkUpdates = async () => {
    setChecking(true);
    setUpgradeProgress(null);
    setUpgradeFinished(false);
    try {
      const res = await bridge.updater.check();
      setUpdateInfo(res);
      if (res.hasUpdate) {
        onToast(`New update available: ${res.latestCommit}`, 'info');
      } else if (res.error) {
        onToast(res.error, 'error');
      } else {
        onToast('DeckRomM is up to date!', 'ok');
      }
    } catch (e: any) {
      onToast(`Update check failed: ${e.message}`, 'error');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialUpdateInfo) {
        setUpdateInfo(initialUpdateInfo);
      } else {
        checkUpdates();
      }
    }
  }, [isOpen, initialUpdateInfo]);

  useEffect(() => {
    const unsub = bridge.on('app:update-progress', (ev: AppUpdateProgressEvent) => {
      setUpgradeProgress(ev);
      if (ev.log) {
        setUpgradeLogs((prev) => [...prev.slice(-30), ev.log!]);
      }
      if (ev.stage === 'complete' || ev.percent >= 100) {
        setUpgradeFinished(true);
      }
    });
    return unsub;
  }, []);

  if (!isOpen) return null;

  const handlePerformUpgrade = async () => {
    setUpgrading(true);
    setUpgradeFinished(false);
    setUpgradeLogs(['Starting in-place upgrade from GitHub...']);
    try {
      const res = await bridge.updater.perform({
        repo: config.githubRepo || updateInfo?.repo,
        branch: config.githubBranch || updateInfo?.branch || 'main',
      });
      if (res.ok) {
        setUpgradeFinished(true);
        onToast('Upgrade completed! Ready to restart DeckRomM.', 'ok');
      } else {
        onToast(res.message || 'Upgrade failed', 'error');
      }
    } catch (e: any) {
      onToast(`Upgrade error: ${e.message}`, 'error');
    } finally {
      setUpgrading(false);
    }
  };

  const handleRelaunch = async () => {
    onToast('Restarting DeckRomM...', 'info');
    try {
      await bridge.updater.relaunch();
    } catch {
      onClose();
    }
  };

  const handleSaveRepoSettings = () => {
    onChangeConfig({
      githubRepo: repoInput.trim() || undefined,
      githubBranch: branchInput.trim() || undefined,
    });
    setShowConfig(false);
    onToast('Updated GitHub repository settings', 'ok');
    setTimeout(checkUpdates, 200);
  };

  return (
    <div className="fixed inset-0 z-[230] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <FocusScope
        name="update-manager"
        initialFocus={updateInfo?.hasUpdate ? '#upgrade-now' : '#check-updates'}
        onAction={(a) => {
          if (a === 'BACK') {
            if (!upgrading) onClose();
            return true;
          }
          return false;
        }}
      >
        <div className="w-full max-w-2xl bg-deck-panel border border-deck-line rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-deck-line flex items-center justify-between bg-deck-bg/40">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <ArrowUpCircle size={24} />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  In-Place App Upgrade
                </h2>
                <p className="text-xs text-deck-dim">
                  Check GitHub for new commits and upgrade DeckRomM directly on your Steam Deck
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="update-repo-settings"
                data-focusable
                disabled={upgrading}
                onClick={() => setShowConfig(!showConfig)}
                className={`p-2 rounded-lg border text-xs font-semibold transition-colors ${showConfig ? 'bg-deck-accent text-white border-deck-accent' : 'bg-deck-subtle border-deck-line text-deck-dim hover:text-white'}`}
                title="Configure Repository"
              >
                <Settings size={16} />
              </button>
              <button
                id="update-modal-close"
                data-focusable
                disabled={upgrading}
                onClick={onClose}
                className="p-2 rounded-lg bg-deck-subtle hover:bg-deck-subtle-hover border border-deck-line text-deck-dim hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Repo configuration drawer */}
            {showConfig && (
              <div className="p-4 rounded-xl bg-deck-panel-2 border border-deck-line space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-deck-accent block">
                  GitHub Repository Configuration
                </span>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-deck-dim mb-1 font-semibold">Repository (owner/repo):</label>
                    <input
                      data-focusable
                      type="text"
                      value={repoInput}
                      onChange={(e) => setRepoInput(e.target.value)}
                      placeholder="e.g. yourname/deckromm"
                      className="w-full px-3 py-2 rounded-lg bg-deck-bg border border-deck-line text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-deck-dim mb-1 font-semibold">Branch:</label>
                    <input
                      data-focusable
                      type="text"
                      value={branchInput}
                      onChange={(e) => setBranchInput(e.target.value)}
                      placeholder="main"
                      className="w-full px-3 py-2 rounded-lg bg-deck-bg border border-deck-line text-white font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    data-focusable
                    onClick={handleSaveRepoSettings}
                    className="px-4 py-1.5 rounded-lg bg-deck-accent hover:bg-deck-accent-hover text-white text-xs font-bold"
                  >
                    Save & Test
                  </button>
                </div>
              </div>
            )}

            {/* Current Status Box */}
            <div className="p-4 rounded-xl bg-deck-panel-2 border border-deck-line flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs text-deck-dim flex items-center gap-2">
                  <GitBranch size={14} className="text-deck-accent" />
                  <span>Repository: <strong className="text-white font-mono">{updateInfo?.repo || config.githubRepo || 'Auto-detected'}</strong> ({updateInfo?.branch || config.githubBranch || 'main'})</span>
                </div>
                <div className="text-xs text-deck-dim flex items-center gap-2">
                  <GitCommit size={14} className="text-purple-400" />
                  <span>Current Local Commit: <strong className="text-white font-mono">{updateInfo?.currentCommit || 'HEAD'}</strong></span>
                </div>
              </div>

              <button
                id="check-updates"
                data-focusable
                disabled={checking || upgrading}
                onClick={checkUpdates}
                className="px-4 py-2 rounded-xl bg-deck-subtle hover:bg-deck-subtle-hover border border-deck-line text-xs font-bold text-white flex items-center gap-2 transition-colors flex-shrink-0"
              >
                <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
                <span>{checking ? 'Checking GitHub...' : 'Check Again'}</span>
              </button>
            </div>

            {/* Update Info / Upgrade Action */}
            {updateInfo?.hasUpdate ? (
              <div className="p-5 rounded-xl bg-gradient-to-br from-emerald-950/40 via-deck-panel-2 to-deck-panel border border-emerald-500/40 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-sm">
                    <Sparkles size={18} />
                    <span>Newer Version Found on GitHub!</span>
                  </div>
                  <span className="font-mono text-xs px-2.5 py-1 rounded bg-emerald-950 border border-emerald-500/30 text-emerald-300 font-bold">
                    {updateInfo.currentCommit} → {updateInfo.latestCommit}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-black/40 border border-white/5 space-y-1.5 text-xs">
                  <div className="font-semibold text-white break-words">
                    {updateInfo.message}
                  </div>
                  <div className="text-deck-dim text-[11px] flex items-center gap-3">
                    <span>By: <strong className="text-deck-text">{updateInfo.author}</strong></span>
                    {updateInfo.date && (
                      <span>Date: {new Date(updateInfo.date).toLocaleDateString()} {new Date(updateInfo.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-deck-dim leading-relaxed">
                  This upgrade will pull the latest commits directly into this install and rebuild the application in place. No data or saved configurations will be lost.
                </div>

                {!upgrading && !upgradeFinished && (
                  <button
                    id="upgrade-now"
                    data-focusable
                    onClick={handlePerformUpgrade}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95"
                  >
                    <Download size={18} />
                    <span>Perform Upgrade in Place</span>
                  </button>
                )}
              </div>
            ) : updateInfo && !updateInfo.error && !checking ? (
              <div className="p-4 rounded-xl bg-deck-panel-2 border border-deck-line text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-emerald-400 font-bold text-sm">
                  <CheckCircle2 size={18} />
                  <span>You're on the latest version!</span>
                </div>
                <p className="text-xs text-deck-dim">
                  Your local installation matches the latest commit on <code className="text-deck-text font-mono">{updateInfo.repo}</code> ({updateInfo.branch}).
                </p>
              </div>
            ) : updateInfo?.error ? (
              <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle size={16} />
                  <span>Update Check Notice</span>
                </div>
                <p className="leading-relaxed">{updateInfo.error}</p>
                <div className="pt-1">
                  <button
                    data-focusable
                    onClick={() => setShowConfig(true)}
                    className="text-deck-accent underline hover:text-white"
                  >
                    Configure GitHub repository settings
                  </button>
                </div>
              </div>
            ) : null}

            {/* Progress & Console while upgrading */}
            {(upgrading || upgradeProgress) && (
              <div className="p-4 rounded-xl bg-deck-panel-2 border border-deck-line space-y-3">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-white flex items-center gap-2">
                    {upgrading && <RefreshCw size={14} className="animate-spin text-deck-accent" />}
                    <span>{upgradeProgress?.message || 'Upgrading in place...'}</span>
                  </span>
                  <span className="text-deck-accent font-mono">{upgradeProgress?.percent || 0}%</span>
                </div>

                <div className="w-full bg-deck-subtle h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-deck-accent h-full transition-all duration-300"
                    style={{ width: `${upgradeProgress?.percent || 0}%` }}
                  />
                </div>

                {upgradeLogs.length > 0 && (
                  <div className="mt-2 p-3 rounded-lg bg-black/60 border border-white/5 font-mono text-[11px] text-green-400 max-h-32 overflow-y-auto space-y-0.5">
                    {upgradeLogs.map((l, idx) => (
                      <div key={idx} className="whitespace-pre-wrap">{l}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Completion & Relaunch */}
            {upgradeFinished && (
              <div className="p-5 rounded-xl bg-emerald-950/50 border border-emerald-500/50 text-center space-y-4">
                <div className="flex items-center justify-center gap-2 text-emerald-300 font-extrabold text-base">
                  <CheckCircle2 size={22} />
                  <span>DeckRomM Upgraded Successfully!</span>
                </div>
                <p className="text-xs text-deck-dim max-w-md mx-auto">
                  All latest files have been pulled and rebuilt. Relaunch the application to run the new version.
                </p>
                <button
                  id="relaunch-app"
                  data-focusable
                  onClick={handleRelaunch}
                  className="px-6 py-3 rounded-xl bg-deck-accent hover:bg-deck-accent-hover text-white font-extrabold text-sm inline-flex items-center gap-2 shadow-lg transition-transform active:scale-95"
                >
                  <RotateCcw size={18} />
                  <span>Restart DeckRomM Now</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-deck-line bg-deck-bg/40 flex items-center justify-between text-xs text-deck-dim">
            <span>D-pad navigate • A select • B back</span>
            <span className="font-mono text-[11px]">Steam Deck Game Mode</span>
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
