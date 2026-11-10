import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, Upload, Settings, Play, Pause, RotateCcw, Download, 
  CheckCircle2, AlertCircle, Copy, HelpCircle, Layers, RefreshCw, 
  Languages, Subtitles, ExternalLink, ShieldAlert, FileCode, Check
} from 'lucide-react';

const PRESET_PROMPTS = [
  {
    name: "Phim Điện Ảnh / Truyền Hình",
    desc: "Tự nhiên, mượt mà, chuẩn văn phong điện ảnh Việt Nam",
    prompt: "Bạn là một biên dịch viên phụ đề phim chuyên nghiệp. Hãy dịch các đoạn phụ đề sau sang tiếng Việt. Giữ nguyên phong cách nói tự nhiên, mượt mà, giàu cảm xúc và sát với ngữ cảnh điện ảnh Việt Nam. Tuyệt đối giữ nguyên mốc thời gian (timestamp) và số thứ tự của file phụ đề."
  },
  {
    name: "Phim Tài Liệu / Khoa Học",
    desc: "Chính xác, trang trọng, dùng từ ngữ chuyên môn",
    prompt: "Bạn là dịch giả tài liệu khoa học. Hãy dịch các đoạn phụ đề sau sang tiếng Việt với văn phong chính xác, rõ ràng, trang trọng. Sử dụng thuật ngữ chuyên môn đúng ngữ cảnh. Giữ nguyên định dạng và mốc thời gian gốc."
  },
  {
    name: "Game & Công Nghệ",
    desc: "Hiện đại, tự nhiên, hợp ngữ cảnh game thủ",
    prompt: "Bạn là chuyên gia dịch thuật game và công nghệ. Hãy dịch phụ đề sang tiếng Việt mượt mà, hợp xu hướng game thủ và giới công nghệ. Giữ nguyên định dạng phụ đề gốc."
  },
  {
    name: "Anime / Hoạt Hình",
    desc: "Gần gũi, biểu cảm, đúng đại từ xưng hô",
    prompt: "Bạn là dịch giả phụ đề Anime/Hoạt hình. Dịch sang tiếng Việt tự nhiên, giữ đúng phong thái nhân vật và cách xưng hô phù hợp văn hóa Việt Nam. Giữ nguyên định dạng phụ đề gốc."
  }
];

