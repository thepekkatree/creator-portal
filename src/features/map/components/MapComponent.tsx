import { useEffect, useRef, useCallback, useState } from "react";
import type { Feature, GeoJSON, Polygon } from "geojson";
import mapboxgl from "mapbox-gl";
import { config } from "@config/env";
import { escapeHtml } from "@/utils/security";
import { addPoiOverlayLayers } from "@features/map/utils/poiOverlay";
import type { GeoPolygon } from "@/types";

// Set Mapbox token
mapboxgl.accessToken = config.mapbox.accessToken;

/** Location shape accepted for markers / map clicks (matches the waypoint schema). */
export interface MapMarkerLocation {
    latitude: number;
    longitude: number;
    place_name?: string;
    address?: string;
    city?: string;
    region?: string;
    country?: string;
}

// Light presets for Mapbox Standard
type LightPreset = "dawn" | "day" | "dusk" | "night";

// Fog configurations for each preset
const FOG_CONFIGS: Record<LightPreset, mapboxgl.FogSpecification> = {
    dawn: {
        color: "rgb(255, 200, 150)",
        "high-color": "rgb(255, 160, 100)",
        "horizon-blend": 0.08,
        "space-color": "rgb(40, 30, 50)",
        "star-intensity": 0.2,
    },
    day: {
        color: "rgb(220, 235, 255)",
        "high-color": "rgb(135, 206, 235)",
        "horizon-blend": 0.05,
    },
    dusk: {
        color: "rgb(255, 150, 120)",
        "high-color": "rgb(180, 100, 150)",
        "horizon-blend": 0.1,
        "space-color": "rgb(30, 20, 50)",
        "star-intensity": 0.4,
    },
    night: {
        color: "rgb(10, 20, 40)",
        "high-color": "rgb(5, 10, 30)",
        "horizon-blend": 0.12,
        "space-color": "rgb(0, 5, 15)",
        "star-intensity": 1.0,
    },
};

// Get time-based light preset
function getTimeBasedPreset(): LightPreset {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 7) return "dawn";
    if (hour >= 7 && hour < 18) return "day";
    if (hour >= 18 && hour < 20) return "dusk";
    return "night";
}

interface MapComponentProps {
    center?: { lng: number; lat: number };
    zoom?: number;
    markers?: MapMarkerLocation[];
    onMapClick?: (location: MapMarkerLocation) => void;
    onMarkerClick?: (location: MapMarkerLocation, index: number) => void;
    interactive?: boolean;
    height?: string;
    className?: string;
    /** Region boundary polygon to outline + fit on the map. */
    regionBbox?: GeoPolygon | null;
    /** Fired once the region boundary has actually been drawn + fit. */
    onRegionBboxDrawn?: () => void;
    /**
     * Informational preview: keeps the Mapbox Standard 3D look + day/dawn/dusk/night
     * light preset, but skips the heaviest extras (custom terrain DEM, POI-overlay
     * source, fog) and uses a gentler pitch so it loads fast.
     */
    preview?: boolean;
    /** Override the Mapbox style URL. */
    style?: string;
}

