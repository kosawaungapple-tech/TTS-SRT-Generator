import React, { useState, useRef, useMemo } from 'react';
import { 
  X, 
  Upload, 
  FileText, 
  ListPlus, 
  Trash2, 
  Play, 
  AlertCircle, 
  FileSpreadsheet, 
  FileCode, 
  Sparkles,
  Layers,
  ChevronDown
} from 'lucide-react';
import { TTSConfig } from '../types';
import { VOICE_OPTIONS } from '../constants';

interface BatchQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onQueueItems: (items: string[], config: TTSConfig) => void;
  currentConfig: TTSConfig;
  isProcessing?: boolean;
}

type DelimiterType = 'newline' | 'paragraph' | 'sentence' | 'custom';

export const BatchQueueModal: React.FC<BatchQueueModalProps> = ({
  isOpen,
  onClose,
  onQueueItems,
  currentConfig,
  isProcessing = false
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [fileInputName, setFileInputName] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [delimiter, setDelimiter] = useState<DelimiterType>('newline');
  const [customDelimiter, setCustomDelimiter] = useState('---');
  const [parsedItems, setParsedItems] = useState<string[]>([]);
  const [config, setConfig] = useState<TTSConfig>({ ...currentConfig });
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync config when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setConfig({ ...currentConfig });
      setError(null);
    }
  }, [isOpen, currentConfig]);

  // Parse raw text based on selected delimiter
  const parseRawText = (raw: string, delim: DelimiterType, customDelim: string): string[] => {
    if (!raw.trim()) return [];

    let segments: string[] = [];
    if (delim === 'paragraph') {
      segments = raw.split(/\n\s*\n+/);
    } else if (delim === 'sentence') {
      // Split on Myanmar sentence ender '။' or English period/question/exclamation
      segments = raw.split(/([။.!?]+\s*)/);
      // Re-stitch sentence punctuation to segments
      const recombined: string[] = [];
      for (let i = 0; i < segments.length; i += 2) {
        const sentence = (segments[i] || '') + (segments[i + 1] || '');
        if (sentence.trim()) recombined.push(sentence);
      }
      segments = recombined;
    } else if (delim === 'custom') {
      segments = raw.split(customDelim);
    } else {
      // Default: line by line
      segments = raw.split(/\r?\n/);
    }

    return segments
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const handleTextChange = (text: string) => {
    setPasteText(text);
    const items = parseRawText(text, delimiter, customDelimiter);
    setParsedItems(items);
    if (items.length > 0) setError(null);
  };

  const handleDelimiterChange = (newDelim: DelimiterType) => {
    setDelimiter(newDelim);
    const items = parseRawText(pasteText, newDelim, customDelimiter);
    setParsedItems(items);
  };

  const handleCustomDelimiterChange = (val: string) => {
    setCustomDelimiter(val);
    if (delimiter === 'custom') {
      const items = parseRawText(pasteText, 'custom', val);
      setParsedItems(items);
    }
  };

  const handleFileProcess = async (file: File) => {
    setError(null);
    setFileInputName(file.name);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const content = await file.text();

      let items: string[] = [];

      if (extension === 'json') {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            items = parsed.map(item => {
              if (typeof item === 'string') return item.trim();
              if (item && typeof item === 'object') {
                return (item.text || item.content || item.line || JSON.stringify(item)).trim();
              }
              return String(item).trim();
            }).filter(Boolean);
          } else if (parsed && typeof parsed === 'object') {
            const values = Object.values(parsed);
            items = values.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean);
          }
        } catch {
          throw new Error('Invalid JSON format. Please upload an array of strings or objects with a "text" field.');
        }
      } else if (extension === 'csv') {
        // Parse CSV
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) throw new Error('CSV file is empty');

        // Check if first line is a header
        const header = lines[0].toLowerCase();
        const headerCols = header.split(',').map(c => c.replace(/["']/g, '').trim());
        const textColIdx = headerCols.findIndex(c => c === 'text' || c === 'content' || c === 'sentence');
        const startRow = textColIdx !== -1 ? 1 : 0;
        const targetCol = textColIdx !== -1 ? textColIdx : 0;

        for (let i = startRow; i < lines.length; i++) {
          const row = lines[i];
          // Basic CSV quote handling
          const cols: string[] = [];
          let current = '';
          let inQuotes = false;
          for (let c = 0; c < row.length; c++) {
            const char = row[c];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              cols.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          cols.push(current.trim());

          const extracted = (cols[targetCol] || cols[0] || '').replace(/^["']|["']$/g, '').trim();
          if (extracted) items.push(extracted);
        }
      } else {
        // Treat as plain text
        items = parseRawText(content, delimiter, customDelimiter);
      }

      if (items.length === 0) {
        throw new Error('No valid text rows or items found in the file.');
      }

      setParsedItems(items);
      setPasteText(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file';
      setError(msg);
      setParsedItems([]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileProcess(e.target.files[0]);
    }
  };

  const removeItem = (index: number) => {
    setParsedItems(prev => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setParsedItems([]);
    setPasteText('');
    setFileInputName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const totalChars = useMemo(() => {
    return parsedItems.reduce((acc, curr) => acc + curr.length, 0);
  }, [parsedItems]);

  const handleSubmit = () => {
    if (parsedItems.length === 0) {
      setError('Please add at least one text item to start the queue.');
      return;
    }
    onQueueItems(parsedItems, config);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-[28px] sm:rounded-[36px] shadow-2xl flex flex-col overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-purple/10 text-brand-purple rounded-2xl border border-brand-purple/20">
              <Layers size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Batch TTS Queue
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-brand-purple/20 text-brand-purple font-semibold">
                  Multi-Input
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                စာသားများ တစ်ပြိုင်နက်တင်ပြီး အစီအစဉ်လိုက် အသံထုတ်ယူရန် (Queue System)
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Tabs */}
          <div className="flex items-center gap-2 bg-slate-950/60 p-1.5 rounded-2xl border border-slate-800 w-fit">
            <button
              onClick={() => setActiveTab('upload')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'upload' 
                  ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/25' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Upload size={14} />
              Upload File (.txt, .csv, .json)
            </button>
            <button
              onClick={() => setActiveTab('paste')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'paste' 
                  ? 'bg-brand-purple text-white shadow-lg shadow-brand-purple/25' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText size={14} />
              Paste Multiple Texts
            </button>
          </div>

          {/* Tab 1: Upload File */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 sm:p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${
                  isDragging 
                    ? 'border-brand-purple bg-brand-purple/10' 
                    : 'border-slate-700/80 hover:border-brand-purple/50 bg-slate-950/40 hover:bg-slate-950/70'
                }`}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileInputChange} 
                  accept=".txt,.csv,.json"
                  className="hidden" 
                />
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-brand-purple shadow-inner">
                  <Upload size={28} className="animate-bounce-subtle" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white mb-1">
                    {fileInputName ? fileInputName : 'Drop your file here or click to browse'}
                  </h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Supported formats: <span className="text-brand-purple font-semibold">.TXT</span> (one per line), <span className="text-emerald-400 font-semibold">.CSV</span> (columns/text), or <span className="text-amber-400 font-semibold">.JSON</span> (string array)
                  </p>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-500 font-medium">
                  <span className="flex items-center gap-1.5"><FileText size={12} /> Text file</span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5"><FileSpreadsheet size={12} /> Spreadsheet CSV</span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5"><FileCode size={12} /> JSON Array</span>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Paste Multiple Texts */}
          {activeTab === 'paste' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
                  <ListPlus size={14} className="text-brand-purple" />
                  Paste script or multiple lines:
                </label>

                {/* Delimiter selector */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">Separate by:</span>
                  <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => handleDelimiterChange('newline')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${delimiter === 'newline' ? 'bg-brand-purple text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      Line by Line
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelimiterChange('paragraph')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${delimiter === 'paragraph' ? 'bg-brand-purple text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      Paragraphs
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelimiterChange('sentence')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${delimiter === 'sentence' ? 'bg-brand-purple text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      Sentences (။ / .)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelimiterChange('custom')}
                      className={`px-2.5 py-1 rounded-lg font-medium transition-all ${delimiter === 'custom' ? 'bg-brand-purple text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      Custom
                    </button>
                  </div>
                </div>
              </div>

              {delimiter === 'custom' && (
                <div className="flex items-center gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400">Custom Delimiter string:</span>
                  <input
                    type="text"
                    value={customDelimiter}
                    onChange={(e) => handleCustomDelimiterChange(e.target.value)}
                    placeholder="e.g. --- or ///"
                    className="bg-black/50 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand-purple w-36"
                  />
                </div>
              )}

              <textarea
                value={pasteText}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="မင်္ဂလာပါ ခင်ဗျာ။ ပထမ စာပိုဒ်...&#10;&#10;ဒုတိယ စာပိုဒ်...&#10;&#10;တတိယ စာကြောင်း..."
                rows={6}
                className="w-full bg-slate-950/70 border border-slate-800 rounded-2xl p-4 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-purple/40 font-mono transition-all"
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-400 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Voice Configuration & Batch Options */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-950/50 p-4 rounded-2xl border border-slate-800/80">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Voice Persona / အသံ
              </label>
              <div className="relative">
                <select
                  value={config.voiceId}
                  onChange={(e) => setConfig(prev => ({ ...prev, voiceId: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white appearance-none focus:outline-none focus:ring-1 focus:ring-brand-purple"
                >
                  {VOICE_OPTIONS.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Speed / အမြန်နှုန်း ({config.speed}x)
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config.speed}
                onChange={(e) => setConfig(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
                className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-brand-purple mt-2"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Volume Gain Boost (+{config.volume || 0} dB)
              </label>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={config.volume || 0}
                onChange={(e) => setConfig(prev => ({ ...prev, volume: parseInt(e.target.value, 10) }))}
                className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-amber-400 mt-2"
              />
            </div>
          </div>

          {/* Parsed Items List Preview */}
          {parsedItems.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">
                    Parsed Queue Items ({parsedItems.length})
                  </span>
                  <span className="text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                    {totalChars} characters total
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium transition-colors"
                >
                  <Trash2 size={12} /> Clear all
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {parsedItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl hover:border-slate-700 transition-colors text-xs group"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-lg bg-brand-purple/20 text-brand-purple text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <p className="text-slate-200 line-clamp-2 leading-relaxed">
                        {item}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-slate-500 font-mono">
                        {item.length} chars
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="opacity-40 group-hover:opacity-100 text-rose-400 hover:text-rose-300 p-1 hover:bg-rose-500/10 rounded transition-all"
                        title="Remove segment"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <Sparkles size={14} className="text-amber-400" />
            <span>Items will be generated sequentially in background.</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-bold hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={parsedItems.length === 0 || isProcessing}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-brand-purple text-white text-xs font-bold shadow-lg shadow-brand-purple/30 hover:bg-brand-purple/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={14} fill="currentColor" />
              Queue {parsedItems.length > 0 ? `${parsedItems.length} Items` : 'Batch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