export default function App() {
  // Config States
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('deepseek_key') || '');
  const [model, setModel] = useState('deepseek-chat');
  const [temperature, setTemperature] = useState(0.3);
  const [linesPerPart, setLinesPerPart] = useState(200);
  const [systemPrompt, setSystemPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [autoDownload, setAutoDownload] = useState(true);

  // File & Subtitle States
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState('srt'); // srt | vtt | txt
  const [parsedBlocks, setParsedBlocks] = useState([]);
  const [parts, setParts] = useState([]);
  
  // App UI & Translation States
  const [activeTab, setActiveTab] = useState('translator'); // translator | guide
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTranslatingPart, setCurrentTranslatingPart] = useState(null);
  const [copied, setCopied] = useState(false);
  const [selectedPartView, setSelectedPartView] = useState('all');

  const pauseRef = useRef(false);
  const cancelRef = useRef(false);

  // Save API Key
  useEffect(() => {
    localStorage.setItem('deepseek_key', apiKey);
  }, [apiKey]);

  // Handle File Upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    const ext = file.name.split('.').pop().toLowerCase();
    setFileType(ext === 'vtt' ? 'vtt' : ext === 'txt' ? 'txt' : 'srt');

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      setFileContent(text);
      parseSubtitle(text);
    };
    reader.readAsText(file);
  };

  // Parse SRT/VTT/TXT into blocks
  const parseSubtitle = (text) => {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    let currentBlock = { id: '', time: '', text: '' };
    let textBuffer = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentBlock.time || textBuffer.length > 0) {
          currentBlock.text = textBuffer.join('\n');
          blocks.push({ ...currentBlock });
          currentBlock = { id: '', time: '', text: '' };
          textBuffer = [];
        }
      } else if (trimmed.includes('-->')) {
        currentBlock.time = trimmed;
      } else if (!currentBlock.time && /^\d+$/.test(trimmed)) {
        currentBlock.id = trimmed;
      } else {
        textBuffer.push(trimmed);
      }
    });

    if (currentBlock.time || textBuffer.length > 0) {
      currentBlock.text = textBuffer.join('\n');
      blocks.push(currentBlock);
    }

    setParsedBlocks(blocks);
    sliceIntoParts(blocks, linesPerPart);
  };

  // Divide into Parts
  const sliceIntoParts = (blocks, chunkSize) => {
    const totalParts = Math.ceil(blocks.length / chunkSize);
    const newParts = [];

    for (let i = 0; i < totalParts; i++) {
      const partBlocks = blocks.slice(i * chunkSize, (i + 1) * chunkSize);
      newParts.push({
        id: i + 1,
        startIndex: i * chunkSize + 1,
        endIndex: Math.min((i + 1) * chunkSize, blocks.length),
        blocks: partBlocks,
        translatedBlocks: [],
        status: 'idle', // idle | translating | completed | error
        error: null
      });
    }
    setParts(newParts);
  };

  // Re-slice when chunk size changes
  const handleChunkSizeChange = (newSize) => {
    setLinesPerPart(newSize);
    if (parsedBlocks.length > 0) {
      sliceIntoParts(parsedBlocks, newSize);
    }
  };

  // Call DeepSeek API for a specific Part
  const translateSinglePart = async (partToTranslate, customPrompt = systemPrompt) => {
    if (!apiKey) {
      alert("Vui lòng nhập DeepSeek API Key!");
      return null;
    }

    const payloadText = partToTranslate.blocks.map((b, idx) => {
      return `[ID: ${b.id || idx + 1}]\n${b.time ? b.time + '\n' : ''}${b.text}`;
    }).join('\n\n');

    const promptUser = `Dưới đây là phần phụ đề từ dòng ${partToTranslate.startIndex} đến ${partToTranslate.endIndex}. Hãy dịch sang tiếng Việt và giữ nguyên định dạng ID, Mốc thời gian (Timestamp):\n\n${payloadText}`;

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: model,
          temperature: parseFloat(temperature),
          messages: [
            { role: 'system', content: customPrompt },
            { role: 'user', content: promptUser }
          ]
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Lỗi API HTTP: ${response.status}`);
      }

      const data = await response.json();
      const rawResult = data.choices[0].message.content;

      const rawBlocks = rawResult.split(/\n\s*\n/);
      const translatedBlocks = partToTranslate.blocks.map((orig, i) => {
        const foundRaw = rawBlocks[i] || '';
        const lines = foundRaw.split('\n').filter(l => l.trim() !== '');
        
        let transText = foundRaw;
        if (lines.length >= 3 && lines[1].includes('-->')) {
          transText = lines.slice(2).join('\n');
        } else if (lines.length >= 2 && lines[0].includes('-->')) {
          transText = lines.slice(1).join('\n');
        }

        return {
          ...orig,
          translatedText: transText || '[Dịch lỗi / Khống tìm thấy]'
        };
      });

      return translatedBlocks;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  // Translate Single Part Trigger
  const handleTranslatePart = async (partId) => {
    const partIdx = parts.findIndex(p => p.id === partId);
    if (partIdx === -1) return;

    const updated = [...parts];
    updated[partIdx].status = 'translating';
    setParts(updated);

    try {
      const res = await translateSinglePart(parts[partIdx]);
      if (res) {
        updated[partIdx].translatedBlocks = res;
        updated[partIdx].status = 'completed';
        setParts([...updated]);
      }
    } catch (err) {
      updated[partIdx].status = 'error';
      updated[partIdx].error = err.message;
      setParts([...updated]);
    }
  };

  // Translate All Parts Sequentially
  const startTranslateAll = async () => {
    if (!apiKey) {
      alert("Vui lòng nhập DeepSeek API Key trước khi dịch!");
      return;
    }

    setIsTranslating(true);
    setIsPaused(false);
    pauseRef.current = false;
    cancelRef.current = false;

    let currentPartsState = [...parts];

    for (let i = 0; i < currentPartsState.length; i++) {
      if (cancelRef.current) break;

      while (pauseRef.current) {
        await new Promise(r => setTimeout(r, 500));
        if (cancelRef.current) break;
      }

      if (currentPartsState[i].status === 'completed') continue;

      setCurrentTranslatingPart(currentPartsState[i].id);
      currentPartsState[i].status = 'translating';
      setParts([...currentPartsState]);

      try {
        const res = await translateSinglePart(currentPartsState[i]);
        if (res) {
          currentPartsState[i].translatedBlocks = res;
          currentPartsState[i].status = 'completed';
        }
      } catch (err) {
        currentPartsState[i].status = 'error';
        currentPartsState[i].error = err.message;
      }

      setParts([...currentPartsState]);
    }

    setIsTranslating(false);
    setCurrentTranslatingPart(null);

    // Auto Download combined file if option enabled
    const allDone = currentPartsState.every(p => p.status === 'completed');
    if (allDone && autoDownload) {
      downloadCombinedFile(currentPartsState);
    }
  };

  const togglePause = () => {
    pauseRef.current = !pauseRef.current;
    setIsPaused(pauseRef.current);
  };

  const cancelTranslation = () => {
    cancelRef.current = true;
    setIsTranslating(false);
    setIsPaused(false);
  };

  // Helper to Format Output File Content
  const generateOutputText = (partsList) => {
    const allTranslated = partsList.flatMap(p => p.translatedBlocks);
    if (allTranslated.length === 0) return '';

    return allTranslated.map((b, idx) => {
      let out = '';
      if (fileType === 'vtt') {
        out += `${b.time}\n${b.translatedText}`;
      } else {
        out += `${b.id || idx + 1}\n${b.time}\n${b.translatedText}`;
      }
      return out;
    }).join('\n\n');
  };

  // Auto/Manual Download Combined Subtitle File
  const downloadCombinedFile = (partsToCombine = parts) => {
    const textContent = generateOutputText(partsToCombine);
    if (!textContent) {
      alert("Chưa có dữ liệu dịch để tải về!");
      return;
    }

    let finalContent = textContent;
    if (fileType === 'vtt' && !finalContent.startsWith('WEBVTT')) {
      finalContent = 'WEBVTT\n\n' + finalContent;
    }

    const baseName = fileName ? fileName.substring(0, fileName.lastIndexOf('.')) : 'Subtitle';
    const outputFileName = `${baseName}_TV-Sub.vi.${fileType}`;

    const blob = new Blob([finalContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = outputFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download individual Part
  const downloadSinglePart = (part) => {
    if (part.translatedBlocks.length === 0) return;
    const textContent = part.translatedBlocks.map((b, idx) => {
      return `${b.id || idx + 1}\n${b.time}\n${b.translatedText}`;
    }).join('\n\n');

    const baseName = fileName ? fileName.substring(0, fileName.lastIndexOf('.')) : 'Part';
    const outputFileName = `${baseName}_Part${part.id}_TV-Sub.vi.${fileType}`;

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = outputFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy Full Translated Text
  const handleCopy = () => {
    const text = generateOutputText(parts);
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const completedCount = parts.filter(p => p.status === 'completed').length;
  const progressPercent = parts.length > 0 ? Math.round((completedCount / parts.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-600/30">
              <Languages className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                DeepSeek Subtitle Master
              </h1>
              <p className="text-xs text-slate-400">Dịch phụ đề tự động theo Part | Chuẩn TV-Sub.vi</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('translator')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'translator' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Trình Dịch
            </button>
            <button
              onClick={() => setActiveTab('guide')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center space-x-1 ${
                activeTab === 'guide' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <HelpCircle className="w-4 h-4 mr-1" />
              <span>Hướng Dẫn Deploy Vercel</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      {activeTab === 'translator' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Config & Control Panel (4 Cols) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* API & Model Config */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h2 className="font-semibold text-slate-200">Cấu Hình DeepSeek API</h2>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  DeepSeek API Key <span className="text-rose-400">*</span>
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Mô Hình</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="deepseek-chat">deepseek-chat (V3)</option>
                    <option value="deepseek-reasoner">deepseek-reasoner (R1)</option>
                    <option value="deepseek-coder">deepseek-coder</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Temperature ({temperature})</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    className="w-full accent-indigo-500 mt-2"
                  />
                </div>
              </div>

              {/* Chunk Size / Parts config */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Chia Part Phụ Đề (Mặc định 200 dòng/part)
                </label>
                <select
                  value={linesPerPart}
                  onChange={(e) => handleChunkSizeChange(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value={50}>50 dòng / Part (Nhanh, an toàn)</option>
                  <option value={100}>100 dòng / Part</option>
                  <option value={200}>200 dòng / Part (Khuyên dùng)</option>
                  <option value={300}>300 dòng / Part (File lớn)</option>
                </select>
              </div>

              {/* Auto download toggle */}
              <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-xs text-slate-300">Auto Download sau khi hoàn thành</span>
                <input
                  type="checkbox"
                  checked={autoDownload}
                  onChange={(e) => setAutoDownload(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
                />
              </div>
            </div>

            {/* System Prompt Customization */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <FileCode className="w-5 h-5 text-cyan-400" />
                  <h2 className="font-semibold text-slate-200">System Prompt</h2>
                </div>
                <button
                  onClick={() => setSystemPrompt(PRESET_PROMPTS[0].prompt)}
                  className="text-xs text-indigo-400 hover:underline flex items-center"
                >
                  <RotateCcw className="w-3 h-3 mr-1" /> Mặc định
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Preset Mẫu:</label>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setSystemPrompt(p.prompt)}
                      className="text-left bg-slate-950 border border-slate-800/80 p-2 rounded-lg hover:border-indigo-500/50 transition text-xs"
                    >
                      <div className="font-medium text-indigo-300">{p.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed resize-none"
              ></textarea>
            </div>

            {/* Upload File Box */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl text-center">
              <label className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition bg-slate-950/40">
                <Upload className="w-8 h-8 text-indigo-400 mb-2" />
                <span className="text-sm font-medium text-slate-300">Tải lên File Phụ Đề</span>
                <span className="text-xs text-slate-500 mt-1">Hỗ trợ định dạng .srt, .vtt, .txt</span>
                <input
                  type="file"
                  accept=".srt,.vtt,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {fileName && (
                <div className="mt-4 bg-indigo-950/40 border border-indigo-800/50 rounded-xl p-3 text-left flex items-center justify-between">
                  <div className="truncate">
                    <p className="text-xs font-semibold text-indigo-300 truncate">{fileName}</p>
                    <p className="text-[10px] text-slate-400">{parsedBlocks.length} dòng phụ đề | {parts.length} Parts</p>
                  </div>
                  <span className="bg-indigo-600/30 text-indigo-300 text-[10px] px-2 py-1 rounded font-mono uppercase">
                    {fileType}
                  </span>
                </div>
              )}
            </div>

          </div>

          {/* Right Column: Execution & Preview Panel (8 Cols) */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Status & Execution Control */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-200 flex items-center">
                    <Layers className="w-5 h-5 text-indigo-400 mr-2" />
                    Tiến Trình Dịch Theo Part ({completedCount}/{parts.length})
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    File sẽ được tự động gộp và tải về dưới tên <code className="text-indigo-300 font-mono">*_TV-Sub.vi.{fileType}</code>
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  {!isTranslating ? (
                    <button
                      onClick={startTranslateAll}
                      disabled={parts.length === 0}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-medium text-sm flex items-center shadow-lg shadow-indigo-600/30 transition"
                    >
                      <Play className="w-4 h-4 mr-2" /> Dịch Tất Cả Các Part
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={togglePause}
                        className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-medium flex items-center"
                      >
                        {isPaused ? <Play className="w-3.5 h-3.5 mr-1" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
                        {isPaused ? "Tiếp Tục" : "Tạm Dừng"}
                      </button>
                      <button
                        onClick={cancelTranslation}
                        className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-xl text-xs font-medium"
                      >
                        Hủy Bỏ
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {parts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Tiến độ hoàn thành: {progressPercent}%</span>
                    <span>{completedCount} / {parts.length} Part</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800">
                    <div 
                      className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Parts Grid Status */}
              {parts.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                  {parts.map((p) => (
                    <div 
                      key={p.id}
                      className={`p-3 rounded-xl border flex flex-col justify-between space-y-2 text-xs transition ${
                        p.status === 'completed' 
                          ? 'bg-emerald-950/20 border-emerald-800/50 text-emerald-300'
                          : p.status === 'translating'
                          ? 'bg-indigo-950/40 border-indigo-500 animate-pulse text-indigo-300'
                          : p.status === 'error'
                          ? 'bg-rose-950/20 border-rose-800/50 text-rose-300'
                          : 'bg-slate-950/50 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Part {p.id}</span>
                        {p.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        {p.status === 'translating' && <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />}
                        {p.status === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                      </div>

                      <div className="text-[11px] opacity-80">
                        Dòng {p.startIndex} - {p.endIndex}
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-800/40">
                        <button
                          onClick={() => handleTranslatePart(p.id)}
                          disabled={isTranslating}
                          className="text-[10px] text-indigo-400 hover:underline disabled:opacity-30"
                        >
                          {p.status === 'completed' ? 'Dịch lại' : 'Dịch Part này'}
                        </button>
                        {p.status === 'completed' && (
                          <button
                            onClick={() => downloadSinglePart(p)}
                            className="text-[10px] text-slate-300 hover:text-white flex items-center"
                          >
                            <Download className="w-3 h-3 mr-0.5" /> Tải Part
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Global Output Actions */}
              {completedCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => downloadCombinedFile()}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center shadow-md transition"
                    >
                      <Download className="w-4 h-4 mr-1.5" /> Tải File Hoàn Chỉnh (_TV-Sub.vi)
                    </button>
                    <button
                      onClick={handleCopy}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-xl text-xs flex items-center transition"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                      {copied ? "Đã chép" : "Sao chép"}
                    </button>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400">Xem Part:</span>
                    <select
                      value={selectedPartView}
                      onChange={(e) => setSelectedPartView(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300"
                    >
                      <option value="all">Tất cả các Part</option>
                      {parts.map(p => (
                        <option key={p.id} value={p.id}>Part {p.id}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Side-by-Side Comparison Preview */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <h3 className="font-semibold text-slate-200 flex items-center text-sm">
                <Subtitles className="w-4 h-4 text-cyan-400 mr-2" />
                Xem Bảng Phân Tách & Kết Quả Song Song
              </h3>

              <div className="max-h-[500px] overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-800">
                {parts.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    Vui lòng chọn hoặc kéo thả file phụ đề vào ô bên trái để xem trước nội dung
                  </div>
                ) : (
                  parts
                    .filter(p => selectedPartView === 'all' || p.id === Number(selectedPartView))
                    .map(part => (
                      <div key={part.id} className="space-y-2">
                        <div className="bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800/80 text-xs font-semibold text-indigo-400 sticky top-0 backdrop-blur">
                          Part {part.id} (Dòng {part.startIndex} - {part.endIndex})
                        </div>
                        {part.blocks.map((block, idx) => {
                          const translatedBlock = part.translatedBlocks[idx];
                          return (
                            <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 text-xs">
                              {/* Original */}
                              <div className="space-y-1">
                                <div className="text-[10px] font-mono text-slate-500 flex justify-between">
                                  <span>#{block.id || idx + 1}</span>
                                  <span>{block.time}</span>
                                </div>
                                <div className="text-slate-300 whitespace-pre-wrap">{block.text}</div>
                              </div>
                              {/* Translated */}
                              <div className="space-y-1 md:border-l md:border-slate-800/80 md:pl-3">
                                <div className="text-[10px] font-mono text-indigo-400">
                                  {translatedBlock ? 'Tiếng Việt (Đã dịch)' : 'Chờ dịch...'}
                                </div>
                                <div className="text-emerald-300 font-medium whitespace-pre-wrap">
                                  {translatedBlock ? translatedBlock.translatedText : '---'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))
                )}
              </div>
            </div>

          </div>
        </main>
      ) : (
        /* Guide Tab for Vercel Deployment */
        <main className="flex-1 max-w-4xl w-full mx-auto p-6 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-100 flex items-center">
                <ExternalLink className="w-5 h-5 text-indigo-400 mr-2" />
                Hướng Dẫn Đưa Trang Web Lên Vercel.app Bản Chuẩn
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Làm theo các bước đơn giản dưới đây để sở hữu tên miền <code className="text-indigo-300 font-mono">your-app.vercel.app</code> hoàn toàn miễn phí.
              </p>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-semibold text-indigo-400">Bước 1: Tạo dự án React Vite local</h3>
                <pre className="bg-slate-900 p-3 rounded-lg font-mono text-slate-200 overflow-x-auto">
{`npm create vite@latest deepseek-sub-master -- --template react
cd deepseek-sub-master
npm install
npm install lucide-react tailwindcss autoprefixer postcss
npx tailwindcss init -p`}
                </pre>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-semibold text-indigo-400">Bước 2: Thay mã nguồn App.jsx</h3>
                <p className="text-slate-400">Dán toàn bộ mã nguồn của file `App.jsx` hiện tại vào đường dẫn `src/App.jsx` trong thư mục dự án của bạn.</p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-semibold text-indigo-400">Bước 3: Push dự án lên GitHub</h3>
                <pre className="bg-slate-900 p-3 rounded-lg font-mono text-slate-200 overflow-x-auto">
{`git init
git add .
git commit -m "Initial commit DeepSeek Subtitle Master"
git branch -M main
git remote add origin https://github.com/<tên-username-github>/deepseek-sub-master.git
git push -u origin main`}
                </pre>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-semibold text-indigo-400">Bước 4: Connect Vercel và Deploy</h3>
                <ol className="list-decimal list-inside space-y-1 text-slate-400">
                  <li>Truy cập <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-indigo-400 underline">Vercel.com</a> và đăng nhập tài khoản GitHub.</li>
                  <li>Nhấn nút <strong>Add New... $ightarrow$ Project</strong>.</li>
                  <li>Chọn repository <code className="text-slate-200 font-mono">deepseek-sub-master</code> và bấm <strong>Import</strong>.</li>
                  <li>Nhấn <strong>Deploy</strong>. Vercel sẽ tự động build trang web của bạn sau 1 phút!</li>
                </ol>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        DeepSeek Subtitle Master &copy; 2026 | Tự động thêm hậu tố <code className="text-indigo-400 font-mono">_TV-Sub.vi</code> khi xuất file
      </footer>
    </div>
  );
}
