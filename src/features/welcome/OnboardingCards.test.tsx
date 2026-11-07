/**
 * v0.2 madde 12 — OnboardingCards: adım durumları ve eylemler.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnboardingCards } from "./OnboardingCards";
import * as tauriCommands from "../../lib/tauriCommands";

vi.mock("../../lib/tauriCommands", () => ({
  githubListAccounts: vi.fn(),
}));

function renderCards(overrides: Partial<Parameters<typeof OnboardingCards>[0]> = {}) {
  const props = {
    hasRepositories: false,
    onConnectGitHub: vi.fn(),
    onAddRepository: vi.fn(),
    onStartFirstTask: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<OnboardingCards {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([]);
});

describe("OnboardingCards", () => {
  it("GitHub hesabı varsa 1. adım tamamlandı sayılır", async () => {
    vi.mocked(tauriCommands.githubListAccounts).mockResolvedValue([
      { id: "acc-1" } as never,
    ]);
    renderCards();
    expect(await screen.findByTitle("Tamamlandı")).toBeInTheDocument();
  });

  it("hesap yoksa 1. adım numara gösterir; buton GitHub sekmesine yönlendirir", async () => {
    const props = renderCards();
    await waitFor(() => expect(tauriCommands.githubListAccounts).toHaveBeenCalled());
    expect(screen.queryByTitle("Tamamlandı")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GitHub sekmesine git" }));
    expect(props.onConnectGitHub).toHaveBeenCalled();
  });

  it("depo yokken 3. adım butonu devre dışı; depo varken dismiss + yönlendirme yapar", () => {
    const props = renderCards({ hasRepositories: true });
    const start = screen.getByRole("button", { name: /Değişiklikler'e git/ });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(props.onDismiss).toHaveBeenCalled();
    expect(props.onStartFirstTask).toHaveBeenCalled();
  });

  it("depo yokken 3. adım butonu devre dışıdır", () => {
    renderCards({ hasRepositories: false });
    expect(screen.getByRole("button", { name: /Değişiklikler'e git/ })).toBeDisabled();
  });

  it("'Şimdilik atla' onDismiss çağırır", () => {
    const props = renderCards();
    fireEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    expect(props.onDismiss).toHaveBeenCalled();
  });
});
