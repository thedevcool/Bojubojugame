"use client";

import { useEffect, useState } from "react";
import { sound } from "@/game/sound";
import { useGame } from "@/lib/store";

/**
 * The Boju Boju song, sung while Boju's eyes are closed (the hide phase), in a male or a female voice.
 * Everyone in the game hears it; it loops until Boju opens their eyes, then fades out.
 */
export type SongVoice = "auto" | "male" | "female" | "off";
const KEY = "boju.songVoice";
const URL = { male: "/audio/boju-song-male.mp3", female: "/audio/boju-song-female.mp3" } as const;

export function getSongVoice(): SongVoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "male" || v === "female" || v === "off" ? v : "auto";
  } catch { return "auto"; }
}

export function setSongVoice(v: SongVoice): void {
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("boju-song-voice"));
}

export function BojuSong() {
  const phase = useGame((s) => s.group?.phase);
  const round = useGame((s) => s.group?.round?.no ?? 0);
  const [voice, setVoice] = useState<SongVoice>("auto");
  useEffect(() => {
    const sync = () => setVoice(getSongVoice());
    sync();
    window.addEventListener("boju-song-voice", sync);
    return () => window.removeEventListener("boju-song-voice", sync);
  }, []);
  useEffect(() => {
    // "auto": male and female take turns, round by round (everyone in the game hears the same one)
    const v = voice === "auto" ? (round % 2 === 1 ? "male" : "female") : voice;
    void sound.playSong(phase === "hide" && v !== "off" ? URL[v] : null);
  }, [phase, round, voice]);
  useEffect(() => () => { void sound.playSong(null); }, []);
  return null;
}