export function MapComponent({
    center = config.mapbox.defaultCenter,
    zoom = 17,
    markers = [],
    onMapClick,
    onMarkerClick,
    interactive = true,
    height = "400px",
    className = "",
    regionBbox = null,
    onRegionBboxDrawn,
    preview = false,
    style,
}: MapComponentProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef<mapboxgl.Marker[]>([]);
    // Bumped on every style.load so the region-bbox effect re-runs once the map
    // (which inits lazily) has a loaded style — makes the draw race-free.
    const [styleReady, setStyleReady] = useState(0);

    // Latest values for use inside one-shot listeners / lazy init.
    const onMapClickRef = useRef(onMapClick);
    useEffect(() => {
        onMapClickRef.current = onMapClick;
    }, [onMapClick]);

    const onRegionBboxDrawnRef = useRef(onRegionBboxDrawn);
    useEffect(() => {
        onRegionBboxDrawnRef.current = onRegionBboxDrawn;
    });

    // Draw (or update) the region boundary polygon and fit the view to it.
    const drawRegionBbox = useCallback(
        (map: mapboxgl.Map, polygon: GeoPolygon) => {
            const data: Feature = {
                type: "Feature",
                geometry: polygon as Polygon,
                properties: {},
            };
            const existing = map.getSource("region-bbox") as mapboxgl.GeoJSONSource | undefined;
            if (existing) {
                existing.setData(data as GeoJSON);
            } else {
                map.addSource("region-bbox", { type: "geojson", data: data as GeoJSON });
                // On the Mapbox Standard style, custom layers MUST declare a `slot`
                // or they get occluded by the basemap (and never appear). Fill sits
                // in `middle` (under labels); the outline in `top` so it's always
                // visible. `slot` is ignored harmlessly on non-Standard styles.
                map.addLayer({
                    id: "region-bbox-fill",
                    type: "fill",
                    slot: "middle",
                    source: "region-bbox",
                    paint: { "fill-color": "#1f6f6a", "fill-opacity": 0.1 },
                });
                map.addLayer({
                    id: "region-bbox-line",
                    type: "line",
                    slot: "top",
                    source: "region-bbox",
                    paint: {
                        "line-color": "#0d524e",
                        "line-width": 2.5,
                        "line-opacity": 0.9,
                        "line-dasharray": [2, 1.5],
                    },
                });
            }

            const ring = polygon?.coordinates?.[0];
            if (Array.isArray(ring) && ring.length) {
                const bounds = new mapboxgl.LngLatBounds();
                ring.forEach((c) => bounds.extend(c as [number, number]));
                map.fitBounds(bounds, {
                    padding: 50,
                    duration: 0,
                    pitch: preview ? 45 : 40,
                });
            }
            onRegionBboxDrawnRef.current?.();
        },
        [preview]
    );

    // Cleanup markers
    const clearMarkers = useCallback(() => {
        markersRef.current.forEach((marker) => marker.remove());
        markersRef.current = [];
    }, []);

    // Add markers to map
    const addMarkers = useCallback(() => {
        if (!mapRef.current) return;

        clearMarkers();

        markers.forEach((location, index) => {
            const el = document.createElement("div");
            el.className = "custom-marker";
            el.innerHTML = `
                <div class="relative group">
                    <div class="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center text-white font-bold shadow-xl border-3 border-white cursor-pointer transform hover:scale-110 transition-all duration-200 hover:shadow-2xl">
                        ${index + 1}
                    </div>
                    <div class="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-8 border-l-transparent border-r-transparent border-t-primary-700"></div>
                </div>
            `;

            const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
                .setLngLat([location.longitude, location.latitude])
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                .addTo(mapRef.current!);

            const popup = new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(`
                    <div class="p-2">
                        <p class="font-semibold text-sm">${escapeHtml(location.place_name ?? "") || "Location " + (index + 1)}</p>
                        ${location.address ? `<p class="text-xs text-gray-500">${escapeHtml(location.address)}</p>` : ""}
                    </div>
                `);
            marker.setPopup(popup);

            if (onMarkerClick) {
                el.addEventListener("click", (e) => {
                    e.stopPropagation();
                    onMarkerClick(location, index);
                });
            }

            markersRef.current.push(marker);
        });

        if (markers.length > 1 && mapRef.current) {
            const bounds = new mapboxgl.LngLatBounds();
            markers.forEach((loc) => bounds.extend([loc.longitude, loc.latitude]));
            mapRef.current.fitBounds(bounds, { padding: 80, duration: 1500, pitch: preview ? 0 : 60 });
        }
    }, [markers, onMarkerClick, clearMarkers, preview]);

    // Initialize map — lazily, once the container scrolls into view.
    useEffect(() => {
        const container = mapContainerRef.current;
        if (!container || mapRef.current) return;

        const initMap = () => {
            if (mapRef.current) return;
            const lightPreset = getTimeBasedPreset();
            // Always Mapbox Standard (3D + day/dawn/dusk/night light presets). The
            // `preview` flag keeps that look but skips the heaviest extras (custom
            // terrain DEM, POI-overlay source, fog) below to load fast.
            const styleUrl = style ?? config.mapbox.style;
            const usingStandard = styleUrl === config.mapbox.style;

            const map = new mapboxgl.Map({
                container,
                style: styleUrl,
                center: [center.lng, center.lat],
                zoom,
                pitch: preview ? 45 : 65,
                bearing: preview ? 0 : -17.6,
                interactive,
                antialias: true,
                maxPitch: 85,
                // The Standard-style `config` block is only valid on that style.
                ...(usingStandard
                    ? {
                          config: {
                              basemap: {
                                  lightPreset,
                                  // Declutter the region-boundary preview a little.
                                  showPointOfInterestLabels: !preview,
                                  showPlaceLabels: true,
                                  showRoadLabels: true,
                                  showTransitLabels: !preview,
                              },
                          },
                      }
                    : {}),
            });

            map.on("style.load", () => {
                // Heavy 3D layers only for the full (non-preview) map.
                if (!preview) {
                    if (!map.getSource("mapbox-dem")) {
                        map.addSource("mapbox-dem", {
                            type: "raster-dem",
                            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
                            tileSize: 512,
                            maxzoom: 14,
                        });
                    }
                    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.8 });
                    map.setFog(FOG_CONFIGS[lightPreset]);
                    addPoiOverlayLayers(map);
                }

                // The region-bbox effect draws once it sees this bump (race-free
                // across lazy-init / cached-region / StrictMode orderings).
                setStyleReady((n) => n + 1);
            });

            if (interactive) {
                map.addControl(
                    new mapboxgl.NavigationControl({
                        visualizePitch: !preview,
                        showCompass: !preview,
                        showZoom: true,
                    }),
                    "top-right"
                );
                map.addControl(new mapboxgl.FullscreenControl(), "top-right");
                // Geolocate + scale add tiles/requests — skip them in the light preview.
                if (!preview) {
                    map.addControl(
                        new mapboxgl.GeolocateControl({
                            positionOptions: { enableHighAccuracy: true },
                            trackUserLocation: true,
                            showUserHeading: true,
                            showAccuracyCircle: true,
                        }),
                        "top-right"
                    );
                    map.addControl(
                        new mapboxgl.ScaleControl({ maxWidth: 100, unit: "metric" }),
                        "bottom-left"
                    );
                }
            }

            map.on("click", async (e) => {
                const { lng, lat } = e.lngLat;
                const rippleEl = document.createElement("div");
                rippleEl.innerHTML = `<div class="w-8 h-8 rounded-full bg-primary-500/50 animate-ping"></div>`;
                const rippleMarker = new mapboxgl.Marker({ element: rippleEl })
                    .setLngLat([lng, lat])
                    .addTo(map);
                setTimeout(() => rippleMarker.remove(), 600);

                if (onMapClickRef.current) {
                    try {
                        const response = await fetch(
                            `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${config.mapbox.accessToken}`
                        );
                        const data = await response.json();
                        const place = data.features?.[0];
                        onMapClickRef.current({
                            longitude: lng,
                            latitude: lat,
                            place_name: place?.place_name ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                            address: place?.properties?.address,
                            city: place?.context?.find((c: { id: string }) => c.id.startsWith("place"))?.text,
                            region: place?.context?.find((c: { id: string }) => c.id.startsWith("region"))?.text,
                            country: place?.context?.find((c: { id: string }) => c.id.startsWith("country"))?.text,
                        });
                    } catch {
                        onMapClickRef.current({
                            longitude: lng,
                            latitude: lat,
                            place_name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                        });
                    }
                }
            });

            map.on("dblclick", (e) => {
                e.preventDefault();
                map.flyTo({
                    center: e.lngLat,
                    zoom: map.getZoom() + 1.5,
                    bearing: map.getBearing() + 15,
                    duration: 800,
                });
            });

            mapRef.current = map;
        };

        let observer: IntersectionObserver | null = null;
        if (typeof IntersectionObserver !== "undefined") {
            observer = new IntersectionObserver(
                (entries) => {
                    if (entries.some((en) => en.isIntersecting)) {
                        observer?.disconnect();
                        initMap();
                    }
                },
                { rootMargin: "200px" }
            );
            observer.observe(container);
        } else {
            initMap();
        }

        return () => {
            observer?.disconnect();
            clearMarkers();
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
        // Init is one-shot; dynamic props are handled by the effects below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Recenter when center/zoom change — but let an explicit regionBbox own the view.
    useEffect(() => {
        if (!mapRef.current || regionBbox) return;
        mapRef.current.flyTo({
            center: [center.lng, center.lat],
            zoom,
            speed: 1.2,
            curve: 1.42,
            essential: true,
        });
    }, [center.lng, center.lat, zoom, regionBbox]);

    // Draw/update the region boundary. Runs whenever the bbox OR the map's
    // style-ready signal changes, so it converges no matter which arrives first
    // (cached region before lazy map-init, or map before region fetch resolves).
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !regionBbox || !styleReady) return;
        // styleReady>0 ⇒ style.load already fired, so it's safe to add layers.
        // (Don't gate on map.isStyleLoaded() — it can transiently report false
        // right after style.load and would skip the draw with no retry.)
        try {
            drawRegionBbox(map, regionBbox);
        } catch (e) {
            console.warn("[MapComponent] region boundary draw failed:", e);
        }
    }, [regionBbox, styleReady, drawRegionBbox]);

    // Add/refresh markers when they change AND once the map's style is ready.
    // The map inits lazily (IntersectionObserver), so on first render mapRef is
    // still null; without the styleReady dependency a static marker set (e.g. the
    // marker detail page) would never get drawn because addMarkers's identity
    // doesn't change after init. styleReady bumps on style.load → re-runs this.
    useEffect(() => {
        if (mapRef.current) addMarkers();
    }, [addMarkers, styleReady]);

    return (
        <div className="relative group">
            <div
                ref={mapContainerRef}
                className={`rounded-xl overflow-hidden shadow-2xl ${className}`}
                style={{ height }}
                aria-label="Interactive map"
            />

            {interactive && !preview && (
                <div className="absolute bottom-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur text-white text-xs px-3 py-2 rounded-lg">
                    <div className="flex flex-col gap-1">
                        <span>🖱️ Scroll to zoom</span>
                        <span>🔄 Right-drag to rotate</span>
                        <span>⬆️ Ctrl+drag to tilt</span>
                    </div>
                </div>
            )}
        </div>
    );
}
