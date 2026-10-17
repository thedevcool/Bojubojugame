"""Builds Boju Boju's realistic player characters (one .glb per body) with Blender, from MakeHuman's CC0 human.

Run (Blender as a Python module, CPU only, no GPU needed):
    python -m venv .venv && .venv/bin/pip install bpy==5.2.2 numpy
    .venv/bin/python tools/characters/build_characters.py [--render out_dir]

What it does, per body (male, female):
1. MakeHuman's base human (hm08) shaped with its own CC0 targets: young adult, West African, the body's muscle,
   weight, height and proportions (MakeHuman's macro maths: ethnicity x gender x age x muscle x weight).
2. MakeHuman's default skeleton, cut down to the 50-odd bones a game needs (face, toe and extra finger bones fold
   into their parents) with MakeHuman's own skin weights.
3. Clothes, hair and shoes grown from MakeHuman's helper meshes and the body itself, so they fit and bend with it.
4. Detail baked from the full body into 1K maps (colour, normal with pores, packed AO/roughness/metal), then the
   mesh is cut down (about 9k triangles for players; 2k for the far LOD).
5. Exported as one binary glTF with its skeleton and animation clips.

Sources (downloaded once into tools/characters/.cache): MakeHuman base mesh, skeleton and weights from
github.com/makehumancommunity/makehuman, targets from the makehuman package on PyPI. All CC0.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
import zipfile
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = HERE / ".cache"
OUT = ROOT / "frontend/public/characters"
MH_RAW = "https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/"

BODIES = {
    "male": {"gender": 1.0, "muscle": 0.62, "weight": 0.52, "height": 0.5, "proportions": 0.6, "tall": 1.76},
    "female": {"gender": 0.0, "muscle": 0.5, "weight": 0.62, "height": 0.5, "proportions": 0.6, "tall": 1.64},
    # Baba Boju: about 65, grey hair and beard, his face cap in his favourite ankara
    "elder": {"gender": 1.0, "age": 0.81, "muscle": 0.42, "weight": 0.6, "height": 0.45, "proportions": 0.5, "tall": 1.72},
}
ETHNIC = {"african": 1.0, "asian": 0.0, "caucasian": 0.0}

# ---------------------------------------------------------------------------------------------- assets


def fetch(rel: str) -> Path:
    p = CACHE / rel
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(MH_RAW + rel, timeout=120) as r:
            p.write_bytes(r.read())
    return p


def targets() -> np.lib.npyio.NpzFile:
    p = CACHE / "targets.npz"
    if not p.exists():
        whl = CACHE / "makehuman.whl"
        if not whl.exists():
            CACHE.mkdir(parents=True, exist_ok=True)
            idx = json.loads(urllib.request.urlopen("https://pypi.org/pypi/makehuman/1.3.2/json", timeout=60).read())
            url = next(u["url"] for u in idx["urls"] if u["filename"].endswith(".whl"))
            whl.write_bytes(urllib.request.urlopen(url, timeout=300).read())
        with zipfile.ZipFile(whl) as z:
            p.write_bytes(z.read("makehuman/data/targets.npz"))
    return np.load(p, allow_pickle=True)


def read_obj(path: Path) -> dict:
    v, vt, faces = [], [], []
    group = ""
    for line in path.read_text("utf-8").splitlines():
        if line.startswith("v "):
            v.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            vt.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "):
            group = line.split()[1]
        elif line.startswith("f "):
            idx = [p.split("/") for p in line.split()[1:]]
            faces.append((group, [int(a[0]) - 1 for a in idx], [int(a[1]) - 1 for a in idx]))
    return {"v": np.array(v), "vt": np.array(vt), "faces": faces}


# ---------------------------------------------------------------------------------------------- shape


def _pair(val: float, lo: str, mid: str, hi: str) -> dict[str, float]:
    """MakeHuman's three-way slider: 0 -> lo, 0.5 -> mid, 1 -> hi."""
    if val < 0.5:
        return {lo: (0.5 - val) * 2, mid: val * 2}
    return {mid: (1 - val) * 2, hi: (val - 0.5) * 2}


def shaped(base: np.ndarray, t: np.lib.npyio.NpzFile, b: dict) -> np.ndarray:
    v = base.copy()

    def add(name: str, w: float) -> None:
        if w <= 1e-6:
            return
        key = f"targets/macrodetails/{name}"
        if f"{key}.index" not in t:
            print("missing target", name, file=sys.stderr)
            return
        v[t[f"{key}.index"]] += t[f"{key}.vector"].astype(np.float64) * 1e-3 * w

    gender = {"female": 1 - b["gender"], "male": b["gender"]}
    av = b.get("age", 0.5)  # MakeHuman's age slider: 0.5 = 25 years, 1 = 90
    age = {"young": 1.0} if av <= 0.5 else {"young": (1 - av) * 2, "old": (av - 0.5) * 2}
    muscle = _pair(b["muscle"], "minmuscle", "averagemuscle", "maxmuscle")
    weight = _pair(b["weight"], "minweight", "averageweight", "maxweight")
    for race, rw in ETHNIC.items():
        for g, gw in gender.items():
            for a, aw in age.items():
                add(f"{race}-{g}-{a}", rw * gw * aw)
    for g, gw in gender.items():
        for a, aw in age.items():
            for m, mw in muscle.items():
                for w, ww in weight.items():
                    add(f"universal-{g}-{a}-{m}-{w}", gw * aw * mw * ww)
                    hv = b["height"]
                    hk, hw = ("maxheight", (hv - 0.5) * 2) if hv >= 0.5 else ("minheight", (0.5 - hv) * 2)
                    add(f"height/{g}-{a}-{m}-{w}-{hk}", gw * aw * mw * ww * hw)
                    add(f"proportions/{g}-{a}-{m}-{w}-idealproportions", gw * aw * mw * ww * b["proportions"])
    return v


# ---------------------------------------------------------------------------------------------- skeleton

