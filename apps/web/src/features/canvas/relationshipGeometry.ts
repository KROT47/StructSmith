import type { AttachmentAnchor, AttachmentSide, ControlPoint } from "@structsmith/contracts";
import { Position } from "@xyflow/react";

/** Points along each side of a card, as a fraction of that side's length. */
export const ATTACHMENT_ANCHORS = [0.25, 0.5, 0.75] as const satisfies readonly AttachmentAnchor[];

const HANDLE_SIDES = { t: "top", r: "right", b: "bottom", l: "left" } as const;
const SIDE_HANDLES = { top: "t", right: "r", bottom: "b", left: "l" } as const;

/** Center stays unsuffixed so existing edges keep the ids `t`, `r`, `b` and `l`. */
export const handleId = (side: AttachmentSide, anchor: number | null | undefined): string => {
  const base = SIDE_HANDLES[side];
  if (anchor === 0.25) return `${base}-25`;
  if (anchor === 0.75) return `${base}-75`;
  return base;
};

export const sideForHandle = (handle: string | null | undefined): AttachmentSide | null => {
  const side = HANDLE_SIDES[handle?.[0] as keyof typeof HANDLE_SIDES];
  if (!side) return null;
  const suffix = handle?.slice(1);
  return suffix === "" || suffix === "-25" || suffix === "-75" ? side : null;
};

/** Null means the center point, including the unsuffixed handle ids. */
export const anchorForHandle = (handle: string | null | undefined): 0.25 | 0.75 | null => {
  if (!sideForHandle(handle)) return null;
  if (handle?.endsWith("-25")) return 0.25;
  if (handle?.endsWith("-75")) return 0.75;
  return null;
};

export const attachmentFromHandles = (
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): {
  sourceSide: AttachmentSide | null;
  targetSide: AttachmentSide | null;
  sourceAnchor: 0.25 | 0.75 | null;
  targetAnchor: 0.25 | 0.75 | null;
} => ({
  sourceSide: sideForHandle(sourceHandle),
  targetSide: sideForHandle(targetHandle),
  sourceAnchor: anchorForHandle(sourceHandle),
  targetAnchor: anchorForHandle(targetHandle),
});

/** Arc-length placement for the M/L/Q/C paths produced by React Flow. */
export function pointOnRelationshipPath(path: string, fraction: number): ControlPoint {
  const points: ControlPoint[] = [];
  let current = { x: 0, y: 0 };
  for (const match of path.matchAll(/([MLQC])([^MLQC]*)/g)) {
    const values = (match[2]?.match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    const command = match[1];
    if (command === "M" || command === "L") {
      current = { x: values[0] ?? current.x, y: values[1] ?? current.y };
      points.push(current);
    } else {
      const start = current;
      const end =
        command === "Q"
          ? { x: values[2] ?? start.x, y: values[3] ?? start.y }
          : { x: values[4] ?? start.x, y: values[5] ?? start.y };
      for (let step = 1; step <= 64; step++) {
        const t = step / 64;
        const u = 1 - t;
        current =
          command === "Q"
            ? {
                x: u * u * start.x + 2 * u * t * (values[0] ?? 0) + t * t * end.x,
                y: u * u * start.y + 2 * u * t * (values[1] ?? 0) + t * t * end.y,
              }
            : {
                x:
                  u ** 3 * start.x +
                  3 * u * u * t * (values[0] ?? 0) +
                  3 * u * t * t * (values[2] ?? 0) +
                  t ** 3 * end.x,
                y:
                  u ** 3 * start.y +
                  3 * u * u * t * (values[1] ?? 0) +
                  3 * u * t * t * (values[3] ?? 0) +
                  t ** 3 * end.y,
              };
        points.push(current);
      }
    }
  }
  const lengths = points.map((point, index) => {
    const previous = points[index - 1] ?? point;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  let remaining =
    lengths.reduce((sum, length) => sum + length, 0) * Math.min(1, Math.max(0, fraction));
  for (let index = 1; index < points.length; index++) {
    const length = lengths[index] ?? 0;
    const point = points[index];
    const previous = points[index - 1];
    if (!point || !previous) continue;
    if (remaining <= length && length > 0) {
      const ratio = remaining / length;
      return {
        x: previous.x + (point.x - previous.x) * ratio,
        y: previous.y + (point.y - previous.y) * ratio,
      };
    }
    remaining -= length;
  }
  return points.at(-1) ?? current;
}

/** Manual bends retain a short outward segment at each attachment. */
export function pathThroughControlPoints(
  source: ControlPoint,
  target: ControlPoint,
  sourceSide: Position,
  targetSide: Position,
  controlPoints: readonly ControlPoint[],
  orthogonal: boolean,
): string {
  const outward = (point: ControlPoint, side: Position): ControlPoint => ({
    x: point.x + (side === Position.Left ? -24 : side === Position.Right ? 24 : 0),
    y: point.y + (side === Position.Top ? -24 : side === Position.Bottom ? 24 : 0),
  });
  const points = [
    source,
    outward(source, sourceSide),
    ...controlPoints,
    outward(target, targetSide),
    target,
  ];
  const segments = [`M${source.x},${source.y}`];
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    const previous = points[index - 1];
    if (!point || !previous) continue;
    if (orthogonal && previous.x !== point.x && previous.y !== point.y) {
      // Approach the target stub from the perpendicular axis.
      const vertical =
        index === points.length - 2
          ? targetSide === Position.Left || targetSide === Position.Right
          : sourceSide === Position.Top || sourceSide === Position.Bottom;
      segments.push(vertical ? `L${previous.x},${point.y}` : `L${point.x},${previous.y}`);
    }
    segments.push(`L${point.x},${point.y}`);
  }
  return segments.join(" ");
}
