import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  Copy,
  FileDiff,
  FileMinus,
  FilePlus,
  FileText,
  GitCommit,
  HelpCircle,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  User,
} from "lucide-react";
import type {
  AppError,
  CommitDetails as CommitDetailsModel,
  CommitInfo,
  DiffOutput,
  GraphRow,
} from "../../types/ipc";
import type { RepositorySummary } from "../../types/navigation";
import {
  repositoryAmendMessage,
  repositoryGetCommitDetails,
  repositoryGetCommitDiff,
  repositoryGetHistory,
} from "../../lib/tauriCommands";
import { shortSha, useNotify } from "../../components/common/Toast";
import { useDialogA11y } from "../../lib/useDialogA11y";

interface HistoryViewProps {
  repoId?: string | null;
  currentRepo?: RepositorySummary | { id: string; name?: string; path?: string } | null;
}

const PAGE_SIZE = 30;

// ---------------------------------------------------------------------------
// v0.2 madde 6 — grafik çizim yardımcıları
// ---------------------------------------------------------------------------

/** Çekirdekteki color_index_for ile birebir aynı kararlı renk seçimi. */
const LANE_COLORS = ["#38bdf8", "#fbbf24", "#34d399", "#f472b6", "#a78bfa", "#fb923c"];

function colorFor(sha: string): string {
  let acc = 0;
  for (let i = 0; i < Math.min(sha.length, 8); i++) {
    acc = (acc * 31 + sha.charCodeAt(i)) >>> 0;
  }
  return LANE_COLORS[acc % LANE_COLORS.length];
}

function refChipClass(ref: string): string {
  if (ref.startsWith("tag:")) return "bg-amber-950/70 text-amber-300 border-amber-800/60";
  if (ref === "HEAD") return "bg-slate-800 text-slate-300 border-slate-700";
  if (ref.includes("/")) return "bg-sky-950/70 text-sky-300 border-sky-800/60";
  return "bg-emerald-950/70 text-emerald-300 border-emerald-800/60";
}

const GRAPH_COL_WIDTH = 14;
const GRAPH_PAD = 5;

/**
 * Tek satırlık grafik şeridi. SVG çizgileri `non-scaling-stroke` ile her satır
 * yüksekliğinde sabit kalır; commit noktası HTML div'dir (daire bozulmaz).
 * Erişilebilirlik: çizim aria-hidden, satırın kendisi zaten erişilebilir.
 */
