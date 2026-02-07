// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import MusicPlayer from "../MusicPlayer";

const TRACKS = [
  { title: "Track 1", artist: "Artist A", url: "/music/track1.mp3" },
  { title: "Track 2", artist: "Artist B", url: "/music/track2.mp3" },
];

function mockFetch(tracks = TRACKS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ json: () => Promise.resolve(tracks) })),
  );
}

function mockAudioConstructor() {
  const instances: Record<string, unknown>[] = [];
  // Must use a regular function (not arrow) so it works with `new Audio()`
  vi.stubGlobal(
    "Audio",
    vi.fn(function (this: Record<string, unknown>) {
      this.src = "";
      this.volume = 1;
      this.loop = false;
      this.play = vi.fn(() => Promise.resolve());
      this.pause = vi.fn();
      instances.push(this);
    }),
  );
  return instances;
}

describe("MusicPlayer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let audioInstances: Record<string, unknown>[];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockFetch();
    audioInstances = mockAudioConstructor();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderPlayer() {
    await act(async () => {
      root.render(<MusicPlayer />);
    });
    // Flush fetch + setState
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  describe("initial state", () => {
    it("always shows Play button on mount, even when localStorage had playing=true", async () => {
      localStorage.setItem("music-player", JSON.stringify({ playing: true, url: "/music/track1.mp3" }));

      await renderPlayer();

      expect(container.querySelector('[aria-label="Play"]')).toBeTruthy();
      expect(container.querySelector('[aria-label="Pause"]')).toBeNull();
    });

    it("shows Play button when no saved state exists", async () => {
      await renderPlayer();

      expect(container.querySelector('[aria-label="Play"]')).toBeTruthy();
      expect(container.querySelector('[aria-label="Pause"]')).toBeNull();
    });
  });

  describe("music:start event", () => {
    it("starts playback when music:start event is dispatched", async () => {
      await renderPlayer();

      await act(async () => {
        document.dispatchEvent(new CustomEvent("music:start"));
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(audioInstances[0].play).toHaveBeenCalled();
      expect(container.querySelector('[aria-label="Pause"]')).toBeTruthy();
    });

    it("does not crash if tracks have not loaded yet", async () => {
      mockFetch([]); // No tracks

      await renderPlayer();

      // Should not throw
      await act(async () => {
        document.dispatchEvent(new CustomEvent("music:start"));
        await new Promise((r) => setTimeout(r, 0));
      });

      // Button not rendered (no tracks = component returns null)
      expect(container.querySelector('[aria-label="Play"]')).toBeNull();
    });
  });

  describe("toggle play/pause", () => {
    it("clicking Play starts audio and shows Pause", async () => {
      await renderPlayer();

      const playBtn = container.querySelector('[aria-label="Play"]') as HTMLButtonElement;
      await act(async () => {
        playBtn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(audioInstances[0].play).toHaveBeenCalled();
      expect(container.querySelector('[aria-label="Pause"]')).toBeTruthy();
    });

    it("clicking Pause stops audio and shows Play", async () => {
      await renderPlayer();

      // Start playing first
      const playBtn = container.querySelector('[aria-label="Play"]') as HTMLButtonElement;
      await act(async () => {
        playBtn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      // Now pause
      const pauseBtn = container.querySelector('[aria-label="Pause"]') as HTMLButtonElement;
      await act(async () => {
        pauseBtn.click();
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(audioInstances[0].pause).toHaveBeenCalled();
      expect(container.querySelector('[aria-label="Play"]')).toBeTruthy();
    });
  });
});
