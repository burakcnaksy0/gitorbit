/**
 * v0.2 madde 10 — Depolar listesi: sabitleme sırası, filtre, toggle.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RepositoryListView } from "./RepositoryListView";
import type { RepositorySummary } from "../../types/navigation";

function repo(
  name: string,
  overrides: Partial<RepositorySummary> = {}
): RepositorySummary {
  return {
    id: `id-${name}`,
    name,
    path: `/work/${name}`,
    currentBranch: "main",
    ahead: 0,
    behind: 0,
    stagedCount: 0,
    unstagedCount: 0,
    lastCommitMessage: null,
    lastCommitDate: null,
    pinned: false,
    ...overrides,
  };
}

function renderList(overrides: Partial<Parameters<typeof RepositoryListView>[0]> = {}) {
  const props = {
    repositories: [repo("alpha"), repo("beta", { pinned: true }), repo("gamma")],
    currentRepo: null,
    onSelectRepo: vi.fn(),
    onAddRepository: vi.fn(),
    onCloneRepository: vi.fn(),
    onRemoveRepository: vi.fn(),
    onRelinkRepository: vi.fn(),
    onOpenInFileManager: vi.fn(),
    onTogglePin: vi.fn(),
    ...overrides,
  };
  render(<RepositoryListView {...props} />);
  return props;
}

describe("RepositoryListView sabitleme (v0.2 madde 10)", () => {
  it("sabitlenen depo listede en üstte görünür", () => {
    renderList();
    const cards = screen.getAllByRole("button", { name: /\/work\// });
    expect(cards[0]).toHaveTextContent("beta");
  });

  it("isim filtresi kartları ve sabitleme sırasını birlikte çalışır", () => {
    renderList();
    fireEvent.change(screen.getByPlaceholderText(/İsim, yol veya branch ara/), {
      target: { value: "a" },
    });
    const cards = screen.getAllByRole("button", { name: /\/work\// });
    // "a" ile eşleşenler: alpha, beta (sabit → üstte), gamma
    expect(cards.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("beta")])
    );
    expect(cards[0]).toHaveTextContent("beta");
    expect(cards).toHaveLength(3);
  });

  it("pin butonu onTogglePin'i ilgili depoyla çağırır", () => {
    const props = renderList();
    fireEvent.click(screen.getByRole("button", { name: "alpha deposunu sabitle" }));
    expect(props.onTogglePin).toHaveBeenCalledWith(
      expect.objectContaining({ name: "alpha" })
    );
  });

  it("sabitlenmiş kart rozet + 'sabitlemeyi kaldır' etiketi taşır", () => {
    renderList();
    expect(screen.getByText("Sabit")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "beta deposunu sabitlemeyi kaldır" })
    );
  });

  it("onTogglePin verilmemişse pin butonu render edilmez (geriye dönük uyum)", () => {
    renderList({ onTogglePin: undefined });
    expect(screen.queryByRole("button", { name: /sabitle/ })).not.toBeInTheDocument();
  });
});
