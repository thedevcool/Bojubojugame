"use client";

import { BOTTOMS, SKIN, TOPS } from "@/game/palette";

/** [skin, shirt, bottoms, body, hair]: older 3-number looks read as male with the first hairstyle. */
export const fullAvatar = (av: number[]): number[] => [av[0] ?? 0, av[1] ?? 0, av[2] ?? 0, av[3] ?? 0, av[4] ?? 0];

const HAIR = {
  male: ["Low cut", "Afro", "High-top", "Face cap"],
  female: ["Braids", "Afro puff", "Gele", "Bun"],
};

/** Pick a look: body (male / female), hairstyle, skin, ankara shirt and trousers or wrapper. */
export default function AvatarEditor({ av, onChange }: { av: number[]; onChange: (av: number[]) => void }) {
  const v = fullAvatar(av);
  const female = v[3] === 1;
  const set = (idx: number, val: number) => onChange(v.map((x, j) => (j === idx ? val : x)));
  const swatch = (palette: string[], idx: number) => (
    <div className="flex flex-wrap gap-1.5">
      {palette.map((c, i) => (
        <button type="button" key={c} aria-label={`colour ${i + 1}`} onClick={() => set(idx, i)}
          className={`h-8 w-8 rounded-full border-2 transition-transform duration-300 [transition-timing-function:var(--ease-spring)] ${v[idx] === i ? "scale-125 border-white" : "border-transparent"}`} style={{ background: c }} />
      ))}
    </div>
  );
  return (
    <div className="space-y-2 text-sm font-bold">
      <div className="segmented" role="radiogroup" aria-label="Body">
        <button type="button" data-on={!female} onClick={() => set(3, 0)}>👨🏾 Male</button>
        <button type="button" data-on={female} onClick={() => set(3, 1)}>👩🏾 Female</button>
      </div>
      <div>Hair
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(female ? HAIR.female : HAIR.male).map((name, i) => (
            <button type="button" key={name} onClick={() => set(4, i)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${v[4] === i ? "bg-[var(--accent)] text-white" : "bg-white/10"}`}>{name}</button>
          ))}
        </div>
      </div>
      <div>Skin {swatch(SKIN, 0)}</div>
      <div>{female ? "Ankara top" : "Ankara shirt"} {swatch(TOPS, 1)}</div>
      <div>{female ? "Wrapper" : "Trousers"} {swatch(BOTTOMS, 2)}</div>
    </div>
  );
}
