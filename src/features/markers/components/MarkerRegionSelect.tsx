import React, { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, MapPinned } from "lucide-react";
import { regionService } from "@services/region.service";

interface MarkerRegionSelectProps {
    /** Selected region id. */
    value: string;
    onChange: (regionId: string) => void;
}

/**
 * Searchable region picker backed by the SeekKrr region search endpoint
 * (GET /api/v2/regions/search). The region is auto-assigned from the marker's
 * pin on the backend; this picker is a manual override to attach a different
 * existing region. There is no "clear" option — a marker is always tied to the
 * region its coordinates fall in.
 */
export function MarkerRegionSelect({ value, onChange }: MarkerRegionSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    // The search endpoint requires a non-empty query (returns 422 for q=""),
    // so only fetch once the user has typed something.
    const trimmed = search.trim();
    const { data, isLoading } = useQuery({
        queryKey: ["marker-region-search", trimmed],
        queryFn: () => regionService.searchRegions(trimmed, { page_size: 20 }),
        enabled: isOpen && trimmed.length > 0,
        staleTime: 30_000,
    });

    const regions = data?.items ?? [];
    const selectedInList = regions.find((r) => r.id === value);

    // The selected region may not be in the current search page (esp. on edit
    // prefill) — fetch it by id for the display label.
    const { data: selectedRegion } = useQuery({
        queryKey: ["region", value],
        queryFn: () => regionService.getRegion(value),
        enabled: !!value && !selectedInList,
        staleTime: 60_000,
    });

    const displayName = selectedInList?.name ?? selectedRegion?.name;

    useEffect(() => {
        const handleOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, []);

    const handleSelect = (regionId: string) => {
        onChange(regionId);
        setIsOpen(false);
        setSearch("");
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <button
                type="button"
                onClick={() => setIsOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-white border border-neutral-300 rounded-lg text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500"
            >
                <span className={`flex items-center gap-2 text-sm ${value ? "text-neutral-900" : "text-neutral-400"}`}>
                    {value ? (
                        <>
                            <MapPinned className="w-4 h-4 text-primary-500 shrink-0" />
                            <span className="truncate">{displayName ?? "Loading region…"}</span>
                        </>
                    ) : (
                        "Auto-detected from the pin — search to override"
                    )}
                </span>
                <ChevronDown className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

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
                                placeholder="Search SeekKrr regions…"
                                className="w-full pl-9 pr-4 py-2 text-sm bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
                            />
                        </div>
                    </div>
                    <ul className="max-h-52 overflow-y-auto py-1">
                        {isLoading ? (
                            <li className="px-4 py-3 text-sm text-neutral-500 text-center">Loading…</li>
                        ) : regions.length === 0 ? (
                            <li className="px-4 py-3 text-sm text-neutral-500 text-center">
                                {search ? "No regions found" : "Type to search regions"}
                            </li>
                        ) : (
                            regions.map((region) => (
                                <li key={region.id}>
                                    <button
                                        type="button"
                                        onClick={() => handleSelect(region.id)}
                                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-primary-50 transition-colors ${region.id === value ? "bg-primary-50 text-primary-700 font-medium" : "text-neutral-700"}`}
                                    >
                                        <MapPinned className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                                        <span className="truncate">{region.name}</span>
                                        <span className="ml-auto text-xs text-neutral-400 shrink-0 capitalize">{region.type}</span>
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
