import { elementsToCandidates } from "../../geo/overpass.js";

/**
 * Trimmed Overpass responses, committed so the tests never touch the network.
 * Coordinates are real, which is what makes the wrong-kommune case meaningful.
 */

export const OSM_POOL_SARPSBORG = elementsToCandidates([
  {
    type: "node",
    id: 1,
    lat: 59.28389,
    lon: 11.10943,
    tags: { name: "Dickens", amenity: "pub" },
  },
  {
    type: "way",
    id: 2,
    center: { lat: 59.2801, lon: 11.1101 },
    tags: { name: "Bølgen", amenity: "bar" },
  },
  {
    type: "node",
    id: 3,
    lat: 59.279,
    lon: 11.115,
    tags: { name: "Bakeriet", amenity: "cafe" },
  },
]);

/**
 * Trondheim's Samfundet, as a bounding box around a different kommune could plausibly
 * drag it in. The name is a perfect match and the coordinate is 400 km wrong.
 */
export const OSM_POOL_TRONDHEIM = elementsToCandidates([
  {
    type: "way",
    id: 10,
    center: { lat: 63.42244, lon: 10.39543 },
    tags: { name: "Samfundet", amenity: "nightclub" },
  },
]);