const GraphStrip: React.FC<{ row: GraphRow; color: string; laneCount: number }> = ({
  row,
  color,
  laneCount,
}) => {
  const width = laneCount * GRAPH_COL_WIDTH + GRAPH_PAD * 2;
  const cx = (lane: number) => GRAPH_PAD + lane * GRAPH_COL_WIDTH + GRAPH_COL_WIDTH / 2;
  return (
    <div
      className="relative shrink-0 self-stretch"
      style={{ width }}
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
      >
        {/* Dikey geçen çizgiler */}
        {row.active_lanes
          .filter((l) => l !== row.lane)
          .map((l) => (
            <line
              key={`v-${l}`}
              x1={cx(l)}
              y1={0}
              x2={cx(l)}
              y2={100}
              stroke={color}
              strokeOpacity={0.45}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {/* Üstten commit noktasına kavusan ebeveyn çizgileri */}
        {row.edges
          .filter((e) => e.kind === "merge_in")
          .map((e, i) => (
            <path
              key={`m-${i}`}
              d={`M ${cx(e.from_lane)} 0 C ${cx(e.from_lane)} 30, ${cx(e.to_lane)} 30, ${cx(e.to_lane)} 50`}
              fill="none"
              stroke={color}
              strokeOpacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {/* Commit'ten aşağı inen ebeveyn çizgileri */}
        {row.edges
          .filter((e) => e.kind === "branch_out")
          .map((e, i) =>
            e.from_lane === e.to_lane ? (
              <line
                key={`b-${i}`}
                x1={cx(e.to_lane)}
                y1={50}
                x2={cx(e.to_lane)}
                y2={100}
                stroke={color}
                strokeOpacity={0.7}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <path
                key={`b-${i}`}
                d={`M ${cx(e.from_lane)} 50 C ${cx(e.from_lane)} 75, ${cx(e.to_lane)} 75, ${cx(e.to_lane)} 100`}
                fill="none"
                stroke={color}
                strokeOpacity={0.7}
                vectorEffect="non-scaling-stroke"
              />
            )
          )}
        {/* Commit'ten yukarı (kendi seridinin üst kısmı) */}
        <line
          x1={cx(row.lane)}
          y1={0}
          x2={cx(row.lane)}
          y2={50}
          stroke={color}
          strokeOpacity={0.7}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute h-2.5 w-2.5 rounded-full border-2"
        style={{
          left: cx(row.lane) - 5,
          top: "50%",
          transform: "translateY(-50%)",
          borderColor: color,
          backgroundColor: "transparent",
        }}
      />
    </div>
  );
};

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("tr-TR");
}

function FileStatusIcon({
  status,
}: {
  status: CommitDetailsModel["files"][number]["status"];
}) {
  switch (status) {
    case "added":
      return <FilePlus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case "deleted":
      return <FileMinus className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
    case "untracked":
      return <HelpCircle className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    default:
      return <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  }
}

export const HistoryView: React.FC<HistoryViewProps> = ({ repoId, currentRepo }) => {
  const activeRepoId = repoId ?? currentRepo?.id ?? null;

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [graph, setGraph] = useState<GraphRow[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Commit detail pane
  const [details, setDetails] = useState<CommitDetailsModel | null>(null);
  const [commitDiff, setCommitDiff] = useState<DiffOutput | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // v0.2 — son commit mesajını düzenleme (kontrollü amend)
  const notify = useNotify();
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendText, setAmendText] = useState("");
  const [amendBusy, setAmendBusy] = useState(false);
  const [amendError, setAmendError] = useState<string | null>(null);
  const detailsAbort = useRef(0);
  // CB-09/CB-10: amend diyaloğunda açılış odağı + Escape + Tab tuzağı.
  // İşlem sürerken (amendBusy) Escape kapatmaz — overlay tıklamasıyla aynı kural.
  const amendDialogRef = useDialogA11y(amendOpen && !!selectedCommit, () => {
    if (!amendBusy) setAmendOpen(false);
  });
  // CB-05: depo geçişinde eski deponun geç dönen geçmiş yanıtı yeni listeyi
  // ezmesin; sıra numarası her talepte artar, bayat sonuç düşürülür.
  const historyReqSeq = useRef(0);

  const loadHistory = useCallback(
    async (reset = true) => {
      if (!activeRepoId) {
        setCommits([]);
        setGraph([]);
        setSelectedCommit(null);
        setHasMore(false);
        setNextOffset(0);
        return;
      }

      const seq = ++historyReqSeq.current;
      if (reset) setIsLoading(true);
      else setIsLoadingMore(true);
      setError(null);

      const offset = reset ? 0 : nextOffset;
      try {
        const historyRes = await repositoryGetHistory(
          activeRepoId,
          null,
          PAGE_SIZE,
          offset
        );
        if (historyReqSeq.current !== seq) return; // bayat yanıt
        if (reset) {
          setCommits(historyRes.commits);
          setGraph(historyRes.graph ?? []);
          setSelectedCommit(historyRes.commits[0] ?? null);
        } else {
          setCommits((prev) => [...prev, ...historyRes.commits]);
          // Sayfa sınırı: yeni sayfanın grafiği kendi lane'inden başlar
          // (bilincli sınır — tam depo grafiği kapsam dışı).
          setGraph((prev) => [...prev, ...(historyRes.graph ?? [])]);
        }
        setHasMore(historyRes.has_more);
        setNextOffset(historyRes.next_offset);
      } catch (err) {
        if (historyReqSeq.current !== seq) return;
        const e = err as AppError;
        setError(e.message || "Commit geçmişi yüklenemedi.");
      } finally {
        if (historyReqSeq.current === seq) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [activeRepoId, nextOffset]
  );

  useEffect(() => {
    let ignore = false;
    // Depo değişti: ESKİ deponun seçimi/anlık verisi yeni depoya taşınmasın
    // (detay effect'i aksi halde yeniDepo+eskiSha ile boşa IPC atardı).
    setSelectedCommit(null);
    setCommits([]);
    setGraph([]);
    setHasMore(false);
    setNextOffset(0);
    const timer = setTimeout(() => {
      if (!ignore) void loadHistory(true);
    }, 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoId]);

  // Load commit details + diff when the selection changes.
  // The deferral follows the same setTimeout(…, 0) convention as the history
  // loader above: state resets and the loading flag are applied outside the
  // effect body so React never renders a torn intermediate selection state.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!activeRepoId || !selectedCommit) {
        setDetails(null);
        setCommitDiff(null);
        setDetailsError(null);
        return;
      }

      const requestId = ++detailsAbort.current;
      setIsDetailsLoading(true);
      setDetailsError(null);

      void (async () => {
        try {
          const [detailsResult, diffResult] = await Promise.all([
            repositoryGetCommitDetails(activeRepoId, selectedCommit.sha),
            repositoryGetCommitDiff(activeRepoId, selectedCommit.sha),
          ]);
          if (detailsAbort.current !== requestId) return;
          setDetails(detailsResult);
          setCommitDiff(diffResult);
        } catch (err) {
          if (detailsAbort.current !== requestId) return;
          const e = err as AppError;
          setDetails(null);
          setCommitDiff(null);
          setDetailsError(e.message ?? "Commit detayları yüklenemedi.");
        } finally {
          if (detailsAbort.current === requestId) setIsDetailsLoading(false);
        }
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [activeRepoId, selectedCommit]);

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash).catch(() => {});
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Detayda gezinme: ebeveyn SHA'sına atla (sayfada yoksa detaydan çekilir).
  const selectCommitBySha = useCallback(
    async (sha: string) => {
      const found = commits.find((c) => c.sha === sha);
      if (found) {
        setSelectedCommit(found);
        return;
      }
      if (!activeRepoId) return;
      try {
        const d = await repositoryGetCommitDetails(activeRepoId, sha);
        setSelectedCommit(d.commit);
      } catch (err) {
        const e = err as AppError;
        setDetailsError(e.message ?? "Ebeveyn commit yüklenemedi.");
      }
    },
    [activeRepoId, commits]
  );

  const filteredCommits = commits.filter(
    (c) =>
      c.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.author_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.short_sha.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.sha.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // -------------------------------------------------------------------------
  // v0.2 — Amend (madde 3): yalnızca son commit ve push edilmemişse izinli.
  // -------------------------------------------------------------------------

  const aheadCount =
    currentRepo && "ahead" in currentRepo ? (currentRepo.ahead ?? 0) : 0;

  // sha → grafik satırı eşlemesi (arama filtresi indexleri kaydırır).
  const graphBySha = useMemo(
    () => new Map(commits.map((c, i) => [c.sha, graph[i]] as const)),
    [commits, graph]
  );
  const laneCount = useMemo(() => {
    let max = 1;
    for (const row of graph) {
      for (const l of row.active_lanes) max = Math.max(max, l + 1);
      max = Math.max(max, row.lane + 1);
    }
    return max;
  }, [graph]);
  const isSelectedHead =
    commits.length > 0 && selectedCommit?.sha === commits[0]?.sha;
  const canAmendLast = aheadCount > 0 && isSelectedHead;

  const openAmendModal = useCallback(() => {
    if (!selectedCommit) return;
    setAmendText(selectedCommit.message);
    setAmendError(null);
    setAmendOpen(true);
  }, [selectedCommit]);

  const handleAmendSave = useCallback(async () => {
    if (!activeRepoId || !selectedCommit) return;
    const trimmed = amendText.trim();
    if (!trimmed) {
      setAmendError("Mesaj boş olamaz.");
      return;
    }
    setAmendBusy(true);
    setAmendError(null);
    try {
      const result = await repositoryAmendMessage(activeRepoId, trimmed);
      setAmendOpen(false);
      notify.success("Commit mesajı güncellendi", shortSha(result.commit_sha));
      await loadHistory(true);
    } catch (err) {
      const e = err as AppError;
      const code = e.code;
      if (code === "AMEND_PUSHED") {
        setAmendError(
          "Bu commit artık push edilmiş görünüyor; geçmişi korumak için işlem iptal edildi. Bunun yerine yeni bir commit atabilirsin."
        );
      } else {
        setAmendError(e.message ?? "Commit mesajı güncellenemedi.");
      }
    } finally {
      setAmendBusy(false);
    }
  }, [activeRepoId, amendText, loadHistory, notify, selectedCommit]);

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-950">
      {/* Left Column: Commit list */}
      <div className="w-full md:w-96 border-r border-slate-800 bg-slate-900/40 flex flex-col justify-between shrink-0">
        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-sky-400" />
              <h2 className="text-xs font-bold text-slate-200">Commit Geçmişi</h2>
            </div>
            <button
              type="button"
              onClick={() => void loadHistory(true)}
              disabled={isLoading || !activeRepoId}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
              title="Yenile"
              aria-label="Commit Geçmişini Yenile"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Mesaj veya yazar ara..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400"
            />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {!activeRepoId ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Geçmişi görmek için bir depo seçin.
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center p-8 text-slate-400 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
              <span>Geçmiş yükleniyor...</span>
            </div>
          ) : error ? (
            <div className="p-4 text-center text-xs text-rose-400 bg-rose-950/20 rounded-lg border border-rose-900/50">
              {error}
            </div>
          ) : filteredCommits.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              {commits.length === 0
                ? "Bu depoda henüz commit bulunmuyor."
                : "Aramaya uygun commit bulunamadı."}
            </div>
          ) : (
            filteredCommits.map((commit) => {
              const isSelected = selectedCommit?.sha === commit.sha;
              const graphRow = graphBySha.get(commit.sha);
              return (
                <button
                  key={commit.sha}
                  type="button"
                  onClick={() => setSelectedCommit(commit)}
                  className={`w-full text-left p-3 rounded-lg transition-colors cursor-pointer border flex items-stretch gap-2 ${
                    isSelected
                      ? "bg-sky-600/20 border-sky-500/40 text-slate-100"
                      : "bg-slate-900/30 hover:bg-slate-800/60 border-slate-800/60 text-slate-300"
                  }`}
                >
                  {graphRow && (
                    <GraphStrip
                      row={graphRow}
                      color={colorFor(commit.sha)}
                      laneCount={laneCount}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono text-[10px] text-cyan-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                        {commit.short_sha}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate max-w-[120px]">
                        {formatDate(commit.authored_at)}
                      </span>
                    </div>
                    <div className="text-xs font-medium truncate mb-1">
                      {commit.message.split("\n")[0]}
                    </div>
                    {commit.refs && commit.refs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {commit.refs.map((ref) => (
                          <span
                            key={ref}
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${refChipClass(ref)}`}
                          >
                            {ref.startsWith("tag:") ? ref.slice(4) : ref}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="truncate">{commit.author_name}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}

          {hasMore && !isLoading && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => void loadHistory(false)}
                disabled={isLoadingMore}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Yükleniyor...</span>
                  </>
                ) : (
                  <span>Daha Fazla Commit Yükle</span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Commit Details */}
      <div className="flex-1 flex flex-col bg-slate-950 overflow-y-auto p-4 sm:p-6 space-y-4">
        {selectedCommit ? (
          <>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <h1 className="text-sm sm:text-base font-bold text-white whitespace-pre-wrap">
                  {selectedCommit.message.split("\n")[0]}
                </h1>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono text-cyan-400 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    {selectedCommit.short_sha}
                  </span>
                  {canAmendLast && (
                    <button
                      type="button"
                      onClick={openAmendModal}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 transition-colors focus:outline-none focus:ring-1 focus:ring-amber-400 flex items-center gap-1 text-xs"
                      title="Commit henüz push edilmedi — mesajı düzenleyebilirsin"
                      aria-label="Commit mesajını düzenle"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span className="text-[10px]">Mesajı düzenle</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyHash(selectedCommit.sha)}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors focus:outline-none focus:ring-1 focus:ring-sky-400 flex items-center gap-1 text-xs"
                    title="Tam Commit Hash Kopyala"
                    aria-label="Commit Hash Kopyala"
                  >
                    {copiedHash === selectedCommit.sha ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 text-[10px]">Kopyalandı!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="text-[10px]">SHA</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Multiline description if available */}
              {selectedCommit.message.split("\n").length > 1 && (
                <div className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-lg border border-slate-800/60 whitespace-pre-wrap font-mono">
                  {selectedCommit.message.split("\n").slice(1).join("\n").trim()}
                </div>
              )}

              {/* Author & Meta */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/40 border border-slate-800/50">
                  <User className="w-4 h-4 text-sky-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-slate-400 text-[10px]">Yazar</div>
                    <div className="font-medium truncate">
                      {selectedCommit.author_name}{" "}
                      <span className="text-slate-500 font-normal">
                        &lt;{selectedCommit.author_email}&gt;
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/40 border border-slate-800/50">
                  <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-slate-400 text-[10px]">Tarih</div>
                    <div className="font-medium truncate font-mono">
                      {formatDate(selectedCommit.authored_at)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Parents */}
              {selectedCommit.parents.length > 0 && (
                <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                  <GitCommit className="w-3.5 h-3.5 text-slate-500" />
                  <span>Ebeveyn (Parent):</span>
                  {selectedCommit.parents.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void selectCommitBySha(p)}
                      className="font-mono text-[10px] text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 hover:text-sky-300 hover:border-sky-700 transition-colors cursor-pointer"
                      title="Bu commite git"
                    >
                      {p.slice(0, 7)}
                    </button>
                  ))}
                </div>
              )}

              {/* Refs (v0.2 grafik) */}
              {selectedCommit.refs && selectedCommit.refs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {selectedCommit.refs.map((ref) => (
                    <span
                      key={ref}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${refChipClass(ref)}`}
                    >
                      {ref.startsWith("tag:") ? `🏷 ${ref.slice(4)}` : ref}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Files changed */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileDiff className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-slate-200">
                    Değişen Dosyalar
                  </span>
                  {details && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      ({details.files.length})
                    </span>
                  )}
                </div>
                {details && (
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-emerald-400">+{details.additions}</span>
                    <span className="text-rose-400">-{details.deletions}</span>
                  </div>
                )}
              </div>

              {isDetailsLoading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-xs text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Commit detayları yükleniyor…</span>
                </div>
              ) : detailsError ? (
                <div className="flex items-center gap-2 px-4 py-6 text-xs text-rose-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{detailsError}</span>
                </div>
              ) : details && details.files.length > 0 ? (
                <div className="divide-y divide-slate-800/70">
                  {details.files.map((file) => (
                    <div
                      key={`${file.path}-${file.old_path ?? ""}`}
                      className="flex items-center gap-2 px-4 py-2 text-xs text-slate-300"
                    >
                      <FileStatusIcon status={file.status} />
                      <span className="truncate font-mono">{file.path}</span>
                      {file.old_path && (
                        <span className="text-[10px] text-slate-500 truncate">
                          ← {file.old_path}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-xs text-slate-500">
                  Bu commit dosya değişikliği içermiyor.
                </div>
              )}
            </div>

            {/* Diff */}
            {commitDiff && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
                  <FileDiff className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-slate-200">Commit Diff</span>
                </div>
                {commitDiff.binary ? (
                  <div className="px-4 py-6 text-xs text-slate-500">
                    İkili dosya değişikliği olduğu için diff gösterilemiyor.
                  </div>
                ) : commitDiff.truncated ? (
                  <div className="px-4 py-6 text-xs text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Diff 512 KB sınırını aştığı için gösterilmiyor.
                  </div>
                ) : commitDiff.lines.length === 0 ? (
                  <div className="px-4 py-6 text-xs text-slate-500">
                    Gösterilecek diff satırı yok.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-auto font-mono text-[11px] bg-slate-950 p-2">
                    {commitDiff.lines.map((line, idx) => {
                      let cls = "px-2 py-0.5 rounded-sm ";
                      let prefix = " ";
                      switch (line.kind) {
                        case "header":
                          cls += "text-slate-500";
                          break;
                        case "hunk":
                          cls += "text-sky-400 bg-sky-950/20";
                          break;
                        case "added":
                          cls += "text-emerald-300 bg-emerald-950/30";
                          prefix = "+";
                          break;
                        case "removed":
                          cls += "text-rose-300 bg-rose-950/30";
                          prefix = "-";
                          break;
                        case "context":
                          cls += "text-slate-400";
                          break;
                      }
                      return (
                        <div key={idx} className={`flex items-start gap-2 ${cls}`}>
                          <span className="text-slate-600 select-none w-3 shrink-0">
                            {prefix}
                          </span>
                          <span className="whitespace-pre-wrap break-all">
                            {line.content}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Commit Hash Banner */}
            <div className="text-[11px] font-mono text-slate-500 bg-slate-900/30 p-3 rounded-xl border border-slate-800/60 flex items-center justify-between">
              <span className="truncate">Tam Commit SHA: {selectedCommit.sha}</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-2">
            <GitCommit className="w-8 h-8 text-slate-600" />
            <p className="text-xs">
              {!activeRepoId
                ? "Geçmişi görmek için bir depo seçin."
                : commits.length === 0
                  ? "Bu depoda henüz commit geçmişi bulunmuyor."
                  : "Detayları görüntülemek için sol listeden bir commit seçin."}
            </p>
          </div>
        )}
      </div>

      {/* v0.2 — Son commit mesajını düzenle (kontrollü amend) */}
      {amendOpen && selectedCommit && (
        <div
          ref={amendDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Commit mesajını düzenle"
          onClick={() => !amendBusy && setAmendOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-100">
                Son commit mesajını düzenle
              </h3>
            </div>
            <p className="text-xs text-slate-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Bu işlem son commit'i değiştirir. Commit henüz push edilmediği
                için güvenlidir. Yalnızca mesaj değişir; dosya içerikleri
                etkilenmez.
              </span>
            </p>
            <textarea
              value={amendText}
              onChange={(e) => setAmendText(e.target.value)}
              rows={4}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-400 resize-y"
              aria-label="Yeni commit mesajı"
            />
            {amendError && (
              <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
                {amendError}
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setAmendOpen(false)}
                disabled={amendBusy}
                className="flex-1 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => void handleAmendSave()}
                disabled={amendBusy || !amendText.trim()}
                className="flex-1 py-1.5 rounded text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {amendBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Kaydet</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
