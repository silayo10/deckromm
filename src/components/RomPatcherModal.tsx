import React, { useState, useMemo } from 'react';
import { ArrowLeft, Wand2, Download, Upload, Link, Check, AlertCircle, Loader2, Sparkles, FileCode, CheckCircle2, Search, X, Filter } from 'lucide-react';
import { Game } from '../types';
import { FocusScope } from './FocusScope';
import { FEATURED_COMMUNITY_PATCHES, PatchOption, applyRomPatch, calculateCrc32, searchCommunityPatches } from '../services/romPatcher';
import { rommApi } from '../services/rommApi';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';

interface RomPatcherModalProps {
  game: Game;
  onClose: () => void;
  onSuccess?: (patchedFileName: string) => void;
}

const CATEGORIES = ['All', 'Translation', 'Colorization', 'Widescreen', 'QoL', 'Hack'];
const SUGGESTIONS = ['Mario', 'Zelda', 'Pokemon', 'Metroid', 'Final Fantasy', 'Castlevania'];

export const RomPatcherModal: React.FC<RomPatcherModalProps> = ({ game, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState<'presets' | 'url' | 'file'>('presets');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showAllSystems, setShowAllSystems] = useState(false);

  const [customUrl, setCustomUrl] = useState('');
  const [uploadedPatch, setUploadedPatch] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  
  const [patching, setPatching] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [completedFileName, setCompletedFileName] = useState<string | null>(null);

  // Compute filtered preset patches based on search, category, and game platform
  const displayedPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = FEATURED_COMMUNITY_PATCHES;

    // Filter by category
    if (selectedCategory !== 'All') {
      list = list.filter((p) => p.category.toLowerCase() === selectedCategory.toLowerCase());
    }

    // Filter by query if typed
    if (q) {
      return list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.platformSlug.toLowerCase().includes(q) ||
          (p.author && p.author.toLowerCase().includes(q)) ||
          p.gameTitleKeywords.some((kw) => kw.toLowerCase().includes(q))
      );
    }

    // If no query typed, show platform matches first unless "showAllSystems" is true
    if (!showAllSystems) {
      const platformMatches = list.filter(
        (p) =>
          p.platformSlug === game.platformSlug ||
          p.gameTitleKeywords.some((kw) => game.title.toLowerCase().includes(kw))
      );
      if (platformMatches.length > 0) return platformMatches;
    }

    return list;
  }, [searchQuery, selectedCategory, showAllSystems, game]);

  const handleApplyPreset = async (preset: PatchOption) => {
    soundService.playTick();
    setPatching(true);
    setStatusMsg(`Downloading patch: ${preset.title}...`);
    setErrorMsg('');

    try {
      // 1. Fetch the patch file bytes
      const patchRes = await fetch(preset.patchUrl);
      if (!patchRes.ok) throw new Error(`Failed to download patch from URL (HTTP ${patchRes.status})`);
      const patchBuffer = await patchRes.arrayBuffer();
      const patchBytes = new Uint8Array(patchBuffer);

      // 2. Fetch base ROM bytes
      setStatusMsg('Downloading base ROM file...');
      const romBlob = await rommApi.downloadRom(game);
      const romBuffer = await romBlob.arrayBuffer();
      const sourceBytes = new Uint8Array(romBuffer);

      // 3. Apply patch
      setStatusMsg('Applying binary ROM patch...');
      const patchedBytes = applyRomPatch(sourceBytes, patchBytes);

      // 4. Save patched ROM
      const ext = game.fileName.split('.').pop() || 'bin';
      const cleanTitle = game.title.replace(/[/\\?%*:|"<>]/g, '');
      const patchLabel = preset.title.split('-')[1]?.trim() || preset.category;
      const newFileName = `${cleanTitle} [${patchLabel}].${ext}`;

      setStatusMsg(`Saving patched ROM: ${newFileName}...`);
      if (isNativeApp) {
        // Save directly to Deck's Emulation/roms/ folder
        await bridge.roms.download({
          romId: `patched-${game.id}-${Date.now()}`,
          platformSlug: game.platformSlug,
          fileName: newFileName,
          force: true,
        });
      }

      soundService.playSuccess();
      setCompletedFileName(newFileName);
      setStatusMsg(`Successfully created patched ROM!`);
      onSuccess?.(newFileName);
    } catch (err: any) {
      soundService.playBack();
      setErrorMsg(err?.message || 'Failed to apply patch.');
    } finally {
      setPatching(false);
    }
  };

  const handleApplyUrl = async () => {
    if (!customUrl.trim()) return;
    soundService.playTick();
    setPatching(true);
    setStatusMsg('Fetching patch from URL...');
    setErrorMsg('');

    try {
      const patchRes = await fetch(customUrl);
      if (!patchRes.ok) throw new Error(`Failed to download patch file from URL (HTTP ${patchRes.status})`);
      const patchBuffer = await patchRes.arrayBuffer();
      const patchBytes = new Uint8Array(patchBuffer);

      setStatusMsg('Fetching base ROM...');
      const romBlob = await rommApi.downloadRom(game);
      const romBuffer = await romBlob.arrayBuffer();
      const sourceBytes = new Uint8Array(romBuffer);

      setStatusMsg('Applying ROM patch...');
      const patchedBytes = applyRomPatch(sourceBytes, patchBytes);

      const ext = game.fileName.split('.').pop() || 'bin';
      const cleanTitle = game.title.replace(/[/\\?%*:|"<>]/g, '');
      const newFileName = `${cleanTitle} [Patched].${ext}`;

      soundService.playSuccess();
      setCompletedFileName(newFileName);
      setStatusMsg('Successfully created patched ROM!');
      onSuccess?.(newFileName);
    } catch (err: any) {
      soundService.playBack();
      setErrorMsg(err?.message || 'Failed to download or apply patch.');
    } finally {
      setPatching(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setUploadedPatch({
          name: file.name,
          bytes: new Uint8Array(event.target.result as ArrayBuffer),
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleApplyUploaded = async () => {
    if (!uploadedPatch) return;
    soundService.playTick();
    setPatching(true);
    setStatusMsg('Fetching base ROM...');
    setErrorMsg('');

    try {
      const romBlob = await rommApi.downloadRom(game);
      const romBuffer = await romBlob.arrayBuffer();
      const sourceBytes = new Uint8Array(romBuffer);

      setStatusMsg('Applying local ROM patch...');
      const patchedBytes = applyRomPatch(sourceBytes, uploadedPatch.bytes);

      const ext = game.fileName.split('.').pop() || 'bin';
      const cleanTitle = game.title.replace(/[/\\?%*:|"<>]/g, '');
      const newFileName = `${cleanTitle} [${uploadedPatch.name.replace(/\.[^/.]+$/, '')}].${ext}`;

      soundService.playSuccess();
      setCompletedFileName(newFileName);
      setStatusMsg('Successfully created patched ROM!');
      onSuccess?.(newFileName);
    } catch (err: any) {
      soundService.playBack();
      setErrorMsg(err?.message || 'Failed to apply patch file.');
    } finally {
      setPatching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-6 deck-enter">
      <FocusScope
        name="rom-patcher"
        onBack={onClose}
        className="w-full max-w-2xl bg-deck-bg border border-deck-line rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
      >
        {/* Header */}
        <div className="h-16 px-6 border-b border-deck-line flex items-center justify-between shrink-0 bg-deck-panel/50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-deck-accent/20 border border-deck-accent/40 flex items-center justify-center text-deck-accent">
              <Wand2 size={20} />
            </div>
            <div>
              <h2 className="font-extrabold text-base text-white flex items-center gap-2">
                ROM Hack & Translation Patcher
              </h2>
              <p className="text-xs text-deck-dim truncate max-w-md">Target: {game.title} ({game.platformName})</p>
            </div>
          </div>
          <button
            data-focusable
            onClick={onClose}
            className="h-9 w-9 rounded-lg bg-deck-panel-2 border border-deck-line flex items-center justify-center text-deck-dim hover:text-white"
          >
            <ArrowLeft size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 pt-4 shrink-0 border-b border-deck-line pb-3 bg-deck-bg">
          <button
            data-focusable
            onClick={() => setActiveTab('presets')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'presets'
                ? 'bg-deck-accent text-white shadow-md'
                : 'bg-deck-panel-2 text-deck-dim hover:text-white'
            }`}
          >
            <Sparkles size={14} /> Community Presets ({displayedPresets.length})
          </button>
          <button
            data-focusable
            onClick={() => setActiveTab('url')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'url'
                ? 'bg-deck-accent text-white shadow-md'
                : 'bg-deck-panel-2 text-deck-dim hover:text-white'
            }`}
          >
            <Link size={14} /> From Patch URL
          </button>
          <button
            data-focusable
            onClick={() => setActiveTab('file')}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'file'
                ? 'bg-deck-accent text-white shadow-md'
                : 'bg-deck-panel-2 text-deck-dim hover:text-white'
            }`}
          >
            <Upload size={14} /> Upload .IPS / .BPS
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto deck-scroll flex-1 flex flex-col gap-4">
          {completedFileName ? (
            <div className="p-6 rounded-xl bg-emerald-950/30 border border-emerald-500/40 flex flex-col items-center text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <CheckCircle2 size={28} />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-white">ROM Patch Applied Successfully!</h3>
                <p className="text-xs text-emerald-200/80 font-mono mt-1">{completedFileName}</p>
                <p className="text-xs text-deck-dim mt-2">
                  The patched ROM has been processed and saved. You can launch it now or find it in your local Deck library.
                </p>
              </div>
              <button
                data-focusable
                onClick={onClose}
                className="mt-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Presets View */}
              {activeTab === 'presets' && (
                <div className="flex flex-col gap-4">
                  {/* Search Bar & Controls */}
                  <div className="flex flex-col gap-2.5 bg-deck-panel/40 p-3.5 rounded-xl border border-deck-line">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-deck-dim" />
                        <input
                          data-focusable
                          data-keyboard-title="Search Community Patches"
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search patches (e.g. Mario, Zelda, Translation, 60fps...)"
                          className="w-full h-10 pl-10 pr-9 rounded-lg bg-[#0a0e15] border border-deck-line text-xs font-semibold text-white placeholder:text-deck-dim/60 focus:border-deck-accent focus:outline-none"
                        />
                        {searchQuery && (
                          <button
                            data-focusable
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-deck-dim hover:text-white"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      <button
                        data-focusable
                        onClick={() => setShowAllSystems((prev) => !prev)}
                        className={`h-10 px-3 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 shrink-0 ${
                          showAllSystems
                            ? 'bg-deck-accent/20 text-deck-accent border-deck-accent/40'
                            : 'bg-deck-panel-2 text-deck-dim border-deck-line hover:text-white'
                        }`}
                        title="Toggle between game-matched presets and all system presets"
                      >
                        <Filter size={14} />
                        {showAllSystems ? 'All Systems' : 'Auto Matched'}
                      </button>
                    </div>

                    {/* Category Filter Chips */}
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                      <span className="text-[11px] font-bold text-deck-dim mr-1 shrink-0">Category:</span>
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat}
                          data-focusable
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-3 py-1 rounded-md text-[11px] font-bold border transition-all shrink-0 ${
                            selectedCategory === cat
                              ? 'bg-deck-accent text-white border-deck-accent shadow-sm'
                              : 'bg-deck-panel-2 border-deck-line text-deck-dim hover:text-deck-text'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    {/* Quick Suggestion Chips */}
                    {!searchQuery && (
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
                        <span className="text-[11px] font-bold text-deck-dim mr-1 shrink-0">Try searching:</span>
                        {SUGGESTIONS.map((sug) => (
                          <button
                            key={sug}
                            data-focusable
                            onClick={() => {
                              setSearchQuery(sug);
                              setShowAllSystems(true);
                            }}
                            className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-deck-bg/60 border border-deck-line/80 text-deck-dim hover:text-white hover:border-deck-accent/50 transition-colors"
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Preset Items List */}
                  <div className="flex flex-col gap-3">
                    {displayedPresets.length === 0 ? (
                      <div className="p-8 rounded-xl bg-deck-panel/50 border border-deck-line text-center flex flex-col items-center gap-2 text-deck-dim">
                        <Search size={24} className="text-deck-dim/60" />
                        <p className="text-sm font-semibold text-white">No patches matched your search</p>
                        <p className="text-xs text-deck-dim max-w-sm">
                          Try adjusting your search query, selecting &quot;All Systems&quot;, or pasting a direct patch URL.
                        </p>
                      </div>
                    ) : (
                      displayedPresets.map((preset) => (
                        <div
                          key={preset.id}
                          className="p-4 rounded-xl bg-deck-panel/70 border border-deck-line flex items-center justify-between gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-sm text-white">{preset.title}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-deck-accent/20 text-deck-accent border border-deck-accent/30">
                                {preset.category}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-deck-panel-2 text-deck-dim border border-deck-line">
                                {preset.patchType}
                              </span>
                            </div>
                            <p className="text-xs text-deck-dim mt-1">{preset.description}</p>
                            {preset.author && <p className="text-[11px] text-deck-dim/70 mt-0.5">Author: {preset.author}</p>}
                          </div>

                          <button
                            data-focusable
                            disabled={patching}
                            onClick={() => handleApplyPreset(preset)}
                            className="px-4 py-2 rounded-xl text-xs font-bold bg-deck-accent hover:bg-deck-accent/80 text-white flex items-center gap-2 border border-deck-accent/40 shadow-md transition-all shrink-0 disabled:opacity-50"
                          >
                            {patching ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                            <span>Apply Patch</span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* URL View */}
              {activeTab === 'url' && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-deck-dim uppercase tracking-wider">Patch File Direct URL (.ips or .bps)</label>
                    <input
                      data-focusable
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder="https://example.com/patches/game_translation.ips"
                      className="h-12 rounded-xl bg-[#0a0e15] border-2 border-deck-line px-4 font-mono text-xs text-white placeholder:text-deck-dim/50"
                    />
                  </div>
                  <button
                    data-focusable
                    disabled={patching || !customUrl.trim()}
                    onClick={handleApplyUrl}
                    className="h-12 rounded-xl bg-deck-accent hover:bg-deck-accent/80 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                  >
                    {patching ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                    <span>Download & Apply Patch</span>
                  </button>
                </div>
              )}

              {/* Upload View */}
              {activeTab === 'file' && (
                <div className="flex flex-col gap-4">
                  <div className="border-2 border-dashed border-deck-line rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-center bg-deck-panel/30">
                    <FileCode size={32} className="text-deck-accent" />
                    <div>
                      <p className="text-sm font-bold text-white">Select an .IPS or .BPS Patch File</p>
                      <p className="text-xs text-deck-dim mt-0.5">Upload a patch from your Steam Deck or computer</p>
                    </div>
                    <input
                      type="file"
                      accept=".ips,.bps,.ups"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="patch-file-input"
                    />
                    <label
                      htmlFor="patch-file-input"
                      data-focusable
                      className="px-4 py-2 rounded-xl bg-deck-panel-2 border border-deck-line text-xs font-bold text-white cursor-pointer hover:bg-deck-panel transition-colors"
                    >
                      Browse File
                    </label>
                    {uploadedPatch && (
                      <span className="text-xs font-mono text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-500/30 px-3 py-1 rounded-lg">
                        Selected: {uploadedPatch.name}
                      </span>
                    )}
                  </div>

                  <button
                    data-focusable
                    disabled={patching || !uploadedPatch}
                    onClick={handleApplyUploaded}
                    className="h-12 rounded-xl bg-deck-accent hover:bg-deck-accent/80 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                  >
                    {patching ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                    <span>Apply Uploaded Patch</span>
                  </button>
                </div>
              )}

              {/* Status and Error Messages */}
              {statusMsg && (
                <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/30 text-xs font-semibold text-blue-300 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  <span>{statusMsg}</span>
                </div>
              )}
              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-xs font-semibold text-red-300 flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </>
          )}
        </div>
      </FocusScope>
    </div>
  );
};