# bones kept for the game; every other bone's weights go to its nearest kept ancestor
KEEP = {
    "root", "spine05", "spine04", "spine03", "spine02", "spine01", "neck01", "neck02", "head", "jaw",
    "pelvis.L", "pelvis.R", "upperleg01.L", "upperleg01.R", "upperleg02.L", "upperleg02.R",
    "lowerleg01.L", "lowerleg01.R", "lowerleg02.L", "lowerleg02.R", "foot.L", "foot.R", "toe1-1.L", "toe1-1.R",
    "clavicle.L", "clavicle.R", "shoulder01.L", "shoulder01.R", "upperarm01.L", "upperarm01.R",
    "upperarm02.L", "upperarm02.R", "lowerarm01.L", "lowerarm01.R", "lowerarm02.L", "lowerarm02.R",
    "wrist.L", "wrist.R",
}
for side in ("L", "R"):
    for f in range(1, 6):
        KEEP.add(f"finger{f}-1.{side}")
        KEEP.add(f"finger{f}-2.{side}")
# finger chains skip the metacarpals: finger*-1 parents straight to the wrist


def mh_to_blender(p: np.ndarray) -> np.ndarray:
    """MakeHuman: y up, decimetres. Blender: z up, metres (glTF export turns it back to y up)."""
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1) * 0.1


