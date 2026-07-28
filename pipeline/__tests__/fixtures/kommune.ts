import type { KommuneGeometryFile, KommuneList } from "../../schema.js";

/**
 * Committed fixtures for the kommune tests. Nothing here hits the network: these are
 * hand-trimmed copies of the shapes Kartverket returns, small enough to read.
 */

export const KOMMUNE_FIXTURE: KommuneList = {
  fetchedAt: "2026-07-28T00:00:00.000Z",
  source: "fixture",
  fylker: [
    { nr: "18", navn: "Nordland" },
    { nr: "21", navn: "Svalbard" },
    { nr: "31", navn: "Østfold" },
    { nr: "34", navn: "Innlandet" },
    { nr: "55", navn: "Troms" },
  ],
  kommuner: [
    { nr: "1870", navn: "Sortland - Suortá", fylkeNr: "18", fylkeNavn: "Nordland" },
    // Kartverket returns only the Sami name for this kommune.
    { nr: "1875", navn: "Hábmer", fylkeNr: "18", fylkeNavn: "Nordland" },
    { nr: "2100", navn: "Svalbard", fylkeNr: "21", fylkeNavn: "Svalbard" },
    { nr: "3103", navn: "Moss", fylkeNr: "31", fylkeNavn: "Østfold" },
    { nr: "3105", navn: "Sarpsborg", fylkeNr: "31", fylkeNavn: "Østfold" },
    // Two kommuner really are called Våler, which is why an exact match is not enough.
    { nr: "3114", navn: "Våler", fylkeNr: "31", fylkeNavn: "Østfold" },
    { nr: "3419", navn: "Våler", fylkeNr: "34", fylkeNavn: "Innlandet" },
    { nr: "5501", navn: "Tromsø", fylkeNr: "55", fylkeNavn: "Troms" },
  ],
};

/** A rectangle standing in for Sarpsborg, with a hole so the ring logic is exercised. */
export const GEOMETRY_FIXTURE: KommuneGeometryFile = {
  fetchedAt: "2026-07-28T00:00:00.000Z",
  source: "fixture",
  simplifyToleranceMeters: 200,
  kommuner: {
    "3105": {
      navn: "Sarpsborg",
      bbox: [10.95, 59.09, 11.35, 59.4],
      center: [11.2298, 59.255],
      polygons: [
        [
          [
            [10.95, 59.09],
            [11.35, 59.09],
            [11.35, 59.4],
            [10.95, 59.4],
            [10.95, 59.09],
          ],
          [
            [10.98, 59.3],
            [11.12, 59.3],
            [11.12, 59.38],
            [10.98, 59.38],
            [10.98, 59.3],
          ],
        ],
      ],
    },
  },
};
