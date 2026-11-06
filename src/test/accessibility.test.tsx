import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../App";
import * as tauriCommands from "../lib/tauriCommands";
import {
  mockAppInfo,
  mockEnvironment,
  mockRepository,
  mockSettings,
  mockStatus,
} from "./fixtures";

vi.mock("../lib/tauriCommands", () => import("./mockTauriCommands"));

describe("GitOrbit — Accessibility & Keyboard Navigation (a11y)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriCommands.appGetEnvironment).mockResolvedValue(mockEnvironment);
    vi.mocked(tauriCommands.appGetInfo).mockResolvedValue(mockAppInfo);
    vi.mocked(tauriCommands.settingsGet).mockResolvedValue(mockSettings);
    vi.mocked(tauriCommands.repositoryList).mockResolvedValue([mockRepository]);
    vi.mocked(tauriCommands.repositoryGetStatus).mockResolvedValue(mockStatus);
    vi.mocked(tauriCommands.repositoryGetHistory).mockResolvedValue({
      commits: [],
      has_more: false,
      next_offset: 0,
    });
    vi.mocked(tauriCommands.repositoryListRemotes).mockResolvedValue([]);
    vi.mocked(tauriCommands.repositoryGetOperationState).mockResolvedValue("normal");
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([]);
  });

  it("opens the search notice and closes it with Escape or the close button", async () => {
    render(<App />);

    const searchBtn = screen
      .getByText(/Depolarda veya komutlarda ara/i)
      .closest("button")!;
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Global Arama" })).toBeInTheDocument();
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Global Arama" })
      ).not.toBeInTheDocument();
    });
  });

  it("ensures all navigation landmarks and controls have accessible labels and roles", () => {
    render(<App />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toHaveAttribute(
      "aria-label",
      "Ana Gezinme"
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();

    const themeBtn = screen.getByTitle(/Açık temaya geç|Karanlık temaya geç|Tema/i);
    expect(themeBtn).toBeInTheDocument();

    const collapseBtn = screen.getByRole("button", { name: /Menüyü Daralt/i });
    expect(collapseBtn).toBeInTheDocument();
  });

  it("conveys status information with semantic text alongside color indicators", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText("main")[0]).toBeInTheDocument();
      expect(screen.getByText("Git 2.43.0")).toBeInTheDocument();
      // Version badge exists in both TopBar and StatusBar (responsive design).
      expect(screen.getAllByText("v0.1.0").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/1 staged/)).toBeInTheDocument();
    });
  });
});
