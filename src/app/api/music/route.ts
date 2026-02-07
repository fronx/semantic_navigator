import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { join } from "path";
import { parseFile } from "music-metadata";

interface Track {
  title: string;
  artist: string;
  url: string;
}

export async function GET(): Promise<NextResponse<Track[]>> {
  const dir = join(process.cwd(), "public", "music");

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".mp3"));
  } catch {
    return NextResponse.json([]);
  }

  const tracks = await Promise.all(
    files.map(async (filename): Promise<Track> => {
      const url = `/music/${encodeURIComponent(filename)}`;
      try {
        const { common } = await parseFile(join(dir, filename));
        return { title: common.title || filename, artist: common.artist || "", url };
      } catch {
        return { title: filename, artist: "", url };
      }
    })
  );

  // Fisher-Yates shuffle
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  }

  return NextResponse.json(tracks);
}
