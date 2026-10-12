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

// ------------------------------------------------------------------ lyrics (karaoke captions)
// the recordings sing "Boju Boju o!" twice, then "Ṣé kí n ṣí?" twice, and go round again
const LINES = [
  { yo: "Boju Boju o!", en: "Closing eyes, closing eyes!" },
  { yo: "Boju Boju o!", en: "Closing eyes, closing eyes!" },
  { yo: "Ṣé kí n ṣí?", en: "Should I open them?" },
  { yo: "Ṣé kí n ṣí?", en: "Should I open them?" },
];
/** When each sung phrase starts (seconds), measured from the recordings: the four lines, twice. */
const CUES: Record<string, number[]> = {
  [URL.male]: [0, 2.2, 4.4, 6.65, 8.7, 10.95, 13.2, 15.2],
  [URL.female]: [0, 2.45, 4.95, 7.2, 9.7, 11.95, 14.45, 16.7],
};

export function SongCaptions() {
  const phase = useGame((s) => s.group?.phase);
  const [i, setI] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "hide") { setI(null); return; }
    const id = setInterval(() => {
      const st = sound.songTime();
      const cues = st ? CUES[st.url] : null;
      if (!st || !cues) { setI(null); return; }
      let k = -1;
      for (let j = 0; j < cues.length; j++) if (st.t >= cues[j] - 0.1) k = j;
      setI(k < 0 ? null : k);
    }, 120);
    return () => clearInterval(id);
  }, [phase]);
  if (i === null) return null;
  const line = LINES[i % LINES.length];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-36 z-[35] flex justify-center px-4" data-testid="song-captions">
      <div key={i} className="anim-pop rounded-2xl bg-black/55 px-4 py-2 text-center backdrop-blur">
        <div className="text-[22px] font-black tracking-tight text-[#ffd84f] drop-shadow">🎤 {line.yo}</div>
        <div className="text-[12px] font-semibold text-white/80">{line.en}</div>
      </div>
    </div>
  );
}
