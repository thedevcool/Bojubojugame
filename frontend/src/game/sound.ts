/**
 * Procedural game audio with Tone.js — every sound is synthesised, so there
 * is nothing to download and nothing to license. Tone is lazy-loaded on the
 * first user gesture (browsers block audio before that anyway), and built a few pieces at a time:
 * building every synth in one go froze a low-end phone for ~3.5 s on its first tap.
 * The one recording is the Boju Boju song (public/audio), sung while Boju's eyes are closed.
 */
import type * as ToneNS from "tone";

type ToneT = typeof ToneNS;
export type Sfx = "click" | "pop" | "coin" | "error" | "gotcha" | "caught" | "whistle" | "tick" | "dice" | "horn" | "door" | "win";
type Scene = "off" | "hub" | "arena" | "tension";

const PREF = "boju.audio";
const breathe = () => new Promise<void>((r) => setTimeout(r, 0)); // let taps and frames through

class SoundEngine {
  private T: ToneT | null = null;
  private loading: Promise<void> | null = null;
  private master!: ToneNS.Gain;
  private sfxBus!: ToneNS.Gain;
  private musicBus!: ToneNS.Gain;
  private ambBus!: ToneNS.Gain;
  private songBus!: ToneNS.Gain;
  private song: { url: string; player: ToneNS.Player; at?: number } | null = null;
  private songWanted: string | null = null;
  private s: Record<string, ToneNS.ToneAudioNode & { triggerAttackRelease?: unknown }> = {};
  private ambience: ToneNS.Noise | null = null;
  private ambFilter: ToneNS.Filter | null = null;
  private scene: Scene = "off";
  private loops: { dispose(): unknown }[] = [];
  private musicReady = false;
  private lastStep = 0;
  private lastBeat = 0;
  prefs = { sound: true, music: true };

