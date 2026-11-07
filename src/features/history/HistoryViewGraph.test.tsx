/**
 * v0.2 madde 6 — HistoryView grafik çizimi: render patlamaz, satır başına
 * şerit çizilir, ref rozetleri görünür.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryView } from "./HistoryView";
import * as tauriCommands from "../../lib/tauriCommands";
import type { CommitInfo, GraphRow, HistoryOutput } from "../../types/ipc";

vi.mock("../../lib/tauriCommands", () => ({
  repositoryGetHistory: vi.fn(),
  repositoryGetCommitDetails: vi.fn(),
  repositoryGetCommitDiff: vi.fn(),
  repositoryAmendMessage: vi.fn(),
}));

function commit(sha: string, parents: string[], refs: string[] = []): CommitInfo {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    message: `commit ${sha.slice(0, 4)}`,
    author_name: "Burak",
    author_email: "b@example.com",
    authored_at: "2026-11-07T10:00:00Z",
    parents,
    refs,
  };
}

const merge = commit("m".repeat(40), ["a".repeat(40), "b".repeat(40)], ["main", "tag:v1.0"]);
const a = commit("a".repeat(40), ["x".repeat(40)]);
const b = commit("b".repeat(40), ["x".repeat(40)], ["origin/feature"]);
const x = commit("x".repeat(40), []);

// M(A,B) → lane 0 acilir, B lane 1'de yurur, X'te birlesir.
const graph: GraphRow[] = [
  { lane: 0, active_lanes: [0, 1], edges: [{ from_lane: 0, to_lane: 1, kind: "branch_out" }] },
  { lane: 0, active_lanes: [0, 1], edges: [] },
  { lane: 1, active_lanes: [0, 1], edges: [{ from_lane: 1, to_lane: 0, kind: "branch_out" }] },
  { lane: 0, active_lanes: [0], edges: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  const history: HistoryOutput = {
    commits: [merge, a, b, x],
    graph,
    has_more: false,
    next_offset: 4,
  };
  vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue(history);
  vi.mocked(tauriCommands.repositoryGetCommitDetails).mockResolvedValue({
    commit: merge,
    files: [],
    additions: 0,
    deletions: 0,
  });
  vi.mocked(tauriCommands.repositoryGetCommitDiff).mockResolvedValue({
    path: "",
    truncated: false,
    binary: false,
    lines: [],
    raw_size: 0,
  });
});

describe("HistoryView gecmis grafigi (v0.2)", () => {
  it("grafikli gecmi patlamadan cizer; her satirda grafik seridi var", async () => {
    render(<HistoryView repoId="repo-1" />);
    await screen.findAllByText("commit mmmm");
    const strips = Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter(
      (el) => el.querySelector("svg")
    );
    expect(strips.length).toBe(4);
  });

  it("ref rozetleri listeye ve detaya düser (dal/uzak/tag)", async () => {
    render(<HistoryView repoId="repo-1" />);
    await screen.findAllByText("commit mmmm");
    // "main" liste + detayda iki yerde; tag "v1.0" olarak soyulur.
    expect(await screen.findAllByText("main")).not.toHaveLength(0);
    expect(screen.getAllByText("v1.0").length).toBeGreaterThan(0);
    expect(await screen.findByText("origin/feature")).toBeInTheDocument();
  });

  it("detay panelinde ebeveyn SHA'lari tiklanabilir dügmeler", async () => {
    render(<HistoryView repoId="repo-1" />);
    await screen.findAllByText("commit mmmm");
    const parentButtons = await screen.findAllByRole("button", { name: "aaaaaaa" });
    expect(parentButtons.length).toBeGreaterThan(0);
    expect(parentButtons[0]).toHaveAttribute("title", "Bu commite git");
  });
});
