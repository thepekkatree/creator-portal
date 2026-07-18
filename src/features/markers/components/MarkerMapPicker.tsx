import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { MapComponent } from "@features/map/components/MapComponent";
import { LocationSearch } from "@features/map/components/LocationSearch";
import type { LocationSearchResult } from "@features/map/components/LocationSearch";
import type { MapMarkerLocation } from "@features/map/components/MapComponent";
import { config } from "@config/env";

export interface LngLat {
    lng: number;
    lat: number;
}

/** What we learned about the place under the pin. All fields best-effort. */
export interface ResolvedPlace {
    place_name?: string;
    address?: string;
    category?: string;
}

interface MarkerMapPickerProps {
    value: LngLat | null;
    onChange: (lngLat: LngLat) => void;
    /**
     * Fired whenever we can name the place under the pin — on search-select
     * (Mapbox already told us) and after reverse-geocoding a map click. The
     * form uses this to prefill title/address/category so the creator doesn't
     * retype what Mapbox already knows.
     */
    onPlace?: (place: ResolvedPlace) => void;
    /**
     * Preferred center for the map when no pin has been placed yet.
     * Falls back to the MapComponent default (Bangalore) when undefined.
     */
    defaultCenter?: LngLat;
}

/**
 * Reverse-geocode a dropped pin into a street address.
 * Returns null on any failure — autofill is a convenience, never a blocker.
 */
async function reverseGeocode(lng: number, lat: number): Promise<ResolvedPlace | null> {
    try {
        const params = new URLSearchParams({
            longitude: String(lng),
            latitude: String(lat),
            access_token: config.mapbox.accessToken,
            language: "en",
            limit: "1",
        });
        const res = await fetch(
            `https://api.mapbox.com/search/geocode/v6/reverse?${params.toString()}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        const props = data?.features?.[0]?.properties;
        if (!props) return null;
        return {
            place_name: props.name,
            address: props.full_address || props.place_formatted,
        };
    } catch {
        return null;
    }
}

/**
 * Presentational map picker.
 * - Click anywhere on the map → places a single pin, calls onChange, then
 *   reverse-geocodes to fill in the address.
 * - Search selects a location → centers the map + places a pin, and passes
 *   through the name/address/category Mapbox already returned.
 * - When no value is set, centers on `defaultCenter` if provided.
 */
export function MarkerMapPicker({ value, onChange, onPlace, defaultCenter }: MarkerMapPickerProps) {
    const [resolving, setResolving] = useState(false);

    const handleMapClick = useCallback(
        async (loc: MapMarkerLocation) => {
            onChange({ lng: loc.longitude, lat: loc.latitude });
            if (!onPlace) return;
            setResolving(true);
            try {
                const place = await reverseGeocode(loc.longitude, loc.latitude);
                if (place) onPlace(place);
            } finally {
                setResolving(false);
            }
        },
        [onChange, onPlace]
    );

    const handleSearchSelect = useCallback(
        (loc: LocationSearchResult) => {
            onChange({ lng: loc.longitude, lat: loc.latitude });
            onPlace?.({
                place_name: loc.place_name,
                address: loc.address,
                category: loc.category,
            });
        },
        [onChange, onPlace]
    );

    const markers: MapMarkerLocation[] = value
        ? [{ longitude: value.lng, latitude: value.lat }]
        : [];

    // Pin position drives the center when set; otherwise use caller-supplied
    // defaultCenter (creator's region) or let MapComponent fall back to Bangalore.
    const center = value ?? defaultCenter;

    return (
        <div className="space-y-2">
            <LocationSearch
                onSelect={handleSearchSelect}
                placeholder="Search a place — we'll fill in the name, address and map link…"
                proximity={value ?? undefined}
            />
            <MapComponent
                center={center}
                zoom={15}
                markers={markers}
                onMapClick={handleMapClick}
                interactive={true}
                height="280px"
                preview={false}
            />
            {resolving ? (
                <p className="text-xs text-neutral-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Looking up the address…
                </p>
            ) : value ? (
                <p className="text-xs text-neutral-500">
                    Pin at {value.lat.toFixed(5)}, {value.lng.toFixed(5)} — click the map to move it.
                </p>
            ) : (
                <p className="text-xs text-amber-600">
                    Search above or click the map to place a pin.
                </p>
            )}
        </div>
    );
}
