import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, MapPin } from "lucide-react";
import { markerService } from "@services/marker.service";
import type { Marker } from "@/types";

interface MarkerSelectProps {
    value: string;
    onChange: (markerId: string) => void;
    disabled?: boolean;
    error?: string;
}

export function MarkerSelect({ value, onChange, disabled = false, error }: MarkerSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    const { data, isLoading } = useQuery({
        queryKey: ["my-markers", search],
        queryFn: () => markerService.listMarkers({ mine: true, search: search || undefined, page_size: 50 }),
        staleTime: 30_000,
    });

    const markers = data?.items ?? [];

    // Find the currently selected marker for display
    const selectedMarker = markers.find((m) => m.id === value);
    // If search is active we might not have the selected marker in the list; fetch it separately
    const { data: selectedData } = useQuery({
        queryKey: ["marker", value],
        queryFn: () => markerService.getMarker(value),
        enabled: !!value && !selectedMarker,
        staleTime: 60_000,
    });
    const displayMarker: Marker | undefined = selectedMarker ?? selectedData;

    useEffect(() => {
        const handleOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, []);

    const handleSelect = (markerId: string) => {
        onChange(markerId);
        setIsOpen(false);
        setSearch("");
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">Marker</label>
            <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setIsOpen((o) => !o)}
                className={`
                    w-full flex items-center justify-between px-4 py-2.5
                    bg-white border rounded-lg text-left
                    transition-colors duration-150
                    focus:outline-none focus:ring-2 focus:ring-offset-0
                    disabled:bg-neutral-100 disabled:cursor-not-allowed
                    ${error
                        ? "border-red-500 focus:border-red-500 focus:ring-red-200"
                        : "border-neutral-300 focus:border-primary-500 focus:ring-primary-200"
                    }
                `}
            >
                <span className={`flex items-center gap-2 text-sm ${displayMarker ? "text-neutral-900" : "text-neutral-400"}`}>
                    {displayMarker ? (
                        <>
                            <MapPin className="w-4 h-4 text-primary-500 shrink-0" />
                            <span className="truncate">{displayMarker.title}</span>
                        </>
                    ) : value ? (
                        <span className="text-neutral-500">Loading marker...</span>
                    ) : (
                        "Select a marker"
                    )}
                </span>
                <ChevronDown className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {error && (
                <p className="mt-1.5 text-sm text-red-600" role="alert">{error}</p>
            )}

            {isOpen && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-neutral-200 rounded-xl shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-neutral-100">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                            <input
                                autoFocus
                                type="text"
                                value={search}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                                placeholder="Search markers..."
                                className="w-full pl-9 pr-4 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
                            />
                        </div>
                    </div>
                    <ul className="max-h-52 overflow-y-auto py-1">
                        {isLoading ? (
                            <li className="px-4 py-3 text-sm text-neutral-500 text-center">Loading...</li>
                        ) : markers.length === 0 ? (
                            <li className="px-4 py-3 text-sm text-neutral-500 text-center">No markers found</li>
                        ) : (
                            markers.map((marker) => (
                                <li key={marker.id}>
                                    <button
                                        type="button"
                                        onClick={() => handleSelect(marker.id)}
                                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-primary-50 transition-colors
                                            ${marker.id === value ? "bg-primary-50 text-primary-700 font-medium" : "text-neutral-700"}
                                        `}
                                    >
                                        <MapPin className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                                        <span className="truncate">{marker.title}</span>
                                        {(marker.categories && marker.categories.length > 0) && (
                                            <span className="ml-auto text-xs text-neutral-400 shrink-0">{marker.categories.join(", ")}</span>
                                        )}
                                    </button>
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}
