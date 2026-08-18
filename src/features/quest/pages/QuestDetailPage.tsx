import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  Star,
  Tag,
  Layers,
  Navigation,
  Eye,
  AlertCircle,
  Send,
  Trash2,
  BookOpen,
} from "lucide-react";
import { questService } from "@services/quest.service";
import { narrativeService } from "@services/narrative.service";
import { Card, Button, Badge, Input } from "@components/ui";
import { WaypointMapComponent } from "@features/map/components/WaypointMapComponent";
import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@store/auth.store";

export function QuestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { creator } = useAuthStore();
  // Any active creator may submit for review; is_verified is a badge, not a gate.
  const isActive = !creator || creator.status === "active";
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [expandedNarrative, setExpandedNarrative] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const {
    data: quest,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["quest", id],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    queryFn: () => questService.getQuestById(id!),
    enabled: !!id,
  });

  const { data: narrativesData, isLoading: isLoadingNarratives } = useQuery({
    queryKey: ["quest-narratives", id],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    queryFn: () => narrativeService.getByAttachment("quest", id!),
    enabled: !!id,
  });

  const handleSubmitForReview = async () => {
    if (!quest) return;
    const promise = questService.submitQuest(quest.id);

    toast.promise(promise, {
      loading: "Updating status...",
      success: `Quest submitted for review!`,
      error: "Failed to update status",
    });

    try {
      await promise;
      refetch();
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const handleQuestDelete = async () => {
    if (!quest || confirmText !== "CONFIRM") return;

    const promise = questService.deleteQuest(quest.id);

    toast.promise(promise, {
      loading: "Deleting quest...",
      success: "Quest deleted successfully",
      error: "Failed to delete quest",
    });

    try {
      await promise;
      navigate("/creator/quests");
    } catch (err) {
      console.error("Error deleting quest:", err);
    }
  };

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleNarrative = (id: string) => {
    setExpandedNarrative((prev) => (prev === id ? null : id));
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <p className="text-neutral-500 font-medium">Loading quest details...</p>
      </div>
    );
  }

  if (error || !quest) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <div className="p-4 bg-red-50 rounded-full">
          <AlertCircle className="w-10 h-10 text-red-500" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-neutral-900">Quest Not Found</h3>
          <p className="text-neutral-500 max-w-xs">
            The quest you're looking for might have been deleted or moved.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/creator/quests")}>
          Back to My Quests
        </Button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Draft":
        return "bg-neutral-100 text-neutral-700 border-neutral-200";
      case "Under Review":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "Changes Requested":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "Approved":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "Published":
        return "bg-primary-50 text-primary-700 border-primary-200";
      case "Rejected":
        return "bg-red-50 text-red-700 border-red-200";
      default:
        return "bg-neutral-50 text-neutral-600 border-neutral-100";
    }
  };

  // ── Derived view data from the V2 QuestDetail shape ──────────────────────────
  const regionName =
    "name" in quest.region_summary ? (quest.region_summary.name ?? "Unknown") : "Unknown";

  // Ordered markers (the V2 replacement for V1 "steps").
  const markers = [...(quest.marker_summaries ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  // Numbered route pins for the read-only map, derived from marker coordinates.
  const playlistPoints = markers
    .map((m) => ({ lng: m.coordinates?.lng, lat: m.coordinates?.lat, title: m.name ?? undefined }))
    .filter(
      (p): p is { lng: number; lat: number; title: string | undefined } =>
        typeof p.lng === "number" && typeof p.lat === "number"
    );

  const startLng = quest.start_point?.lng;
  const startLat = quest.start_point?.lat;
  const mapCenter =
    typeof startLng === "number" && typeof startLat === "number"
      ? { lng: startLng, lat: startLat }
      : playlistPoints[0]
        ? { lng: playlistPoints[0].lng, lat: playlistPoints[0].lat }
        : { lng: 0, lat: 0 };

  const narratives = narrativesData?.items ?? [];

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-[1100px] mx-auto space-y-6 sm:space-y-8 animate-fade-in pb-12 sm:pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between bg-white p-5 sm:p-6 rounded-2xl border border-neutral-200 shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/creator/quests")}
            className="rounded-full w-10 h-10 p-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 leading-tight">
              {quest.title || "Untitled Quest"}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Badge
                className={`${getStatusColor(quest.status)} border px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider`}
              >
                {quest.status}
              </Badge>
              <span className="text-sm text-neutral-400 font-medium">ID: {quest.id.slice(-8)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto mt-2 md:mt-0 pt-4 md:pt-0 border-t border-neutral-100 md:border-0">
          {["Draft", "Changes Requested"].includes(quest.status) && (
            <Button
              variant="primary"
              onClick={handleSubmitForReview}
              leftIcon={<Send className="w-4 h-4" />}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 w-full sm:w-auto justify-center"
              disabled={!isActive}
            >
              Submit Review
            </Button>
          )}

          {["Draft", "Changes Requested"].includes(quest.status) && (
            <Button
              variant="secondary"
              onClick={() => navigate(`/creator/quest/edit/${quest.id}`)}
              className="w-full sm:w-auto justify-center bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50 hover:text-primary-600"
            >
              Edit Quest
            </Button>
          )}

          {quest.status !== "Published" && (
            <Button
              variant="danger"
              onClick={() => setIsDeleteModalOpen(true)}
              leftIcon={<Trash2 className="w-4 h-4" />}
              className="w-full sm:w-auto justify-center"
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm animate-fade-in">
          <Card className="w-full max-w-md shadow-2xl border-red-100 overflow-hidden animate-scale-up">
            <div className="p-6">
              <div className="flex items-center gap-3 text-red-600 mb-4">
                <div className="p-2 bg-red-50 rounded-full">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold">Delete Quest?</h3>
              </div>

              <p className="text-neutral-600 mb-6">
                This action will delete your quest. To confirm, please type{" "}
                <span className="font-bold text-neutral-900 select-none">CONFIRM</span> below.
              </p>

              <div className="space-y-4">
                <Input
                  placeholder="Type CONFIRM to delete"
                  value={confirmText}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmText(e.target.value)}
                  className="border-red-100 focus:border-red-500 focus:ring-red-200"
                  autoFocus
                />

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="ghost"
                    fullWidth
                    onClick={() => {
                      setIsDeleteModalOpen(false);
                      setConfirmText("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    fullWidth
                    disabled={confirmText !== "CONFIRM"}
                    onClick={handleQuestDelete}
                  >
                    Delete Forever
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          icon={<Star className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />}
          label="Difficulty"
          value={quest.difficulty || "Medium"}
        />
        <StatCard
          icon={<Clock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500" />}
          label="Duration"
          value={`${quest.duration_minutes || 60} mins`}
        />
        <StatCard
          icon={<Tag className="w-4 h-4 sm:w-5 sm:h-5 text-primary-500" />}
          label="Theme"
          value={quest.theme?.length ? quest.theme.join(", ") : "Culture"}
        />
        <StatCard
          icon={<Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />}
          label="Created"
          value={quest.created_at ? formatDate(quest.created_at) : "—"}
        />
      </div>

      <div className="flex flex-col space-y-6 sm:space-y-8">
        {/* Main Content Sections */}
        <div className="space-y-6 sm:space-y-8">
          <Card className="rounded-2xl border-neutral-200 shadow-sm overflow-hidden">
            <div className="p-2">
              <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary-500" />
                Description
              </h3>
              <div className="prose prose-neutral prose-sm max-w-none text-neutral-600 leading-relaxed">
                <p>{quest.description || "No description provided."}</p>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border-neutral-200 shadow-sm">
            <div className="p-2">
              <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-widest mb-6">
                Quest Info
              </h3>
              <div className="space-y-1">
                <DetailItem label="Region" value={regionName} />
                <DetailItem label="Currency" value={quest.currency || "INR"} />
                <DetailItem
                  label="Price"
                  value={
                    (quest.price ?? 0) > 0
                      ? `₹${(quest.price ?? 0).toLocaleString("en-IN")}`
                      : "Free"
                  }
                />
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border-neutral-200 shadow-sm overflow-hidden">
            <div className="p-2">
              <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-500" />
                Route & Markers
              </h3>

              {/* Map Preview */}
              {playlistPoints.length > 0 && (
                <div className="h-[250px] sm:h-[320px] rounded-xl overflow-hidden border border-neutral-200 mb-6 sm:mb-8 bg-neutral-50 relative group shadow-inner">
                  <WaypointMapComponent
                    center={mapCenter}
                    playlistPoints={playlistPoints}
                    height="100%"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 pointer-events-none transition-colors" />
                </div>
              )}

              {/* Markers List */}
              <div className="space-y-3">
                {markers.length === 0 ? (
                  <div className="text-center py-6 bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
                    <p className="text-sm font-medium text-neutral-500">No markers added yet</p>
                  </div>
                ) : (
                  markers.map((marker, i) => (
                    <div
                      key={marker.marker_id}
                      className="border border-neutral-100 rounded-xl overflow-hidden bg-white hover:border-primary-200 transition-colors shadow-sm"
                    >
                      <button
                        onClick={() => toggleStep(i)}
                        className="w-full text-left p-4 sm:p-5 flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center font-bold text-sm shrink-0">
                            {i + 1}
                          </div>
                          <h4 className="font-bold text-neutral-800 group-hover:text-primary-600 transition-colors text-sm sm:text-base leading-snug pr-4">
                            {marker.name || `Marker ${i + 1}`}
                          </h4>
                        </div>
                        <div
                          className={`transition-transform duration-200 text-neutral-400 shrink-0 ${expandedSteps.has(i) ? "rotate-180" : ""}`}
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </button>

                      {expandedSteps.has(i) && (
                        <div className="px-4 sm:px-5 pb-5 pt-0 sm:pl-16 animate-slide-down">
                          <div className="hidden sm:block w-px h-full bg-neutral-100 absolute left-[35px] top-[60px]" />
                          {(marker.categories && marker.categories.length > 0) && (
                            <div className="inline-flex items-center gap-1.5 mb-3 px-2 py-1 rounded bg-neutral-50 text-neutral-600 text-xs font-semibold">
                              <Navigation className="w-3.5 h-3.5 text-primary-400" /> {marker.categories.join(", ")}
                            </div>
                          )}
                          {marker.things_to_do_text && (
                            <p className="text-sm text-neutral-600 mb-4 leading-relaxed">
                              {marker.things_to_do_text}
                            </p>
                          )}

                          {marker.images && marker.images.length > 0 && (
                            <div className="flex gap-3 mt-4 overflow-x-auto pb-3 custom-scrollbar">
                              {marker.images.map((img, idx) => (
                                <div
                                  key={idx}
                                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden border border-neutral-200 flex-shrink-0 bg-neutral-100 group-scope relative shadow-sm"
                                >
                                  <img
                                    src={img}
                                    alt=""
                                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>

          {/* Narratives Section */}
          <Card className="rounded-2xl border-neutral-200 shadow-sm overflow-hidden">
            <div className="p-2">
              <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-500" />
                Narratives
              </h3>

              {isLoadingNarratives ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500"></div>
                </div>
              ) : narratives.length === 0 ? (
                <div className="text-center py-6 bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
                  <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-neutral-100">
                    <BookOpen className="w-4 h-4 text-neutral-300" />
                  </div>
                  <p className="text-sm font-medium text-neutral-500">No narratives available</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    Narratives enrich the journey through this quest
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {narratives.map((n) => {
                    const isExpanded = expandedNarrative === n.id;

                    return (
                      <div
                        key={n.id}
                        className="border border-neutral-100 rounded-xl bg-white hover:border-emerald-200 transition-colors shadow-sm overflow-hidden"
                      >
                        <button
                          onClick={() => toggleNarrative(n.id)}
                          className="w-full text-left p-4 sm:p-5 flex items-center justify-between group"
                        >
                          <div className="flex flex-col gap-1">
                            {n.subtitle && (
                              <div className="flex items-center gap-2 text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                                <span>{n.subtitle}</span>
                              </div>
                            )}
                            {n.title ? (
                              <h4 className="font-bold text-neutral-800 text-sm sm:text-base leading-snug group-hover:text-emerald-600 transition-colors">
                                {n.title}
                              </h4>
                            ) : (
                              <h4 className="font-bold text-neutral-400 text-sm sm:text-base leading-snug italic">
                                Untitled Narrative
                              </h4>
                            )}
                          </div>
                          <div
                            className={`transition-transform duration-200 text-neutral-400 shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 sm:px-5 pb-5 pt-0 animate-slide-down">
                            <div className="w-full h-px bg-neutral-100 mb-4" />
                            <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-wrap">
                              {n.content}
                            </p>
                            {n.is_mandatory && (
                              <div className="mt-4 inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-50 text-amber-600 text-xs font-semibold">
                                Mandatory Stop
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Media Gallery & Additional Info */}
        <div className="space-y-6 sm:space-y-8">
          <Card className="rounded-2xl border-neutral-200 shadow-sm">
            <div className="p-2">
              <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Eye className="w-4 h-4 text-primary-500" />
                Media Gallery
              </h3>
              {quest.cloudinary_assets && quest.cloudinary_assets.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {quest.cloudinary_assets.map((asset, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-xl overflow-hidden border border-neutral-200 shadow-sm group cursor-pointer relative bg-neutral-100"
                    >
                      <img
                        src={asset.secure_url}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 px-4 text-center bg-neutral-50 rounded-2xl border border-dashed border-neutral-200">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-neutral-100">
                    <Eye className="w-5 h-5 text-neutral-300" />
                  </div>
                  <p className="text-sm font-medium text-neutral-500">No media uploaded</p>
                  <p className="text-xs text-neutral-400 mt-1">Images will appear here</p>
                </div>
              )}

              {quest.reel_urls && quest.reel_urls.length > 0 && (
                <div className="mt-6 bg-primary-50/50 p-4 rounded-xl border border-primary-100/50">
                  <h4 className="text-[10px] font-bold text-primary-400 uppercase tracking-wider mb-2">
                    Source Reel
                  </h4>
                  <a
                    href={quest.reel_urls[0]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-white text-primary-600 text-sm font-bold rounded-lg border border-primary-100 shadow-sm hover:bg-primary-50 hover:border-primary-200 transition-all gap-2"
                  >
                    Watch Video
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </a>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className="bg-white border-none shadow-sm hover:shadow-md transition-all rounded-2xl group cursor-default h-full">
      <div className="p-3 sm:p-4 flex flex-col items-center justify-center text-center h-full">
        <div className="p-2 sm:p-2.5 bg-neutral-50 group-hover:bg-primary-50 transition-colors rounded-2xl mb-2 sm:mb-3">
          {icon}
        </div>
        <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 uppercase tracking-widest">
          {label}
        </span>
        <span className="text-sm sm:text-base font-extrabold text-neutral-800 mt-1">{value}</span>
      </div>
    </Card>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2.5 sm:py-3 border-b border-neutral-100 last:border-0">
      <span className="text-sm text-neutral-500 font-medium">{label}</span>
      <span className="text-sm text-neutral-800 font-bold max-w-[50%] text-right truncate">
        {value}
      </span>
    </div>
  );
}
