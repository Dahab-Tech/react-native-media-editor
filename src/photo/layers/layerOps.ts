import { DUPLICATE_OFFSET, type PhotoLayer } from './types';

export type ReorderDirection = 'bringForward' | 'sendBackward' | 'bringToFront' | 'sendToBack';

/** Array order = z-order (last = topmost). Returns the original ref when it's a no-op. */
export function reorderLayer<L>(
  list: readonly L[],
  index: number,
  direction: ReorderDirection
): L[] | readonly L[] {
  if (index < 0 || index >= list.length) return list;
  const last = list.length - 1;
  const target = (() => {
    switch (direction) {
      case 'bringForward':
        return Math.min(index + 1, last);
      case 'sendBackward':
        return Math.max(index - 1, 0);
      case 'bringToFront':
        return last;
      case 'sendToBack':
        return 0;
    }
  })();
  if (target === index) return list;
  const next = list.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function duplicateLayer(layer: PhotoLayer): PhotoLayer {
  const nextId = generateLayerId();
  const nextX = clamp01(layer.x + DUPLICATE_OFFSET);
  const nextY = clamp01(layer.y + DUPLICATE_OFFSET);
  return { ...layer, id: nextId, x: nextX, y: nextY };
}

export function generateLayerId(): string {
  return `l_${Date.now().toString(36)}_${Math.floor(Math.random() * 1_000_000).toString(36)}`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