  constructor() {
    if (typeof window !== "undefined") {
      try { Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREF) ?? "{}")); } catch { /* ignore */ }
    }
  }

  get ready(): boolean { return this.T !== null; }

  /** Call from any user gesture; safe to call many times. */
  unlock(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const T = await import("tone");
      await T.start();
      T.getContext().lookAhead = 0.03;
      this.master = new T.Gain(this.paused ? 0 : 0.9).toDestination();
      const comp = new T.Compressor(-18, 3).connect(this.master);
      this.sfxBus = new T.Gain(this.prefs.sound ? 0.9 : 0).connect(comp);
      this.musicBus = new T.Gain(this.prefs.music ? 0.32 : 0).connect(comp);
      this.ambBus = new T.Gain(this.prefs.sound ? 0.5 : 0).connect(comp);
      this.songBus = new T.Gain(this.prefs.sound ? 1 : 0).connect(this.master);
      // a short echo instead of Freeverb (its 8 comb filters alone took ~2 s to build on a slow phone)
      const space = new T.FeedbackDelay({ delayTime: 0.09, feedback: 0.18, wet: 0.12 }).connect(this.sfxBus);
      this.s = {
        blip: new T.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.05 } }).connect(this.sfxBus),
        tri: new T.PolySynth(T.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.15, sustain: 0.1, release: 0.2 } }).connect(space),
        sq: new T.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.05 } }).connect(this.sfxBus),
      } as typeof this.s;
      this.T = T; // sound effects work from here
      await breathe();
      Object.assign(this.s, {
        wood: new T.MembraneSynth({ pitchDecay: 0.008, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(this.sfxBus),
        thump: new T.MembraneSynth({ pitchDecay: 0.05, octaves: 3, envelope: { attack: 0.002, decay: 0.25, sustain: 0 } }).connect(this.sfxBus),
        step: new T.NoiseSynth({ noise: { type: "brown" }, envelope: { attack: 0.001, decay: 0.06, sustain: 0 } }).connect(new T.Filter(900, "lowpass").connect(this.sfxBus)),
        rattle: new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } }).connect(new T.Filter(3000, "bandpass").connect(this.sfxBus)),
      });
      await breathe();
      this.s.whistle = new T.FMSynth({ harmonicity: 1, modulationIndex: 2, oscillator: { type: "sine" }, envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.08 } }).connect(this.sfxBus);
      this.s.horn = new T.PolySynth(T.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.01, decay: 0.05, sustain: 0.7, release: 0.06 } }).connect(new T.Filter(1400, "lowpass").connect(this.ambBus));
      await breathe();
      // music
      Object.assign(this.s, {
        kick: new T.MembraneSynth({ pitchDecay: 0.03, octaves: 5, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(this.musicBus),
        shaker: new T.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.04, sustain: 0 } }).connect(new T.Filter(7000, "highpass").connect(this.musicBus)),
        clave: new T.MembraneSynth({ pitchDecay: 0.004, octaves: 1.5, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(this.musicBus),
      });
      await breathe();
      Object.assign(this.s, {
        bass: new T.MonoSynth({ oscillator: { type: "fmsquare" }, filter: { Q: 2, type: "lowpass" }, filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2.5 }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.2 } }).connect(this.musicBus),
        guitar: new T.PluckSynth({ attackNoise: 1, dampening: 3200, resonance: 0.92 }).connect(new T.FeedbackDelay("8n.", 0.25).connect(this.musicBus)),
      });
      await breathe();
      this.ambFilter = new T.Filter(500, "lowpass").connect(this.ambBus);
      this.ambience = new T.Noise("brown").connect(this.ambFilter);
      this.ambience.volume.value = -22;
      T.getTransport().bpm.value = 104;
      this.musicReady = true;
      const want = this.scene;
      this.scene = "off";
      this.setScene(want);
    })().catch(() => { this.loading = null; });
    return this.loading;
  }

  private paused = false;
  /** LagosLife pauses us (phone in the background, or its pay sheet is open): go quiet until resume. */
  pause(on: boolean): void {
    this.paused = on;
    if (this.T) this.master.gain.rampTo(on ? 0 : 0.9, 0.15);
  }

  setPrefs(p: Partial<typeof this.prefs>): void {
    Object.assign(this.prefs, p);
    try { localStorage.setItem(PREF, JSON.stringify(this.prefs)); } catch { /* ignore */ }
    if (!this.T) return;
    this.sfxBus.gain.rampTo(this.prefs.sound ? 0.9 : 0, 0.2);
    this.ambBus.gain.rampTo(this.prefs.sound ? 0.5 : 0, 0.2);
    this.musicBus.gain.rampTo(this.prefs.music ? (this.song ? 0.06 : 0.32) : 0, 0.3);
    this.songBus.gain.rampTo(this.prefs.sound ? 1 : 0, 0.2);
  }

  /** The Boju Boju song: loops while Boju counts (null = fade it out). Background music dips under it. */
  async playSong(url: string | null): Promise<void> {
    this.songWanted = url;
    if (url) await this.unlock();
    const T = this.T;
    if (!T) return;
    if (this.song && this.song.url !== url) {
      const old = this.song.player;
      this.song = null;
      try { old.stop(); } catch { /* not started */ }
      setTimeout(() => old.dispose(), 1500);
      this.musicBus.gain.rampTo(this.prefs.music ? 0.32 : 0, 1.2);
    }
    if (!url || this.song) return;
    const player = new T.Player({ loop: true, fadeIn: 0.05, fadeOut: 0.7 }).connect(this.songBus);
    this.song = { url, player };
    try {
      await player.load(url);
    } catch {
      if (this.song?.player === player) this.song = null;
      player.dispose();
      return;
    }
    if (this.songWanted !== url || this.song?.player !== player) { player.dispose(); return; } // phase already moved on
    this.musicBus.gain.rampTo(this.prefs.music ? 0.06 : 0, 0.4);
    player.start();
    this.song.at = T.now();
  }

  /** Seconds into the current loop of the song (for the lyric captions), or null when it isn't playing. */
  songTime(): { url: string; t: number } | null {
    const s = this.song, T = this.T;
    if (!s || s.at === undefined || !T || !s.player.loaded) return null;
    const len = s.player.buffer.duration || 1;
    return { url: s.url, t: (T.now() - s.at) % len };
  }

  private trig(name: string, note: string | number | string[], dur: ToneNS.Unit.Time, time?: number, vel = 1): void {
    const n = this.s[name] as unknown as { triggerAttackRelease: (n: unknown, d: unknown, t?: unknown, v?: unknown) => void };
    try { n.triggerAttackRelease(note, dur, time, vel); } catch { /* overlapping trigger */ }
  }

  play(sfx: Sfx, volume = 1): void {
    const T = this.T;
    if (!T || !this.prefs.sound) return;
    const now = T.now();
    switch (sfx) {
      case "click": this.trig("blip", "C6", 0.04, now, 0.5 * volume); break;
      case "pop": this.trig("blip", "G5", 0.05, now, 0.6 * volume); this.trig("blip", "C6", 0.05, now + 0.05, 0.5 * volume); break;
      case "coin": this.trig("sq", "B5", 0.06, now, 0.35); this.trig("sq", "E6", 0.18, now + 0.07, 0.35); break;
      case "error": this.trig("sq", "C3", 0.12, now, 0.4); this.trig("sq", "A2", 0.16, now + 0.1, 0.4); break;
      case "gotcha": ["C5", "E5", "G5", "C6"].forEach((n, i) => this.trig("tri", n, 0.12, now + i * 0.07, 0.7)); break;
      case "caught": ["G4", "Eb4", "C4"].forEach((n, i) => this.trig("tri", n, 0.2, now + i * 0.13, 0.7)); break;
      case "win": ["C5", "E5", "G5", "C6", "E6"].forEach((n, i) => this.trig("tri", n, 0.18, now + i * 0.09, 0.7)); break;
      case "whistle": this.trig("whistle", "E6", 0.18, now, 0.5); this.trig("whistle", "E6", 0.45, now + 0.26, 0.5); break;
      case "tick": this.trig("wood", "G5", 0.05, now, 0.7); break;
      case "door": this.trig("thump", "A2", 0.1, now, 0.5); break;
      case "dice": for (let i = 0; i < 7; i++) this.trig("rattle", "", 0.03, now + i * 0.06 + Math.random() * 0.02, 0.6); break;
      case "horn": this.trig("horn", ["A4", "C#5"], 0.28, now, 0.35 * volume); this.trig("horn", ["A4", "C#5"], 0.18, now + 0.36, 0.35 * volume); break;
    }
  }

  /** Called every frame by the local player; plays footsteps at gait rate. */
  footsteps(speed: number, crouch: boolean): void {
    if (!this.T || !this.prefs.sound || speed < 0.3) return;
    const now = this.T.now();
    const interval = crouch ? 0.6 : Math.max(0.24, 0.62 - speed * 0.06);
    if (now - this.lastStep < interval) return;
    this.lastStep = now;
    this.trig("step", "", 0.05, now, crouch ? 0.15 : Math.min(0.6, 0.25 + speed * 0.06));
  }

  /** Heartbeat when Boju is close to a hider: ``closeness`` 0..1. */
  heartbeat(closeness: number): void {
    if (!this.T || !this.prefs.sound || closeness <= 0) return;
    const now = this.T.now();
    const interval = 1.1 - closeness * 0.65;
    if (now - this.lastBeat < interval) return;
    this.lastBeat = now;
    this.trig("thump", "C1", 0.12, now, 0.4 + closeness * 0.5);
    this.trig("thump", "C1", 0.1, now + 0.16, 0.3 + closeness * 0.4);
  }

  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    const T = this.T;
    if (!T || !this.musicReady) return; // applied once the music is built
    this.loops.forEach((l) => l.dispose());
    this.loops = [];
    const tr = T.getTransport();
    if (this.ambience && this.ambFilter) {
      if (scene === "hub") { this.ambFilter.frequency.rampTo(520, 1); this.ambience.volume.rampTo(-20, 1); if (this.ambience.state !== "started") this.ambience.start(); }
      else if (scene === "arena" || scene === "tension") { this.ambFilter.frequency.rampTo(260, 1); this.ambience.volume.rampTo(-30, 1); if (this.ambience.state !== "started") this.ambience.start(); }
      else this.ambience.stop();
    }
    if (scene === "off") { tr.stop(); return; }
    if (scene === "tension") {
      tr.bpm.rampTo(120, 2);
      this.loops.push(new T.Loop((t) => this.trig("kick", "C1", "16n", t, 0.6), "4n").start(0));
      this.loops.push(new T.Loop((t) => this.trig("shaker", "", "32n", t, 0.25), "8n").start("8n"));
      this.loops.push(new T.Sequence((t, n) => n && this.trig("bass", n, "8n", t, 0.6), ["A1", null, "A1", null, "C2", null, "A1", "G1"], "8n").start(0));
    } else {
      tr.bpm.rampTo(104, 2);
      // Afrobeat-flavoured groove: four-on-floor-ish kick, 16th shakers, 3-2 clave, bass + guitar riff
      this.loops.push(new T.Sequence((t, v) => v && this.trig("kick", "C1", "8n", t, v as number), [0.9, null, null, 0.5, 0.8, null, 0.4, null], "8n").start(0));
      this.loops.push(new T.Loop((t) => this.trig("shaker", "", "32n", t, 0.12 + Math.random() * 0.12), "16n").start(0));
      this.loops.push(new T.Sequence((t, v) => v && this.trig("clave", "A5", "32n", t, 0.45), [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0], "16n").start(0));
      this.loops.push(new T.Sequence((t, n) => n && this.trig("bass", n as string, "8n", t, 0.7), ["A1", null, "A1", "C2", null, "D2", "E2", null, "G1", null, "G1", "A1", null, "C2", "D2", null], "8n").start(0));
      this.loops.push(new T.Sequence((t, n) => n && this.trig("guitar", n as string, "16n", t, 0.5), [null, "E4", null, "A4", null, "C5", "A4", null, null, "D5", null, "C5", "A4", null, "G4", null], "16n").start("1m"));
      if (scene === "hub") this.loops.push(new T.Loop(() => Math.random() < 0.35 && this.play("horn", 0.6 + Math.random() * 0.4), "2m").start("2m"));
    }
    if (tr.state !== "started") tr.start("+0.05");
  }
}

export const sound = new SoundEngine();