def build_armature(name: str, verts: np.ndarray) -> tuple[bpy.types.Object, dict[str, str], dict[str, np.ndarray]]:
    skel = json.loads(fetch("rigs/default.mhskel").read_text("utf-8"))
    joints = {k: verts[v].mean(axis=0) for k, v in skel["joints"].items()}
    bones = skel["bones"]

    def kept_parent(b: str | None) -> str | None:
        while b is not None and b not in KEEP:
            b = bones[b]["parent"]
        return b

    remap = {b: (b if b in KEEP else kept_parent(bones[b]["parent"]) or "root") for b in bones}
    arm = bpy.data.armatures.new(name + "_rig")
    obj = bpy.data.objects.new(name + "_rig", arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    for b in bones:
        if b not in KEEP:
            continue
        eb = arm.edit_bones.new(b)
        eb.head = mh_to_blender(joints[bones[b]["head"]])
        eb.tail = mh_to_blender(joints[bones[b]["tail"]])
        # roll from MakeHuman's rotation plane: the bone's z axis lies in that plane
        plane = skel["planes"].get(bones[b].get("rotation_plane") or "")
        if plane:
            a, c, d = (mh_to_blender(joints[j]) for j in plane)
            n = np.cross(c - a, d - c)
            if np.linalg.norm(n) > 1e-9:
                eb.align_roll(tuple(n / np.linalg.norm(n)))
    for b in bones:
        if b in KEEP and b != "root":
            arm.edit_bones[b].parent = arm.edit_bones[kept_parent(bones[b]["parent"])]
    bpy.ops.object.mode_set(mode="OBJECT")
    heads = {b: mh_to_blender(joints[bones[b]["head"]]) for b in bones}
    heads.update({b + ":tail": mh_to_blender(joints[bones[b]["tail"]]) for b in bones})
    return obj, remap, heads


# ---------------------------------------------------------------------------------------------- body


def make_mesh(name: str, verts: np.ndarray, obj: dict, groups: set[str]) -> tuple[bpy.types.Object, np.ndarray]:
    """A Blender mesh of the faces in ``groups``; returns it and the MakeHuman index of each of its vertices."""
    faces = [f for f in obj["faces"] if f[0] in groups]
    used = sorted({i for _, vi, _ in faces for i in vi})
    local = {g: i for i, g in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata(mh_to_blender(verts[used]).tolist(), [], [[local[i] for i in vi] for _, vi, _ in faces])
    uv = me.uv_layers.new(name="UVMap")
    k = 0
    for _, _, ti in faces:
        for t in ti:
            uv.data[k].uv = obj["vt"][t]
            k += 1
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o, np.array(used)


def skin(o: bpy.types.Object, mh_index: np.ndarray, rig: bpy.types.Object, remap: dict[str, str]) -> None:
    w = json.loads(fetch("rigs/default_weights.mhw").read_text("utf-8"))["weights"]
    local = {g: i for i, g in enumerate(mh_index)}
    acc: dict[str, dict[int, float]] = {}
    for bone, pairs in w.items():
        tgt = remap.get(bone, "root")
        d = acc.setdefault(tgt, {})
        for vi, wt in pairs:
            if vi in local:
                d[local[vi]] = d.get(local[vi], 0.0) + wt
    for bone, d in acc.items():
        g = o.vertex_groups.new(name=bone)
        for i, wt in d.items():
            g.add([i], min(wt, 1.0), "REPLACE")
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    o.parent = rig


def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def placed(v: np.ndarray, body: np.ndarray, tall: float) -> np.ndarray:
    """Scaled to the body's height (metres) with the feet on the ground."""
    h = v[body, 1].max() - v[body, 1].min()
    v = v * (tall * 10 / h)
    v[:, 1] -= v[body, 1].min()
    return v


# ---------------------------------------------------------------------------------------------- regions

SKIN, TOP, BOTTOM, SHOE, HAIR, EYE, WRAP, CAP, BEARD = range(9)
REGIONS = 9
OFFSET = {SKIN: 0.0, TOP: 0.012, BOTTOM: 0.016, SHOE: 0.014, HAIR: 0.003, EYE: 0.0, WRAP: 0.012, CAP: 0.016, BEARD: 0.0015}
SMOOTH = {TOP: 3, BOTTOM: 4, SHOE: 40, WRAP: 2, CAP: 6}  # passes of smoothing: cloth hangs, shoes lose the toes
TORSO = {"spine01", "spine02", "spine03", "spine04", "clavicle.L", "clavicle.R", "shoulder01.L", "shoulder01.R"}
UPPERARM = {"upperarm01.L", "upperarm01.R", "upperarm02.L", "upperarm02.R"}
HIPS = {"root", "spine05", "pelvis.L", "pelvis.R"}
LEGS = {"upperleg01.L", "upperleg01.R", "upperleg02.L", "upperleg02.R", "lowerleg01.L", "lowerleg01.R", "lowerleg02.L", "lowerleg02.R"}
FEET = {"foot.L", "foot.R", "toe1-1.L", "toe1-1.R"}


def dominant_bones(n: int, remap: dict[str, str]) -> list[str]:
    w = json.loads(fetch("rigs/default_weights.mhw").read_text("utf-8"))["weights"]
    best = np.zeros(n)
    dom = ["root"] * n
    acc: dict[tuple[int, str], float] = {}
    for bone, pairs in w.items():
        b = remap.get(bone, "root")
        for vi, wt in pairs:
            acc[(vi, b)] = acc.get((vi, b), 0.0) + wt
    for (vi, b), wt in acc.items():
        if vi < n and wt > best[vi]:
            best[vi], dom[vi] = wt, b
    return dom


def vertex_regions(name: str, pos: np.ndarray, dom: list[str], j: dict[str, np.ndarray]) -> np.ndarray:
    """Region of every MakeHuman vertex (Blender coordinates in ``pos``)."""
    female = BODIES[name]["gender"] < 0.5
    elder = name == "elder"
    reg = np.full(len(pos), SKIN)
    mouth = np.mean([v for k, v in j.items() if k.startswith("oris") and not k.endswith(":tail")], axis=0)
    belt = j["spine05"][2] + (0.02 if female else 0.0)
    ankle = j["foot.L"][2] + 0.035
    elbow = j["lowerarm01.L"][2]
    eye = (j["eye.L"] + j["eye.R"]) / 2
    for i, (p, b) in enumerate(zip(pos, dom, strict=True)):
        z, y = p[2], p[1]
        if b in TORSO or (b in HIPS and z >= belt) or (b in UPPERARM):
            if b in UPPERARM and abs(p[0]) > abs(j["lowerarm01.L"][0]) * (0.86 if female else 0.9):
                continue  # sleeves stop above the elbow
            reg[i] = TOP
        elif (b in HIPS or b in LEGS) and z < belt and z > ankle:
            if not female:
                reg[i] = BOTTOM
        elif b in FEET or (b in LEGS and z <= ankle):
            if not female or z < 0.022:
                reg[i] = SHOE  # women: sandals (just the soles show)
        elif b in ("head", "jaw", "neck02", "neck01"):
            # hairline: above the forehead in front, lower round the back of the head, never the face or ears
            back = np.clip((y - eye[1]) / 0.12, 0, 1)
            line = eye[2] + 0.062 - 0.095 * back
            ear = abs(p[0] - 0) > abs(j["eye.L"][0]) * 2.05 and z < eye[2] + 0.03 and y < eye[1] + 0.11
            if z > line and not ear and b == "head":
                reg[i] = CAP if elder and z > eye[2] + 0.045 else HAIR
            elif elder and b in ("head", "jaw") and y < eye[1] + 0.055 and abs(p[0]) < abs(j["eye.L"][0]) * 1.9:
                # a short grey beard round the chin and jaw, and a moustache over the lip
                chin = z < mouth[2] - 0.009 and z > mouth[2] - 0.06
                tache = mouth[2] + 0.004 < z < mouth[2] + 0.017 and abs(p[0]) < 0.026
                if chin or tache:
                    reg[i] = BEARD
    _ = elbow
    return reg


# ---------------------------------------------------------------------------------------------- the character mesh


def character_mesh(name: str, body: str, verts: np.ndarray, base: dict, rig: bpy.types.Object, remap: dict[str, str], j: dict[str, np.ndarray]) -> bpy.types.Object:
    female = BODIES[body]["gender"] < 0.5
    groups = {"body", "helper-l-eye", "helper-r-eye"} | ({"helper-skirt"} if female else set())
    faces = [f for f in base["faces"] if f[0] in groups]
    used = sorted({i for _, vi, _ in faces for i in vi})
    local = {g: i for i, g in enumerate(used)}
    pos = mh_to_blender(verts)
    dom = dominant_bones(len(verts), remap)
    vreg = vertex_regions(body, pos, dom, j)
    # face regions: helpers by group, body faces by majority of their vertices
    freg = []
    for g, vi, _ in faces:
        if g.startswith("helper-") and g.endswith("-eye"):
            freg.append(EYE)
        elif g == "helper-skirt":
            freg.append(WRAP)
        else:
            vals = [vreg[i] for i in vi]
            freg.append(max(set(vals), key=vals.count))
    # grow clothes and hair out of the body along the normals (seams half way, so the surface stays closed)
    p = pos[used].copy()
    nrm = np.zeros_like(p)
    for _, vi, _ in faces:
        a, b, c = (p[local[vi[k]]] for k in range(3))
        n = np.cross(b - a, c - a)
        for v in vi:
            nrm[local[v]] += n
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
    off = np.zeros(len(p))
    cnt = np.zeros(len(p))
    for (_, vi, _), r in zip(faces, freg, strict=True):
        for v in vi:
            off[local[v]] += OFFSET[r]
            cnt[local[v]] += 1
    p += nrm * (off / np.maximum(cnt, 1))[:, None]
    # trousers hang straight below the knee instead of hugging the calf
    knee, ankle = j["lowerleg01.L"][2], j["foot.L"][2]
    for a, rs in vr_of(faces, freg, local).items():
        if rs == {BOTTOM}:
            p[a] += nrm[a] * 0.026 * np.clip((knee - p[a][2]) / (knee - ankle), 0, 1)
    # smooth clothes and shoes (only vertices fully inside one region, so seams stay put)
    vr: dict[int, set[int]] = {}
    nb: dict[int, set[int]] = {}
    for (_, vi, _), r in zip(faces, freg, strict=True):
        loc = [local[v] for v in vi]
        for a in loc:
            vr.setdefault(a, set()).add(r)
            nb.setdefault(a, set()).update(loc)
    shoe_shape(p, [a for a, rs in vr.items() if rs == {SHOE}], nb)
    for region, passes in SMOOTH.items():
        if region == SHOE:
            continue
        inner = [a for a, rs in vr.items() if rs == {region}]
        if not inner:
            continue
        nbs = [np.array(sorted(nb[a] - {a})) for a in inner]
        for k in range(passes * 2):  # Taubin smoothing: alternate shrink and grow, so shapes don't shrink
            avg = np.array([p[n].mean(axis=0) for n in nbs])
            f = 0.6 if k % 2 == 0 else -0.63
            p[inner] = p[inner] + f * (avg - p[inner])

    me = bpy.data.meshes.new(name)
    me.from_pydata(p.tolist(), [], [[local[i] for i in vi] for _, vi, _ in faces])
    uv = me.uv_layers.new(name="UVMap")
    # helper islands move into the free corner of MakeHuman's layout: the wrapper a strip, both eyes one square
    box = {}
    for g, _, ti in faces:
        if g.startswith("helper-"):
            a = base["vt"][ti]
            lo_, hi_ = box.get(g, (a.min(0), a.max(0)))
            box[g] = (np.minimum(lo_, a.min(0)), np.maximum(hi_, a.max(0)))
    dest = {"helper-skirt": (0.60, 0.905, 0.33, 0.09), "helper-l-eye": (0.94, 0.92, 0.055, 0.055), "helper-r-eye": (0.94, 0.92, 0.055, 0.055)}
    k = 0
    for (g, _, ti), _r in zip(faces, freg, strict=True):
        for t in ti:
            u, v = base["vt"][t]
            if g in dest:
                (lu, lv), (hu, hv) = box[g]
                du, dv, w_, h_ = dest[g]
                u, v = du + (u - lu) / (hu - lu) * w_, dv + (v - lv) / (hv - lv) * h_
            uv.data[k].uv = (u, v)
            k += 1
    for poly, r in zip(me.polygons, freg, strict=True):
        poly.use_smooth = True
        poly.material_index = r
    # tint mask for the look picker: R skin, G top, B bottom/wrapper
    # one tint per vertex: its own region, or for untinted parts (hair, shoes) the tinted region next to it, so
    # skin, cloth and hems never fade towards white; seams blend over a single face, like a real hem
    col = me.color_attributes.new("tint", "BYTE_COLOR", "POINT")
    tint = np.zeros((len(used), 4))
    tint[:, 3] = 1
    chan = {SKIN: 0, TOP: 1, BOTTOM: 2, WRAP: 2, CAP: 1}
    for a, rs in vr_of(faces, freg, local).items():
        mine = vreg[used[a]]
        own = [mine] if mine in chan and not (rs & {WRAP}) else [r for r in (TOP, CAP, BOTTOM, WRAP, SKIN) if r in rs]
        if EYE in rs:
            continue
        if HAIR in rs and not own:
            tint[a, 0] = 1  # hair takes the skin tone's darkness at its edge (it's near black anyway)
        elif own:
            tint[a, chan[own[0]]] = 1
    col.data.foreach_set("color", tint.ravel())
    # where the mouth, eyebrows and eyes are, for the skin detail
    eye_l, eye_r = j["eye.L"], j["eye.R"]
    mouth = np.mean([v for k2, v in j.items() if k2.startswith("oris") and not k2.endswith(":tail")], axis=0)
    marks = me.attributes.new("marks", "FLOAT_VECTOR", "POINT")
    m = np.zeros((len(used), 3))
    q = pos[used]
    d = (q - mouth) / np.array([0.028, 0.02, 0.014])
    m[:, 0] = np.clip(1.4 - np.linalg.norm(d, axis=1), 0, 1) * (q[:, 1] < mouth[1] + 0.01)
    for e in (eye_l, eye_r):
        brow = e + np.array([0.004 * np.sign(e[0]), -0.008, 0.024])
        d = (q - brow) / np.array([0.026, 0.02, 0.0065])
        m[:, 1] = np.maximum(m[:, 1], np.clip(1.3 - np.linalg.norm(d, axis=1), 0, 1))
    eyeloc = me.attributes.new("eyedir", "FLOAT_VECTOR", "POINT")
    ed = np.zeros((len(used), 3))
    for e in (eye_l, eye_r):
        near = np.linalg.norm(q - e, axis=1) < 0.03
        ed[near] = (q[near] - e) / np.linalg.norm(q[near] - e, axis=1, keepdims=True)
    marks.data.foreach_set("vector", m.ravel())
    eyeloc.data.foreach_set("vector", ed.ravel())
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    skin(o, np.array(used), rig, remap)
    # helpers (wrapper) may have no weights of their own: take the nearest body vertex's
    fill_missing_weights(o)
    for r in range(REGIONS):
        o.data.materials.append(bpy.data.materials.new(f"r{r}"))
    if female:
        add_bun(o, q, freg, faces, local)
    if body == "elder":
        add_brim(o, freg, faces, local)
    return o


def add_bun(o: bpy.types.Object, q: np.ndarray, freg: list[int], faces: list, local: dict[int, int]) -> None:
    """A bun at the back of the head, textured from the hair (UVs from the nearest scalp point), on the head bone."""
    import bmesh
    from mathutils.kdtree import KDTree

    hair = sorted({local[v] for (_, vi, _), r in zip(faces, freg, strict=True) if r == HAIR for v in vi})
    hp = q[hair]
    back = hp[hp[:, 1] > np.percentile(hp[:, 1], 85)]
    centre = back.mean(axis=0) + np.array([0.0, 0.035, 0.035])
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=9, radius=0.058)
    for v in bm.verts:
        v.co.x, v.co.y, v.co.z = v.co.x * 1.05 + centre[0], v.co.y * 0.85 + centre[1], v.co.z * 0.92 + centre[2]
    me = bpy.data.meshes.new("bun")
    bm.to_mesh(me)
    bm.free()
    # UVs: copy the nearest scalp vertex's
    src = o.data
    kd = KDTree(len(hair))
    for i, a in enumerate(hair):
        kd.insert(src.vertices[a].co, i)
    kd.balance()
    uvs = {}
    for poly in src.polygons:
        for li in poly.loop_indices:
            uvs[src.loops[li].vertex_index] = tuple(src.uv_layers["UVMap"].data[li].uv)
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        poly.use_smooth = True
        poly.material_index = HAIR
        for li in poly.loop_indices:
            _, i, _ = kd.find(me.vertices[me.loops[li].vertex_index].co)
            uv.data[li].uv = uvs[hair[i]]
    bun = bpy.data.objects.new("bun", me)
    bpy.context.scene.collection.objects.link(bun)
    for m in o.data.materials:
        bun.data.materials.append(m)
    g = bun.vertex_groups.new(name="head")
    g.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    bpy.ops.object.select_all(action="DESELECT")
    bun.select_set(True)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()


def _uv_from_nearest(o: bpy.types.Object, me: bpy.types.Mesh, verts: list[int]) -> None:
    """UVs for an add-on piece: copy the nearest of ``verts`` (vertices of ``o``)."""
    from mathutils.kdtree import KDTree

    src = o.data
    kd = KDTree(len(verts))
    for i, a in enumerate(verts):
        kd.insert(src.vertices[a].co, i)
    kd.balance()
    uvs = {}
    for poly in src.polygons:
        for li in poly.loop_indices:
            uvs[src.loops[li].vertex_index] = tuple(src.uv_layers["UVMap"].data[li].uv)
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            _, i, _ = kd.find(me.vertices[me.loops[li].vertex_index].co)
            uv.data[li].uv = uvs[verts[i]]


def add_brim(o: bpy.types.Object, freg: list[int], faces: list, local: dict[int, int]) -> None:
    """The face cap's brim: a curved peak over the forehead, in the cap's ankara, on the head bone."""
    cap = sorted({local[v] for (_, vi, _), r in zip(faces, freg, strict=True) if r == CAP for v in vi})
    cp = np.array([o.data.vertices[a].co[:] for a in cap])
    front = cp[cp[:, 1] < np.percentile(cp[:, 1], 6)]
    c = np.array([cp[:, 0].mean(), front[:, 1].mean() + 0.012, front[:, 2].min() + 0.004])
    w = (cp[:, 0].max() - cp[:, 0].min()) * 0.5
    depth, n, t = 0.075, 16, 0.006
    pts, quads = [], []
    for k in range(n + 1):
        a = math.pi * k / n
        x = -w * math.cos(a)
        inner = (c[0] + x, c[1] + 0.02 * (1 - math.sin(a)), c[2])
        outer = (c[0] + x * 1.02, c[1] - depth * math.sin(a), c[2] - 0.022 * math.sin(a))  # peak bends down
        pts += [inner, outer]
    top = len(pts)
    pts += [(x, y, z - t) for x, y, z in pts]
    for k in range(n):
        i0, o0, i1, o1 = 2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 3
        quads.append([i0, i1, o1, o0])  # upper side faces up
        quads.append([top + i0, top + o0, top + o1, top + i1])  # under side faces down
        quads.append([o0, o1, top + o1, top + o0])  # the rim
    me = bpy.data.meshes.new("brim")
    me.from_pydata(pts, [], quads)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = True
        poly.material_index = CAP
    _uv_from_nearest(o, me, cap)
    col = me.color_attributes.new("tint", "BYTE_COLOR", "POINT")
    col.data.foreach_set("color", [0, 1, 0, 1] * len(me.vertices))  # tinted like the cap (the top colour)
    brim = bpy.data.objects.new("brim", me)
    bpy.context.scene.collection.objects.link(brim)
    for m in o.data.materials:
        brim.data.materials.append(m)
    brim.vertex_groups.new(name="head").add(list(range(len(me.vertices))), 1.0, "REPLACE")
    bpy.ops.object.select_all(action="DESELECT")
    brim.select_set(True)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()


def vr_of(faces: list, freg: list[int], local: dict[int, int]) -> dict[int, set[int]]:
    out: dict[int, set[int]] = {}
    for (_, vi, _), r in zip(faces, freg, strict=True):
        for v in vi:
            out.setdefault(local[v], set()).add(r)
    return out


def shoe_shape(p: np.ndarray, verts: list[int], nb: dict[int, set[int]]) -> None:
    """Shoes, not feet: every shoe vertex moves onto a rounded-box shoe (the foot's size, narrower and lower at the
    toe, flat sole), by its direction from the shoe's centre."""
    del nb
    for side in (1, -1):
        idx = [a for a in verts if np.sign(p[a][0]) == side]
        if not idx:
            continue
        lo, hi = p[idx].min(axis=0), p[idx].max(axis=0)
        c = (lo + hi) / 2
        e = (hi - lo) / 2 + 0.004
        u = (p[idx] - c) / e
        n = u / (np.linalg.norm(u, axis=1, keepdims=True) + 1e-9)
        r = (np.abs(n) ** 3).sum(axis=1) ** (-1 / 3)
        q = n * r[:, None]
        front = np.clip(-q[:, 1], 0, 1)  # -y is forward
        q[:, 0] *= 1 - 0.28 * front**2
        q[:, 2] = np.where(q[:, 2] > 0, q[:, 2] * (1 - 0.35 * front), q[:, 2])
        out = c + q * e
        out[:, 2] = np.maximum(out[:, 2], 0.0)  # flat soles on the ground
        p[idx] = out


def fill_missing_weights(o: bpy.types.Object) -> None:

    from mathutils.kdtree import KDTree

    me = o.data
    has = np.zeros(len(me.vertices), bool)
    for v in me.vertices:
        has[v.index] = sum(g.weight for g in v.groups) > 0.05
    if has.all():
        return
    kd = KDTree(int(has.sum()))
    for v in me.vertices:
        if has[v.index]:
            kd.insert(v.co, v.index)
    kd.balance()
    for v in me.vertices:
        if has[v.index]:
            continue
        _, src, _ = kd.find(v.co)
        for g in me.vertices[src].groups:
            o.vertex_groups[g.group].add([v.index], g.weight, "REPLACE")


# ---------------------------------------------------------------------------------------------- materials


def _n(nt: bpy.types.NodeTree, kind: str, **kw: object) -> bpy.types.Node:
    node = nt.nodes.new(kind)
    for k, v in kw.items():
        if k.startswith("in_"):
            node.inputs[k[3:]].default_value = v
        else:
            setattr(node, k, v)
    return node


def detail_material(region: int, body: str = "male") -> bpy.types.Material:
    """The look of one region, for baking: colour (as emission), roughness and fine bump. Colours are neutral where
    the game tints them (skin tone, top, bottom from the look picker)."""
    m = bpy.data.materials.new(f"detail{region}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = _n(nt, "ShaderNodeOutputMaterial")
    bsdf = _n(nt, "ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    tex = _n(nt, "ShaderNodeTexCoord")
    L = nt.links.new

    def noise(scale: float, detail: float = 4.0) -> bpy.types.Node:
        nz = _n(nt, "ShaderNodeTexNoise", in_Scale=scale, in_Detail=detail)
        L(tex.outputs["Object"], nz.inputs["Vector"])
        return nz

    def ramp(src: bpy.types.NodeSocket, a: tuple, b: tuple, pa: float = 0.3, pb: float = 0.7) -> bpy.types.Node:
        r = _n(nt, "ShaderNodeValToRGB")
        r.color_ramp.elements[0].position, r.color_ramp.elements[0].color = pa, (*a, 1)
        r.color_ramp.elements[1].position, r.color_ramp.elements[1].color = pb, (*b, 1)
        L(src, r.inputs[0])
        return r

    def bump(src: bpy.types.NodeSocket, strength: float, dist: float) -> None:
        bp = _n(nt, "ShaderNodeBump", in_Strength=strength, in_Distance=dist)
        L(src, bp.inputs["Height"])
        L(bp.outputs[0], bsdf.inputs["Normal"])

    color: bpy.types.NodeSocket
    rough = 0.6
    if region == SKIN:
        big = ramp(noise(5).outputs[0], (0.80, 0.80, 0.80), (0.88, 0.88, 0.88))
        attr = _n(nt, "ShaderNodeAttribute", attribute_name="marks")
        sep = _n(nt, "ShaderNodeSeparateXYZ")
        L(attr.outputs["Vector"], sep.inputs[0])
        lips = _n(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        L(sep.outputs["X"], lips.inputs[0])
        L(big.outputs[0], lips.inputs[6])
        lips.inputs[7].default_value = (0.62, 0.48, 0.48, 1)
        brows = _n(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        hairs = ramp(noise(900, 2).outputs[0], (0.08, 0.07, 0.06), (0.45, 0.42, 0.4), 0.45, 0.6)
        L(sep.outputs["Y"], brows.inputs[0])
        L(lips.outputs[2], brows.inputs[6])
        L(hairs.outputs[0], brows.inputs[7])
        color = brows.outputs[2]
        pores = noise(1400, 2)
        bump(pores.outputs[0], 0.12, 0.0006)
        rough = 0.5
    elif region in (TOP, CAP):
        # ankara-style print: bold repeating motifs (light) on the fabric colour (tinted in game)
        mapping = _n(nt, "ShaderNodeMapping")
        L(tex.outputs["UV"], mapping.inputs[0])
        mapping.inputs["Scale"].default_value = (14, 14, 14)
        vor = _n(nt, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
        L(mapping.outputs[0], vor.inputs["Vector"])
        wave = _n(nt, "ShaderNodeTexWave", in_Scale=7.0, in_Distortion=4.0)
        L(tex.outputs["UV"], wave.inputs["Vector"])
        mix = _n(nt, "ShaderNodeMath", operation="MULTIPLY")
        L(vor.outputs["Distance"], mix.inputs[0])
        L(wave.outputs["Fac"], mix.inputs[1])
        # fabric about as bright as the skin's neutral base, motifs darker: seams never show pale patches
        color = ramp(mix.outputs[0], (0.42, 0.4, 0.38), (0.84, 0.84, 0.84), 0.06, 0.1).outputs[0]
        bump(noise(600, 1).outputs[0], 0.05, 0.0005)
        rough = 0.75
    elif region in (BOTTOM, WRAP):
        weave = ramp(noise(700, 1).outputs[0], (0.74, 0.74, 0.74), (0.88, 0.88, 0.88))
        if region == WRAP:
            wave = _n(nt, "ShaderNodeTexWave", wave_type="BANDS", in_Scale=22.0, in_Distortion=2.0)
            L(tex.outputs["UV"], wave.inputs["Vector"])
            stripes = ramp(wave.outputs["Fac"], (0.5, 0.48, 0.45), (1.0, 1.0, 1.0), 0.25, 0.35)
            mix = _n(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY", in_Factor=1.0)
            L(stripes.outputs[0], mix.inputs[6])
            L(weave.outputs[0], mix.inputs[7])
            color = mix.outputs[2]
        else:
            color = weave.outputs[0]
        bump(noise(700, 1).outputs[0], 0.08, 0.0005)
        rough = 0.85
    elif region == SHOE:
        leather = ramp(noise(80).outputs[0], (0.03, 0.022, 0.018), (0.07, 0.05, 0.04)).outputs[0]
        sep = _n(nt, "ShaderNodeSeparateXYZ")
        L(tex.outputs["Object"], sep.inputs[0])
        sole = _n(nt, "ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        edge = ramp(sep.outputs["Z"], (1, 1, 1), (0, 0, 0), 0.018, 0.022)
        L(edge.outputs[0], sole.inputs[0])
        L(leather, sole.inputs[6])
        sole.inputs[7].default_value = (0.8, 0.78, 0.74, 1)
        color = sole.outputs[2]
        rough = 0.4
    elif region in (HAIR, BEARD):
        coils = noise(420 if region == HAIR else 700, 6)
        if body == "elder":  # grey: white coils over darker scalp/skin showing through
            color = ramp(coils.outputs[0], (0.12, 0.11, 0.1), (0.72, 0.71, 0.69), 0.4, 0.62).outputs[0]
        else:
            color = ramp(coils.outputs[0], (0.025, 0.02, 0.018), (0.09, 0.07, 0.06), 0.35, 0.65).outputs[0]
        bump(coils.outputs[0], 0.9 if region == HAIR else 0.5, 0.002)
        rough = 0.9
    else:  # eyes: sclera, brown iris, pupil, looking straight ahead (-y)
        attr = _n(nt, "ShaderNodeAttribute", attribute_name="eyedir")
        dot = _n(nt, "ShaderNodeVectorMath", operation="DOT_PRODUCT")
        L(attr.outputs["Vector"], dot.inputs[0])
        dot.inputs[1].default_value = (0, -1, 0)
        r = _n(nt, "ShaderNodeValToRGB")
        els = r.color_ramp.elements
        els[0].position, els[0].color = 0.80, (0.93, 0.9, 0.86, 1)
        els[1].position, els[1].color = 0.84, (0.26, 0.13, 0.05, 1)
        e3 = els.new(0.95)
        e3.color = (0.16, 0.08, 0.03, 1)
        e4 = els.new(0.965)
        e4.color = (0.01, 0.01, 0.01, 1)
        L(dot.outputs["Value"], r.inputs[0])
        color = r.outputs[0]
        rough = 0.1
    L(color, bsdf.inputs["Base Color"])
    L(color, bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = rough
    return m


# ---------------------------------------------------------------------------------------------- bake + cut down

TEX = 1024


def decimated(src: bpy.types.Object, tris: int, name: str) -> bpy.types.Object:
    o = src.copy()
    o.data = src.data.copy()
    o.name = name
    bpy.context.scene.collection.objects.link(o)
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    mod = o.modifiers.new("dec", "DECIMATE")
    mod.ratio = min(1.0, tris / n)
    mod.use_symmetry = True
    mod.symmetry_axis = "X"
    o.modifiers.move(len(o.modifiers) - 1, 0)  # before the armature
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier="dec")
    return o


def bake(hi: bpy.types.Object, name: str) -> dict[str, bpy.types.Image]:
    """Bakes the detailed mesh's look into 1K maps. The reduced meshes share its UV layout, so the maps fit them."""
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 16
    imgs = {k: bpy.data.images.new(f"{name}_{k}", TEX, TEX, alpha=False) for k in ("color", "normal", "rough", "ao")}
    for k in ("normal", "rough", "ao"):
        imgs[k].colorspace_settings.name = "Non-Color"
    nodes = []
    for r in range(REGIONS):
        m = detail_material(r, name)
        hi.material_slots[r].material = m
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        m.node_tree.nodes.active = n
        nodes.append(n)
    hi.modifiers["Armature"].show_render = False  # bake in the rest pose
    bpy.ops.object.select_all(action="DESELECT")
    hi.select_set(True)
    bpy.context.view_layer.objects.active = hi
    for key, kind in (("color", "EMIT"), ("normal", "NORMAL"), ("rough", "ROUGHNESS"), ("ao", "AO")):
        for n in nodes:
            n.image = imgs[key]
        print(f"  baking {key}", file=sys.stderr)
        bpy.ops.object.bake(type=kind, margin=8)
    hi.modifiers["Armature"].show_render = True
    return imgs


def game_material(name: str, imgs: dict[str, bpy.types.Image]) -> bpy.types.Material:
    """Colour (with the ambient occlusion multiplied in), normal map, and one packed occlusion/roughness/metal map."""
    w = h = TEX
    col = np.array(imgs["color"].pixels[:]).reshape(h, w, 4)
    ao = np.array(imgs["ao"].pixels[:]).reshape(h, w, 4)[..., 0]
    rough = np.array(imgs["rough"].pixels[:]).reshape(h, w, 4)[..., 0]
    col[..., :3] *= (0.55 + 0.45 * ao)[..., None]
    imgs["color"].pixels[:] = col.ravel()
    orm = bpy.data.images.new(f"{name}_orm", w, h, alpha=False)
    orm.colorspace_settings.name = "Non-Color"
    px = np.zeros((h, w, 4))
    px[..., 0], px[..., 1], px[..., 2], px[..., 3] = ao, rough, 0.0, 1.0
    orm.pixels[:] = px.ravel()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    L = nt.links.new
    c = nt.nodes.new("ShaderNodeTexImage")
    c.image = imgs["color"]
    L(c.outputs["Color"], bsdf.inputs["Base Color"])
    nimg = nt.nodes.new("ShaderNodeTexImage")
    nimg.image = imgs["normal"]
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    L(nimg.outputs["Color"], nmap.inputs["Color"])
    L(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    o = nt.nodes.new("ShaderNodeTexImage")
    o.image = orm
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    L(o.outputs["Color"], sep.inputs["Color"])
    L(sep.outputs["Green"], bsdf.inputs["Roughness"])
    L(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    return m


# ---------------------------------------------------------------------------------------------- poses


def pose_bone_world(rig: bpy.types.Object, bone: str, axis: tuple[float, float, float], deg: float) -> None:
    """Rotate a bone about an armature-space axis (on top of its rest pose)."""
    from mathutils import Matrix, Vector

    pb = rig.pose.bones[bone]
    rest = pb.bone.matrix_local.to_3x3()
    rot = Matrix.Rotation(math.radians(deg), 3, Vector(axis))
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (rest.inverted() @ rot @ rest).to_quaternion() @ pb.rotation_quaternion


def idle_pose(rig: bpy.types.Object) -> None:
    for side, s in (("L", 1), ("R", -1)):
        pose_bone_world(rig, f"upperarm01.{side}", (0, 1, 0), 50 * s)
        pose_bone_world(rig, f"upperarm01.{side}", (1, 0, 0), 8)
    bpy.context.view_layer.update()


# ---------------------------------------------------------------------------------------------- build + export


def build(name: str, render_dir: Path | None) -> Path:
    reset()
    b = BODIES[name]
    base = read_obj(fetch("3dobjs/base.obj"))
    body_idx = np.array(sorted({i for g, vi, _ in base["faces"] if g == "body" for i in vi}))
    verts = placed(shaped(base["v"], targets(), b), body_idx, b["tall"])
    rig, remap, joints = build_armature(name, verts)
    hi = character_mesh(name + "_hi", name, verts, base, rig, remap, joints)
    imgs = bake(hi, name)
    lo = decimated(hi, 9000, name)
    lod = decimated(hi, 2000, name + "_lod1")
    mat = game_material(name + "_mat", imgs)
    for o in (lo, lod):
        o.data.materials.clear()
        o.data.materials.append(mat)
        for p in o.data.polygons:
            p.material_index = 0
        o.data.color_attributes.active_color = o.data.color_attributes["tint"]
        for a in ("marks", "eyedir"):
            o.data.attributes.remove(o.data.attributes[a])
    bpy.data.objects.remove(hi)
    print(f"  {name}: {sum(len(p.vertices) - 2 for p in lo.data.polygons)} triangles (LOD1 "
          f"{sum(len(p.vertices) - 2 for p in lod.data.polygons)})", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.glb"
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_image_format="JPEG",
        export_jpeg_quality=86, export_skins=True, export_animations=True, export_yup=True,
        export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_normals=True, export_tangents=False,
    )
    if render_dir:
        for k, im in imgs.items():
            im.filepath_raw = str(render_dir / f"{name}_{k}.png")
            im.file_format = "PNG"
            im.save()
        idle_pose(rig)
        lod.hide_render = True
        render(render_dir / f"{name}.png", lo, tints=PREVIEW_TINT_ELDER if name == "elder" else PREVIEW_TINT)
        render(render_dir / f"{name}_face.png", lo, face=True)
    return path


PREVIEW_TINT = {"skin": "#5a3825", "top": "#d94f3d", "bottom": "#2c3e50"}  # from the game's palette
PREVIEW_TINT_ELDER = {"skin": "#a8714a", "top": "#3d7fd9", "bottom": "#2c3e50"}  # Baba Boju's look


def _linear(hex_color: str) -> tuple[float, float, float]:
    c = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # type: ignore[return-value]


def preview_tint(o: bpy.types.Object, tints: dict[str, str]) -> None:
    """Colour the render like the game does: base colour x (skin tone, top, bottom) through the tint mask."""
    m = o.data.materials[0].copy()
    o.data.materials[0] = m
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = bsdf.inputs["Base Color"].links[0].from_node
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "tint"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs[0])
    # tint = (R*skin + G*top + B*bottom + leftover*white) / max(1, R+G+B): seams average, never lighten
    def vec(op: str, a: object, b: object) -> bpy.types.NodeSocket:
        n = nt.nodes.new("ShaderNodeVectorMath")
        n.operation = op
        for i, x in enumerate((a, b)):
            if isinstance(x, bpy.types.NodeSocket):
                nt.links.new(x, n.inputs[i])
            elif x is not None:
                n.inputs[i].default_value = x
        return n.outputs[0]

    def val(op: str, a: object, b: object) -> bpy.types.NodeSocket:
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, x in enumerate((a, b)):
            if isinstance(x, bpy.types.NodeSocket):
                nt.links.new(x, n.inputs[i])
            else:
                n.inputs[i].default_value = x
        return n.outputs[0]

    acc = None
    total = None
    for ch, key in (("Red", "skin"), ("Green", "top"), ("Blue", "bottom")):
        term = vec("SCALE", tuple(c * 1.25 for c in _linear(tints[key])), None)
        nt.links.new(sep.outputs[ch], term.node.inputs["Scale"])
        acc = term if acc is None else vec("ADD", acc, term)
        total = sep.outputs[ch] if total is None else val("ADD", total, sep.outputs[ch])
    rest = val("MAXIMUM", val("SUBTRACT", 1.0, total), 0.0)
    white = vec("SCALE", (1.0, 1.0, 1.0), None)
    nt.links.new(rest, white.node.inputs["Scale"])
    tint = vec("DIVIDE", vec("ADD", acc, white), None)
    w = val("MAXIMUM", total, 1.0)
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for i in range(3):
        nt.links.new(w, comb.inputs[i])
    nt.links.new(comb.outputs[0], tint.node.inputs[1])
    cur = vec("MULTIPLY", tex.outputs["Color"], tint)
    nt.links.new(cur, bsdf.inputs["Base Color"])


def render(path: Path, target: bpy.types.Object, face: bool = False, tints: dict[str, str] = PREVIEW_TINT) -> None:
    """A quick studio render (Cycles, CPU) to look at the result; ``face`` for a close-up."""
    if not face:
        preview_tint(target, tints)
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 48
    scn.render.resolution_x, scn.render.resolution_y = 900, 1200
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.68, 0.75, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    scn.world = world
    scn.view_settings.view_transform = "AgX"
    top = target.dimensions.z
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scn.collection.objects.link(cam)
    cam.location = (1.15, -3.2, top * 0.62)
    cam.rotation_euler = (math.radians(87), 0, math.radians(20))
    cam.data.lens = 55
    if face:
        cam.location = (0.22, -0.75, top * 0.93)
        cam.rotation_euler = (math.radians(90), 0, math.radians(16))
        cam.data.lens = 70
    scn.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(55), math.radians(-15), math.radians(-35))
    scn.collection.objects.link(sun)
    floor = bpy.data.meshes.new("floor")
    floor.from_pydata([(-5, -5, 0), (5, -5, 0), (5, 5, 0), (-5, 5, 0)], [], [[0, 1, 2, 3]])
    fo = bpy.data.objects.new("floor", floor)
    scn.collection.objects.link(fo)
    scn.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    out = Path(args[args.index("--render") + 1]) if "--render" in args else None
    only = [a for a in args if a in BODIES]
    for n in only or list(BODIES):
        if out:
            out.mkdir(parents=True, exist_ok=True)
        print("wrote", build(n, out), file=sys.stderr)
