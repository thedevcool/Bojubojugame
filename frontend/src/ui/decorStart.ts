import { local } from "@/game/state";
import { sound } from "@/game/sound";
import { getFurniture, loadAccount } from "@/lib/api";
import { useGame } from "@/lib/store";

/** Enter decorate mode (kept apart from the 3D-heavy overlay so the HUD stays light). */
export async function startDecorating(): Promise<void> {
  const st = useGame.getState();
  const home = st.home;
  if (!home || local.insideHome !== home.id) {
    st.toast("Go inside your house to decorate 🏠", "error");
    return;
  }
  const acc = loadAccount();
  if (!acc) return;
  try {
    const { items } = await getFurniture(acc);
    st.set({ decor: { home: home.id, items, sel: null }, phoneOpen: false, phoneApp: null, aerial: false });
    local.path = [];
    sound.play("pop");
  } catch (e) {
    st.toast((e as Error).message, "error");
  }
}

