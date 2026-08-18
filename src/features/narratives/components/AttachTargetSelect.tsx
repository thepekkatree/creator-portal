import React, { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MapPin, Map } from "lucide-react";
import { narrativeService } from "@services/narrative.service";
import { markerService } from "@services/marker.service";
import { questService } from "@services/quest.service";
import type { NarrativeAttachType } from "@/types";

export interface AttachSelection {
    attach_type: NarrativeAttachType;
    attach_id: string;
    label: string;
}

interface AttachTargetSelectProps {
    value: AttachSelection | null;
    onChange: (sel: AttachSelection) => void;
    disabled?: boolean;
    error?: string;
}

export function AttachTargetSelect({
    value,
    onChange,
    disabled = false,
    error,
}: AttachTargetSelectProps) {
    const [tab, setTab] = useState<"marker" | "quest">(
        value?.attach_type === "quest" ? "quest" : "marker"
    );
    const [search, setSearch] = useState("");
    const [summaryNotice, setSummaryNotice] = useState<string | null>(null);

    // Open by default only when there is no prior selection. When a value is
    // already set (edit mode prefill) the picker starts collapsed.
    const [isOpen, setIsOpen] = useState(!value);

    const containerRef = useRef<HTMLDivElement>(null);

    // Outside-click closes the picker.
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Escape key closes the picker.
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape") setIsOpen(false);
    }, []);
    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    const { data: markersData, isLoading: loadingMarkers } = useQuery({
        queryKey: ["creator-markers-picker", search],
        queryFn: () => markerService.listMarkers({ mine: true, search: search || undefined }),
        enabled: isOpen && tab === "marker" && !disabled,
    });

    const { data: questsData, isLoading: loadingQuests } = useQuery({
        queryKey: ["creator-quests-picker"],
        queryFn: () => questService.getMyQuests({}),
        enabled: isOpen && tab === "quest" && !disabled,
    });

    const handleSelect = async (attachType: NarrativeAttachType, attachId: string, label: string) => {
        onChange({ attach_type: attachType, attach_id: attachId, label });
        setIsOpen(false);
        setSearch("");
        setSummaryNotice(null);
        try {
            const summary = await narrativeService.getAttachSummary(attachType, attachId);
            const count = typeof summary.active_count === "number" ? summary.active_count : 0;
            if (count > 0) {
                setSummaryNotice(
                    `This target already has ${count} narrative(s); the new one will be added with the next sequence order.`
                );
            }
        } catch {
            // non-critical — ignore summary fetch failures
        }
    };

    const handleChange = () => {
        setIsOpen(true);
        setSummaryNotice(null);
    };

    const markers = markersData?.items ?? [];
    const quests = questsData?.items ?? [];

    return (
        <div ref={containerRef} className="w-full space-y-2">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Attach To
            </label>

            {/* ── Disabled (edit) mode: immutable display ── */}
            {disabled && value && (
                <div className="px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm text-neutral-700">
                    <span className="font-medium capitalize">{value.attach_type}:</span>{" "}
                    {value.label}
                    <span className="ml-2 text-xs text-neutral-400">(immutable)</span>
                </div>
            )}

            {/* ── Collapsed: selection chip with "Change" button ── */}
            {!disabled && !isOpen && value && (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50/60 px-4 py-3">
                    <span className="flex-shrink-0 w-9 h-9 rounded-lg bg-green-100 text-green-700 flex items-center justify-center">
                        <CheckCircle2 className="w-5 h-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-neutral-900 truncate">{value.label}</p>
                        <p className="text-xs text-neutral-500 flex items-center gap-1">
                            {value.attach_type === "marker" ? (
                                <MapPin className="w-3 h-3" />
                            ) : (
                                <Map className="w-3 h-3" />
                            )}
                            <span className="capitalize">{value.attach_type}</span> · attached
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleChange}
                        className="flex-shrink-0 text-xs font-medium text-neutral-500 hover:text-neutral-800 underline-offset-2 hover:underline"
                    >
                        Change
                    </button>
                </div>
            )}

            {/* ── Open: tab + search + list ── */}
            {!disabled && isOpen && (
                <>
                    {/* Segmented toggle */}
                    <div className="flex rounded-lg border border-neutral-200 p-0.5 bg-neutral-50 w-fit">
                        <button
                            type="button"
                            onClick={() => { setTab("marker"); setSearch(""); setSummaryNotice(null); }}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                tab === "marker"
                                    ? "bg-white text-primary-700 shadow-sm border border-neutral-200"
                                    : "text-neutral-600 hover:text-neutral-900"
                            }`}
                        >
                            Marker
                        </button>
                        <button
                            type="button"
                            onClick={() => { setTab("quest"); setSearch(""); setSummaryNotice(null); }}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                                tab === "quest"
                                    ? "bg-white text-primary-700 shadow-sm border border-neutral-200"
                                    : "text-neutral-600 hover:text-neutral-900"
                            }`}
                        >
                            Quest
                        </button>
                    </div>

                    {/* Search (markers only) */}
                    {tab === "marker" && (
                        <input
                            type="text"
                            placeholder="Search markers..."
                            value={search}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500"
                        />
                    )}

                    {/* List */}
                    <div className="border border-neutral-200 rounded-lg bg-white max-h-48 overflow-y-auto divide-y divide-neutral-100">
                        {tab === "marker" && (
                            loadingMarkers ? (
                                <div className="px-4 py-3 text-sm text-neutral-400">Loading markers…</div>
                            ) : markers.length === 0 ? (
                                <div className="px-4 py-3 text-sm text-neutral-400">No markers found</div>
                            ) : (
                                markers.map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => handleSelect("marker", m.id, m.title)}
                                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-primary-50 transition-colors ${
                                            value?.attach_id === m.id && value.attach_type === "marker"
                                                ? "bg-primary-50 text-primary-700 font-medium"
                                                : "text-neutral-800"
                                        }`}
                                    >
                                        {m.title}
                                        {(m.categories && m.categories.length > 0) && (
                                            <span className="ml-2 text-xs text-neutral-400">{m.categories.join(", ")}</span>
                                        )}
                                    </button>
                                ))
                            )
                        )}
                        {tab === "quest" && (
                            loadingQuests ? (
                                <div className="px-4 py-3 text-sm text-neutral-400">Loading quests…</div>
                            ) : quests.length === 0 ? (
                                <div className="px-4 py-3 text-sm text-neutral-400">No quests found</div>
                            ) : (
                                quests.map((q) => (
                                    <button
                                        key={q.id}
                                        type="button"
                                        onClick={() => handleSelect("quest", q.id, q.title ?? q.id)}
                                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-primary-50 transition-colors ${
                                            value?.attach_id === q.id && value.attach_type === "quest"
                                                ? "bg-primary-50 text-primary-700 font-medium"
                                                : "text-neutral-800"
                                        }`}
                                    >
                                        {q.title ?? "Untitled Quest"}
                                        <span className={`ml-2 text-xs ${q.status === "Draft" ? "text-neutral-400" : "text-amber-500"}`}>
                                            {q.status}
                                        </span>
                                    </button>
                                ))
                            )
                        )}
                    </div>
                </>
            )}

            {/* Existing narratives notice */}
            {summaryNotice && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-[#8398FF]/10 border border-[#8398FF]/30 rounded-lg text-xs text-[#3D4E99]">
                    <span className="mt-0.5 shrink-0 text-[#5C6FD9]">ℹ</span>
                    <span>{summaryNotice}</span>
                </div>
            )}

            {error && (
                <p className="text-sm text-red-600" role="alert">{error}</p>
            )}
        </div>
    );
}
