import React from 'react';
import { CheckCircle2, AlertTriangle, Download, X } from 'lucide-react';
import { FocusScope } from './FocusScope';
import { DownloadItem } from '../types';
import { formatBytes } from './GameCard';

interface DownloadsPanelProps {
  items: DownloadItem[];
  onCancel: (item: DownloadItem) => void;
  onClearFinished: () => void;
  onClose: () => void;
}

export const DownloadsPanel: React.FC<DownloadsPanelProps> = ({ items, onCancel, onClearFinished, onClose }) => (
  <div className="fixed inset-0 z-[115] flex justify-end bg-black/60 deck-enter" onClick={onClose}>
    <FocusScope
      name="downloads"
      onBack={onClose}
      onAction={(a) => {
        if (a === 'ACTION_X') {
          onClearFinished();
          return true;
        }
        return false;
      }}
      className="w-[520px] h-full bg-[#0e131d] border-l border-deck-line flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-deck-line">
        <h2 className="text-xl font-extrabold flex items-center gap-2"><Download size={20} /> Downloads</h2>
        <div className="flex gap-2">
          <button data-focusable onClick={onClearFinished} className="h-10 px-3 rounded-lg bg-deck-panel-2 border border-deck-line text-sm font-semibold">Clear finished (X)</button>
          <button data-focusable onClick={onClose} className="h-10 w-10 rounded-lg bg-deck-panel-2 border border-deck-line flex items-center justify-center" aria-label="Close"><X size={18} /></button>
        </div>
      </div>
      <div data-scroll-primary className="deck-scroll flex-1 min-h-0 p-4 flex flex-col gap-2">
        {items.length === 0 && <div className="text-deck-dim text-center mt-16">No downloads yet. Open a game and press Download or Play.</div>}
        {items.map((d) => (
          <div key={d.id} data-focusable tabIndex={-1} className="deck-row rounded-xl bg-deck-panel/80 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold truncate">{d.title}</div>
                <div className="text-xs text-deck-dim">
                  {d.platform}  -  {formatBytes(d.bytesDownloaded)} / {formatBytes(d.fileSizeBytes)}
                  {d.status === 'downloading' && d.speedMbps > 0 ? `  -  ${d.speedMbps.toFixed(1)} MB/s` : ''}
                </div>
              </div>
              {d.status === 'downloading' || d.status === 'queued' ? (
                <button data-focusable onClick={() => onCancel(d)} className="h-9 px-3 rounded-lg bg-deck-panel-2 border border-deck-line text-sm font-semibold shrink-0">Cancel</button>
              ) : d.status === 'completed' ? (
                <CheckCircle2 className="text-deck-ok shrink-0" />
              ) : (
                <AlertTriangle className="text-deck-warn shrink-0" />
              )}
            </div>
            <div className="h-1.5 rounded-full bg-deck-panel-2 overflow-hidden">
              <div className={`h-full ${d.status === 'error' ? 'bg-deck-danger' : 'bg-deck-accent'}`} style={{ width: `${d.progress}%` }} />
            </div>
            {d.errorMessage && <div className="text-xs text-red-300">{d.errorMessage}</div>}
          </div>
        ))}
      </div>
    </FocusScope>
  </div>
);
