import { checkInKommune } from "../kommune.js";
import { API } from "../paths.js";
import { fetchJson } from "./http.js";
import { normalizeVenueName, scoreName } from "./match.js";
import type { GeoProvider, GeoResult } from "../geocode.js";
import type { KommuneGeometryFile, Venue } from "../schema.js";

/**
 * Kartverket: the address register first, then the place-name register.
 *
 * Both are keyless and authoritative for Norway, but they answer different questions than
 * "where is this pub". An address hit is the best coordinate we can get; a place-name hit
 * is a nearby named feature, which is worth something but never a "high" confidence.
 */

interface AdresseResponse {
  adresser?: Array<{
    adressetekst: string;
    kommunenummer: string;
    representasjonspunkt?: { lat: number; lon: number };
  }>;
}

interface StedsnavnResponse {
  navn?: Array<{
    skrivemåte: string;
    navneobjekttype?: string;
    kommuner?: Array<{ kommunenummer: string; kommunenavn: string }>;
    representasjonspunkt?: { nord: number; øst: number };
  }>;
}

/** Street-address shapes that are worth sending to the address register. */
const ADDRESS_IN_TEXT =
  /\b([A-ZÆØÅ][\wÆØÅæøå'-]+(?:vei|veien|vn|gate|gaten|gata|gt|plass|plassen|torg|torget|brygge|brygga|kaia|kai|bakken|stredet|alle|allé)[\wÆØÅæøå'-]*)\s+(\d{1,4}\s*[A-Za-z]?)\b/;

/**
 * Pulls an address out of the raw venue text when the phase-1 cleaner did not already do
 * it. The cleaner only looks at parenthesised or second-line qualifiers, so an address
 * sitting inline in the name still ends up here.
 */
export function extractAddress(venue: Venue): string | null {
  if (venue.addressHint) return venue.addressHint;
  const match = ADDRESS_IN_TEXT.exec(venue.rawName.replace(/\s+/g, " "));
  return match ? `${match[1]} ${match[2]}`.replace(/\s+/g, " ").trim() : null;
}

export interface KartverketOptions {
  geometry: KommuneGeometryFile | null;
  log?: (message: string) => void;
  fetchAddress?: (query: string, kommuneNr: string) => Promise<AdresseResponse>;
  fetchPlace?: (query: string) => Promise<StedsnavnResponse>;
}

async function defaultFetchAddress(query: string, kommuneNr: string): Promise<AdresseResponse> {
  const url =
    `${API.adresse}/sok?sok=${encodeURIComponent(query)}` +
    `&kommunenummer=${kommuneNr}&treffPerSide=5&utkoordsys=4258`;
  return fetchJson<AdresseResponse>(url);
}

async function defaultFetchPlace(query: string): Promise<StedsnavnResponse> {
  const url =
    `${API.stedsnavn}/navn?sok=${encodeURIComponent(query)}` +
    `&treffPerSide=25&utkoordsys=4258&fuzzy=false`;
  return fetchJson<StedsnavnResponse>(url);
}

/** Kartverket Adresse. Only ever runs for venues that actually have an address. */
export class AddressProvider implements GeoProvider {
  readonly name = "address" as const;

  constructor(private readonly options: KartverketOptions) {}

  async lookup(venue: Venue): Promise<GeoResult | null> {
    if (!venue.kommuneNr) return null;
    const address = extractAddress(venue);
    if (!address) return null;

    const fetchAddress = this.options.fetchAddress ?? defaultFetchAddress;
    let payload: AdresseResponse;
    try {
      payload = await fetchAddress(address, venue.kommuneNr);
    } catch (error) {
      this.options.log?.(
        `  Adressesok feilet for ${venue.id}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }

    for (const hit of payload.adresser ?? []) {
      const point = hit.representasjonspunkt;
      if (!point) continue;
      if (hit.kommunenummer !== venue.kommuneNr) continue;
      if (checkInKommune(point.lat, point.lon, venue.kommuneNr, this.options.geometry) !== "inside") {
        continue;
      }
      return {
        lat: point.lat,
        lon: point.lon,
        geoSource: "address",
        geoConfidence: "high",
      };
    }

    return null;
  }
}

/**
 * Kartverket Stedsnavn.
 *
 * A place name is not the venue, it is a named feature that happens to share the name, so
 * this only ever accepts an exact name match and never claims better than medium
 * confidence. Fuzzy matches are rejected outright: "Bølgen" versus "Bølgeplassen" in the
 * same kommune is a coin flip, and a coin flip is worse than an empty map pin.
 */
export class PlaceNameProvider implements GeoProvider {
  readonly name = "kartverket" as const;

  constructor(private readonly options: KartverketOptions) {}

  async lookup(venue: Venue): Promise<GeoResult | null> {
    if (!venue.kommuneNr) return null;

    const query = normalizeVenueName(venue.name).trim();
    if (query.length < 4) return null;

    const fetchPlace = this.options.fetchPlace ?? defaultFetchPlace;
    let payload: StedsnavnResponse;
    try {
      payload = await fetchPlace(venue.name);
    } catch (error) {
      this.options.log?.(
        `  Stedsnavnsok feilet for ${venue.id}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }

    for (const hit of payload.navn ?? []) {
      const point = hit.representasjonspunkt;
      if (!point) continue;
      if (!hit.kommuner?.some((k) => k.kommunenummer === venue.kommuneNr)) continue;

      const match = scoreName(venue.name, hit.skrivemåte);
      if (!match || match.kind !== "exact") continue;

      if (
        checkInKommune(point.nord, point.øst, venue.kommuneNr, this.options.geometry) !== "inside"
      ) {
        continue;
      }

      return {
        lat: point.nord,
        lon: point.øst,
        geoSource: "kartverket",
        geoConfidence: "medium",
      };
    }

    return null;
  }
}
