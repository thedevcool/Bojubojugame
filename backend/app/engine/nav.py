"""Grid navigation for NPC players: walkable grid, A*, path smoothing. Pure."""

from __future__ import annotations

import heapq
import math

from app.engine.geometry import Box, collides, segment_hits_box

Cell = tuple[int, int]


class NavGrid:
    def __init__(self, bounds: list[float], boxes: list[Box], radius: float, cell: float = 1.0) -> None:
        self.x0, self.z0 = bounds[0], bounds[1]
        self.cell = cell
        self.w = int((bounds[2] - bounds[0]) / cell)
        self.h = int((bounds[3] - bounds[1]) / cell)
        self.boxes = boxes
        self.radius = radius
        self.walkable: list[list[bool]] = [
            [
                not collides(*self.center((i, j)), radius + 0.15, boxes) and 0 < i < self.w - 1 and 0 < j < self.h - 1
                for j in range(self.h)
            ]
            for i in range(self.w)
        ]

    def center(self, c: Cell) -> tuple[float, float]:
        return self.x0 + (c[0] + 0.5) * self.cell, self.z0 + (c[1] + 0.5) * self.cell

    def cell_of(self, x: float, z: float) -> Cell:
        i = min(self.w - 1, max(0, int((x - self.x0) / self.cell)))
        j = min(self.h - 1, max(0, int((z - self.z0) / self.cell)))
        return i, j

    def ok(self, c: Cell) -> bool:
        return 0 <= c[0] < self.w and 0 <= c[1] < self.h and self.walkable[c[0]][c[1]]

    def nearest_walkable(self, c: Cell, max_r: int = 6) -> Cell | None:
        if self.ok(c):
            return c
        for r in range(1, max_r + 1):
            for di in range(-r, r + 1):
                for dj in (-r, r):
                    for cand in ((c[0] + di, c[1] + dj), (c[0] + dj, c[1] + di)):
                        if self.ok(cand):
                            return cand
        return None

    def clear_line(self, ax: float, az: float, bx: float, bz: float) -> bool:
        pad = self.radius + 0.1
        return not any(segment_hits_box(ax, az, bx, bz, b, pad=pad) for b in self.boxes)

    def find_path(self, sx: float, sz: float, tx: float, tz: float, max_nodes: int = 6000) -> list[tuple[float, float]]:
        """A* over 8-connected cells; returns smoothed world waypoints (empty if none)."""
        start = self.nearest_walkable(self.cell_of(sx, sz))
        goal = self.nearest_walkable(self.cell_of(tx, tz))
        if start is None or goal is None:
            return []
        openq: list[tuple[float, int, Cell]] = [(0.0, 0, start)]
        came: dict[Cell, Cell] = {}
        g: dict[Cell, float] = {start: 0.0}
        n = 0
        found = False
        while openq and n < max_nodes:
            _, _, cur = heapq.heappop(openq)
            if cur == goal:
                found = True
                break
            n += 1
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    if di == dj == 0:
                        continue
                    nb = (cur[0] + di, cur[1] + dj)
                    if not self.ok(nb):
                        continue
                    if di and dj and not (self.ok((cur[0] + di, cur[1])) and self.ok((cur[0], cur[1] + dj))):
                        continue  # no corner cutting
                    cost = g[cur] + (1.4142 if di and dj else 1.0)
                    if cost < g.get(nb, math.inf):
                        g[nb] = cost
                        came[nb] = cur
                        hval = math.hypot(goal[0] - nb[0], goal[1] - nb[1])
                        heapq.heappush(openq, (cost + hval, n, nb))
        if not found:
            return []
        cells = [goal]
        while cells[-1] != start:
            cells.append(came[cells[-1]])
        cells.reverse()
        pts = [self.center(c) for c in cells]
        return self.smooth([(sx, sz), *pts[1:]])

    def smooth(self, pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if len(pts) <= 2:
            return pts[1:]
        out: list[tuple[float, float]] = []
        anchor = pts[0]
        i = 1
        while i < len(pts):
            j = i
            while j + 1 < len(pts) and self.clear_line(anchor[0], anchor[1], pts[j + 1][0], pts[j + 1][1]):
                j += 1
            out.append(pts[j])
            anchor = pts[j]
            i = j + 1
        return out


def hide_spots(grid: NavGrid, boxes: list[Box], min_h: float = 1.0, step: int = 3) -> list[tuple[float, float]]:
    """Walkable points hugging cover (next to something at least ``min_h`` tall)."""
    spots: list[tuple[float, float]] = []
    for i in range(1, grid.w - 1, step):
        for j in range(1, grid.h - 1, step):
            if not grid.walkable[i][j]:
                continue
            x, z = grid.center((i, j))
            near = [b for b in boxes if b.h >= min_h and collides(x, z, grid.radius + 1.0, [b])]
            if near:
                spots.append((x, z))
    return spots
