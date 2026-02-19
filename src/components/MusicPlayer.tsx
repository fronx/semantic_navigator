"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VolumeSlider } from "./VolumeSlider";

interface Track {
  title: string;
  artist: string;
  url: string;
}

const DEFAULT_VOLUME = 0.2;
const LS_KEY = "music-player";

function loadSaved(): { url?: string; volume?: number; playing?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function MusicPlayer({ horizontal = false }: { horizontal?: boolean }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => loadSaved().playing ?? false);
  const [volume, setVolume] = useState(() => loadSaved().volume ?? DEFAULT_VOLUME);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;

  // Fetch track list, restore last track
  useEffect(() => {
    fetch("/api/music")
      .then((r) => r.json())
      .then((data: Track[]) => {
        if (data.length === 0) return;
        const savedIdx = data.findIndex((t) => t.url === loadSaved().url);
        if (savedIdx > 0) {
          // Move saved track to front so it plays first
          data.unshift(data.splice(savedIdx, 1)[0]);
        }
        setTracks(data);
      })
      .catch(() => {});
  }, []);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.volume = DEFAULT_VOLUME;
    audio.loop = true;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track change
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || tracks.length === 0) return;
    audio.src = tracks[index].url;
    if (playing) audio.play().catch(() => {});
  }, [index, tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for explicit start event (dispatched by StartOverlay)
  useEffect(() => {
    const handler = () => {
      const audio = audioRef.current;
      if (!audio || !tracksRef.current.length) return;
      audio.play().then(() => setPlaying(true)).catch(() => {});
    };
    document.addEventListener("music:start", handler);
    return () => document.removeEventListener("music:start", handler);
  }, []);

  // Volume sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Persist current track, volume, and play state
  useEffect(() => {
    if (tracks[index]) {
      localStorage.setItem(LS_KEY, JSON.stringify({ url: tracks[index].url, volume, playing }));
    }
  }, [index, tracks, volume, playing]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !tracks.length) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [playing, tracks.length]);

  const prev = useCallback(() => {
    if (tracks.length > 0) setIndex((i) => (i - 1 + tracks.length) % tracks.length);
  }, [tracks.length]);

  const skip = useCallback(() => {
    if (tracks.length > 0) setIndex((i) => (i + 1) % tracks.length);
  }, [tracks.length]);

  const track = tracks[index];
  if (!track) return null;

  if (horizontal) {
    return (
      <div className="music-player-bar">
        <div className="music-player-track-title" title={track.title}>
          {track.title}
        </div>
        <div className="music-player-controls">
          <button className="music-player-btn" onClick={prev} aria-label="Previous track">
            <span className="music-icon-prev" />
          </button>
          <button
            className="music-player-btn"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            <span className={playing ? "music-icon-pause" : "music-icon-play"} />
          </button>
          <button className="music-player-btn" onClick={skip} aria-label="Next track">
            <span className="music-icon-skip" />
          </button>
        </div>
        <VolumeSlider volume={volume} onChange={setVolume} horizontal />
      </div>
    );
  }

  return (
    <div className="music-player">
      <VolumeSlider volume={volume} onChange={setVolume} />
      <div className="music-player-controls">
        <button className="music-player-btn" onClick={prev} aria-label="Previous track">
          <span className="music-icon-prev" />
        </button>
        <button
          className="music-player-btn"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          <span className={playing ? "music-icon-pause" : "music-icon-play"} />
        </button>
        <button className="music-player-btn" onClick={skip} aria-label="Next track">
          <span className="music-icon-skip" />
        </button>
      </div>
      <div className="music-player-track-info">
        {track.title}{track.artist ? ` \u2014 ${track.artist}` : ""}
      </div>
    </div>
  );
}
