import type { Position } from "../schema.js";

/**
 * Plane geometry for coordinates.
 *
 * Norway is narrow enough in longitude that an equirectangular projection around a local
 * latitude is accurate to well under a percent at the distances we care about (metres to
 * a few kilometres), so everything here works in a local metre plane rather than pulling
 * in a projection library.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_M = (Math.PI / 180) * EARTH_RADIUS_M;

/** Metres per degree of longitude at the given latitude. */
export function metresPerLon(latitude: number): number {
  return DEG_TO_M * Math.cos((latitude * Math.PI) / 180);
}

/** Great-circle distance in metres. */
export function haversineMeters(a: Position, b: Position): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Distance in metres from a point to the segment ab. */
export function distanceToSegmentMeters(point: Position, a: Position, b: Position): number {
  const scale = metresPerLon(point[1]);
  const px = point[0] * scale;
  const py = point[1] * DEG_TO_M;
  const ax = a[0] * scale;
  const ay = a[1] * DEG_TO_M;
  const bx = b[0] * scale;
  const by = b[1] * DEG_TO_M;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ray casting. Points exactly on an edge are undefined by this test, which is why callers
 * pair it with a distance tolerance rather than relying on it alone at the boundary.
 */
export function pointInRing(point: Position, ring: Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** A polygon is its outer ring minus any hole rings that follow it. */
export function pointInPolygon(point: Position, polygon: Position[][]): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

export function pointInMultiPolygon(point: Position, polygons: Position[][][]): boolean {
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

/** Shortest distance in metres from a point to any ring edge of a multipolygon. */
export function distanceToMultiPolygonMeters(
  point: Position,
  polygons: Position[][][],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const a = ring[i];
        const b = ring[j];
        if (!a || !b) continue;
        const distance = distanceToSegmentMeters(point, a, b);
        if (distance < best) best = distance;
      }
    }
  }
  return best;
}

export type BBox = [number, number, number, number];

export function bboxOf(polygons: Position[][][]): BBox {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function bboxContains(bbox: BBox, point: Position, paddingDegrees = 0): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const [lon, lat] = point;
  return (
    lon >= minLon - paddingDegrees &&
    lon <= maxLon + paddingDegrees &&
    lat >= minLat - paddingDegrees &&
    lat <= maxLat + paddingDegrees
  );
}

/**
 * Douglas-Peucker, with the tolerance expressed in metres.
 *
 * Kartverket's kommune outlines follow every skerry and are ~250 kB per kommune. We only
 * need them to answer "is this pub in the right town", so a couple of hundred metres of
 * slack costs nothing and shrinks the committed file by two orders of magnitude.
 */
export function simplifyRing(ring: Position[], toleranceMeters: number): Position[] {
  if (ring.length <= 4) return ring;

  // Rings are closed; simplify the open path and close it again afterwards.
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed =
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1];
  const path = closed ? ring.slice(0, -1) : ring;
  if (path.length <= 3) return ring;

  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, path.length - 1]];
  while (stack.length > 0) {
    const range = stack.pop();
    if (!range) break;
    const [start, end] = range;
    if (end - start < 2) continue;
    const a = path[start];
    const b = path[end];
    if (!a || !b) continue;

    let farthest = -1;
    let farthestDistance = 0;
    for (let i = start + 1; i < end; i += 1) {
      const p = path[i];
      if (!p) continue;
      const distance = distanceToSegmentMeters(p, a, b);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = i;
      }
    }

    if (farthest !== -1 && farthestDistance > toleranceMeters) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  const simplified = path.filter((_, index) => keep[index] === 1);
  // A ring needs at least three distinct points to enclose anything; below that the shape
  // has been simplified out of existence and the original is kept instead.
  if (simplified.length < 3) return ring;
  const head = simplified[0];
  if (head) simplified.push([head[0], head[1]]);
  return simplified;
}

/** Rounds to ~1 m precision so the committed geometry file stays small and diffable. */
export function roundRing(ring: Position[], decimals = 5): Position[] {
  const factor = 10 ** decimals;
  return ring.map(([lon, lat]) => [
    Math.round(lon * factor) / factor,
    Math.round(lat * factor) / factor,
  ]);
}
