/**
 * v0.2 madde 12 — onboarding görünürlük koşulları + atla yazımı (Shell düzeyi).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import * as tauriCommands from "./lib/tauriCommands";
import {
  mockAppInfo,
  mockEnvironment,
  mockRepository,
  mockSettings,
  mockStatus,
} from "./test/fixtures";

vi.mock("./lib/tauriCommands", () => import("./test/mockTauriCommands"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriCommands.appGetEnvironment).mockResolvedValue(mockEnvironment);
  vi.mocked(tauriCommands.appGetInfo).mockResolvedValue(mockAppInfo);
  vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(mockStatus);
  // Shell.loadRepositories her depo için geçmiş de çeker; eksik mock liste
  // akışını patlatır (yakalanan TypeError → depolar boşalır → rehber kalır).
  vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue({
    commits: [],
    graph: [],
    has_more: false,
    next_offset: 0,
  });
  vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([]);
  vi.mocked(tauriCommands.settingsUpdate).mockImplementation(async (update) => ({
    ...mockSettings,
    ...update,
  }));
});

function withSettings(onboardingCompleted: boolean, repos: number) {
  vi.mocked(tauriCommands.settingsGet).mockResolvedValue({
    ...mockSettings,
    onboarding_completed: onboardingCompleted,
  });
  vi.mocked(tauriCommands.repositoryList).mockResolvedValue(
    repos === 0 ? [] : [{ ...mockRepository, pinned: false }]
  );
}

describe("Onboarding görünürlüğü (v0.2 madde 12)", () => {
  it("ayar kapalıysa VE depo yoksa rehber görünür", async () => {
    withSettings(false, 0);
    render(<App />);
    expect(await screen.findByText(/Kurulumu tamamla/)).toBeInTheDocument();
  });

  it("onboarding_completed=true ise rehber GÖRÜNMEZ", async () => {
    withSettings(true, 0);
    render(<App />);
    await screen.findByRole("navigation");
    expect(screen.queryByText(/Kurulumu tamamla/)).not.toBeInTheDocument();
  });

  it("en az bir depo varsa ayar kapalı olsa bile rehber GÖRÜNMEZ", async () => {
    withSettings(false, 1);
    render(<App />);
    // Depolar asenkron yüklendiği için rehber bir an görünüp kaybolabilir;
    // anlam taşınan şey SON durumdur: depo varken rehber kaybolmalı (yarış
    // koşusunu önlemek için anlık değil, kararlı durum doğrulanır).
    await screen.findByRole("navigation");
    await waitFor(() =>
      expect(screen.queryByText(/Kurulumu tamamla/)).not.toBeInTheDocument()
    );
  });

  it("'Şimdilik atla' ayarı kalıcı true yazar", async () => {
    withSettings(false, 0);
    render(<App />);
    const skip = await screen.findByRole("button", { name: "Şimdilik atla" });
    fireEvent.click(skip);
    await waitFor(() =>
      expect(tauriCommands.settingsUpdate).toHaveBeenCalledWith({
        onboarding_completed: true,
      })
    );
  });
});
