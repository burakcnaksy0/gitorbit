import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LoadingState } from "./LoadingState";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Badge } from "./Badge";

describe("Common Components (Loading, Empty, Error, Badge)", () => {
  it("renders LoadingState with accessible status role", () => {
    render(
      <LoadingState message="Depolar taranıyor..." description="Lütfen bekleyin." />
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Depolar taranıyor...")).toBeInTheDocument();
    expect(screen.getByText("Lütfen bekleyin.")).toBeInTheDocument();
  });

  it("renders EmptyState and triggers action button", () => {
    const handleAction = vi.fn();
    render(
      <EmptyState
        title="Henüz repo yok"
        description="Başlamak için bir repo ekleyin."
        actionLabel="Repo Ekle"
        onAction={handleAction}
      />
    );
    expect(screen.getByText("Henüz repo yok")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Repo Ekle" });
    fireEvent.click(btn);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it("renders ErrorState with alert role and error text", () => {
    const handleRetry = vi.fn();
    render(
      <ErrorState
        title="Git Hatası"
        error="fatal: not a git repository"
        actionLabel="Tekrar Dene"
        onRetry={handleRetry}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Git Hatası")).toBeInTheDocument();
    expect(screen.getByText("fatal: not a git repository")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: /Tekrar Dene/i });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it("renders Badge with various variants", () => {
    render(<Badge variant="emerald">Aktif</Badge>);
    expect(screen.getByText("Aktif")).toBeInTheDocument();
  });
});
