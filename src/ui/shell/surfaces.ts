/**
 * SurfaceManager implementation: one open surface per group on desktop, one
 * at a time on phones, and an open-order stack for Escape.
 */
import type { Surface, SurfaceManager } from '../context';

export function createSurfaceManager(isPhone: () => boolean): SurfaceManager {
  const surfaces = new Map<string, Surface>();
  /** Open ids, oldest first. */
  let order: string[] = [];

  const prune = () => {
    order = order.filter((id) => surfaces.get(id)?.isOpen() === true);
  };

  return {
    register(surface) {
      surfaces.set(surface.id, surface);
      if (surface.isOpen() && !order.includes(surface.id)) order.push(surface.id);
      return () => {
        if (surfaces.get(surface.id) === surface) surfaces.delete(surface.id);
        order = order.filter((id) => id !== surface.id);
      };
    },
    opened(id) {
      const surface = surfaces.get(id);
      order = order.filter((other) => other !== id);
      order.push(id);
      if (!surface) return;
      const phone = isPhone();
      for (const other of surfaces.values()) {
        if (other.id === id || !other.isOpen()) continue;
        if (phone || other.group === surface.group) other.close();
      }
      prune();
      if (!order.includes(id)) order.push(id);
    },
    closed(id) {
      order = order.filter((other) => other !== id);
    },
    closeTop() {
      prune();
      const top = order[order.length - 1];
      if (top === undefined) return false;
      surfaces.get(top)?.close();
      order = order.filter((id) => id !== top);
      return true;
    },
    openIds() {
      prune();
      return [...order];
    },
  };
}
