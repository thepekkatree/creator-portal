import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Card } from "@components/ui";
import { questService } from "@services/quest.service";
import { narrativeService } from "@services/narrative.service";
import { LocationStep } from "../components/LocationStep";
import { DetailsStep } from "../components/DetailsStep";
import { WaypointsStep } from "../components/WaypointsStep";
import { WaypointDetailsStep } from "../components/WaypointDetailsStep";
import { NarrativeStep } from "../components/NarrativeStep";
import { ReviewStep } from "../components/ReviewStep";
import {
  type LocationStepData,
  type DetailsStepData,
  type MarkerPlaylistStepData,
  type MarkerPlaylistItemData,
  type QuestTheme,
  type CreateQuestFormData,
  defaultFormValues,
} from "../schemas/quest.schema";
import type {
  CloudinaryAsset,
  CreateQuestPayload,
  PlaylistItemInput,
  QuestStatus,
  RegionType,
  VoicePersona,
} from "@/types";

// Wizard: Location → Details → Markers → Marker Details → Narrative → Review.
type Step = 1 | 2 | 3 | 4 | 5 | 6;

const stepLabels: Record<Step, string> = {
  1: "Location",
  2: "Details",
  3: "Markers",
  4: "Marker Details",
  5: "Narrative",
  6: "Review",
};

const ALL_STEPS: Step[] = [1, 2, 3, 4, 5, 6];
const LAST_STEP = 6;

const SESSION_STORAGE_KEY = "quest_creation_form";

// Valid lowercase theme enum values accepted by the create payload + schema.
const VALID_THEMES: readonly QuestTheme[] = [
  "adventure", "romance", "culture", "food", "history", "nature",
  "spiritual", "photography", "archaeological", "offbeat", "finding_yourself", "other",
];

/** Normalize a backend theme string (Title-Case / spaced) to the lowercase enum. */
function normalizeTheme(value: string): QuestTheme | null {
  const slug = value.trim().toLowerCase().replace(/[\s-]+/g, "_") as QuestTheme;
  return VALID_THEMES.includes(slug) ? slug : null;
}

// The wizard form holds the V2 quest fields plus the extra per-marker detail
// the restored Marker-Details / Narrative steps collect. Those legacy-shaped
// extras are carried as `unknown` here until they're wired into the V2 payload
// in a later sequential step.
type WizardFormData = Partial<CreateQuestFormData> & {
  galleryImages?: CloudinaryAsset[];
  // Optional quest-level narrative (Step 5). Posted to /narratives after the
  // quest is created (its attach_id is the new quest id), never embedded in the
  // quest payload.
  questNarrative?: { title?: string; content?: string; voice_persona?: string; custom_voice_id?: string };
};

export function CreateQuestPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<WizardFormData>(defaultFormValues);
  const [isQuestInitialized, setIsQuestInitialized] = useState(false);
  // Gates the sessionStorage SAVE until the initial restore has run, so the
  // restore (or a remount under React StrictMode) can't be clobbered by a save
  // of the default empty state. Without this the draft resets to step 1 on reload.
  const [hydrated, setHydrated] = useState(false);

  // Draft save indicator: "idle" | "saving" | "saved"
  type DraftSaveState = "idle" | "saving" | "saved";
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>("idle");
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch quest data if editing
  const { data: existingQuest, isLoading: isLoadingQuest } = useQuery({
    queryKey: ["quest", id],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    queryFn: () => questService.getQuestById(id!),
    enabled: isEditing,
  });

  // Prefill the wizard from the V2 QuestDetail (only once, so refetches don't
  // clobber in-progress edits).
  useEffect(() => {
    if (existingQuest && !isQuestInitialized) {
      // Creators cannot edit a Published quest.
      if (existingQuest.status === "Published") {
        toast.error("Published quests cannot be edited. Please contact an administrator.");
        navigate("/creator/quests");
        return;
      }

      const themes = (existingQuest.theme ?? [])
        .map(normalizeTheme)
        .filter((t): t is QuestTheme => t !== null);

      const regionSummary = existingQuest.region_summary;
      const regionId =
        regionSummary && "id" in regionSummary ? (regionSummary.id ?? undefined) : undefined;
      const regionName =
        regionSummary && "name" in regionSummary
          ? (regionSummary.name ?? undefined)
          : undefined;

      // marker_summaries → playlist items (existing markers, with coords when unlocked).
      const markerPlaylist: MarkerPlaylistItemData[] = (existingQuest.marker_summaries ?? []).map(
        (m) => ({
          marker_id: m.marker_id,
          is_required: m.is_required ?? true,
          thingsToDo: m.things_to_do_text ?? undefined,
          thingsToDoImage: m.things_to_do_image_url
            ? { public_id: "", secure_url: m.things_to_do_image_url }
            : undefined,
          _display:
            m.coordinates && m.coordinates.lng !== null && m.coordinates.lng !== undefined && m.coordinates.lat !== null && m.coordinates.lat !== undefined
              ? { title: m.name ?? "Marker", lng: m.coordinates.lng, lat: m.coordinates.lat }
              : undefined,
        })
      );

      const startPoint = existingQuest.start_point;
      const mappedData: Partial<CreateQuestFormData> = {
        locationType: "city",
        title: existingQuest.title ?? "",
        description: existingQuest.description ?? "",
        theme: themes.length > 0 ? themes : ["adventure"],
        difficulty: existingQuest.difficulty ?? "moderate",
        duration: existingQuest.duration_minutes ?? 60,
        bestMonthStart: existingQuest.best_month_start ?? "",
        bestMonthEnd: existingQuest.best_month_end ?? "",
        minExpense: existingQuest.min_expense ?? undefined,
        maxExpense: existingQuest.max_expense ?? undefined,
        startTime: existingQuest.start_time ?? "",
        regionId,
        regionName,
        city: regionName,
        latitude: startPoint?.lat ?? undefined,
        longitude: startPoint?.lng ?? undefined,
        sourceUrl: existingQuest.reel_urls?.[0] ?? "",
        markerPlaylist,
        galleryImages: existingQuest.cloudinary_assets ?? [],
      };
      setFormData(mappedData);
      setIsQuestInitialized(true);
    }
  }, [existingQuest, isQuestInitialized, navigate]);

  // Restore an in-progress draft (the fallback when the creator navigates away,
  // closes the tab, or reloads). Runs once; sets `hydrated` so saving can begin.
  useEffect(() => {
    if (isEditing) {
      setHydrated(true);
      return;
    }
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.formData) setFormData((prev) => ({ ...prev, ...parsed.formData }));
        if (parsed.currentStep) setCurrentStep(parsed.currentStep);
      } catch (e) {
        console.error(e);
      }
    }
    setHydrated(true);
  }, [isEditing]);

  // Persist the draft on every change — but ONLY after the restore above has run,
  // so a remount can't overwrite the saved draft with the default empty state.
  useEffect(() => {
    if (isEditing || !hydrated) return;
    setDraftSaveState("saving");
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ formData, currentStep }));
    // Briefly flash "Saved ✓" after the write completes.
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => setDraftSaveState("saved"), 400);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [formData, currentStep, isEditing, hydrated]);

  const clearSession = () => sessionStorage.removeItem(SESSION_STORAGE_KEY);

  // Build a V2 CreateQuestPayload from the wizard form data.
  const buildPayload = (data: CreateQuestFormData, submit: boolean): CreateQuestPayload => {
    const marker_playlist: PlaylistItemInput[] = (data.markerPlaylist ?? []).map((item, index) => {
      const base: PlaylistItemInput = {
        // Backend requires suggested_order >= 1 (1-based), so offset the 0-based index.
        suggested_order: index + 1,
        is_required: item.is_required,
        ...(item.custom_description ? { custom_description: item.custom_description } : {}),
        // Step 4 per-quest fields (stored on the playlist item, nullable on V2).
        ...(item.thingsToDo ? { things_to_do_text: item.thingsToDo } : {}),
        ...(item.thingsToDoImage?.secure_url
          ? { things_to_do_image_url: item.thingsToDoImage.secure_url }
          : {}),
      };
      if (item.marker_id) {
        return { ...base, marker_id: item.marker_id };
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const nm = item.new_marker!;
      return {
        ...base,
        new_marker: {
          title: nm.title,
          location: { type: "Point", coordinates: [nm.longitude, nm.latitude] },
          ...(nm.categories ? { categories: nm.categories } : {}),
          ...(nm.sub_categories ? { sub_categories: nm.sub_categories } : {}),
          ...(nm.description ? { description: nm.description } : {}),
          ...(nm.address ? { address: nm.address } : {}),
        },
      };
    });

    const reelUrls = data.sourceUrl?.trim() ? [data.sourceUrl.trim()] : undefined;

    // Quest-level gallery → cloudinary_assets (independent of any marker).
    const gallery = (data.galleryImages ?? []).map((a) => ({
      public_id: a.public_id,
      secure_url: a.secure_url,
    }));

    // Trip-planning metadata (all optional): only include set values so drafts
    // don't post empty strings/NaN. Maps to the V2 quest model fields.
    const startTime = data.startTime?.trim();

    return {
      title: data.title,
      description: data.description,
      theme: data.theme,
      difficulty: data.difficulty,
      duration_minutes: data.duration,
      ...(data.bestMonthStart ? { best_month_start: data.bestMonthStart } : {}),
      ...(data.bestMonthEnd ? { best_month_end: data.bestMonthEnd } : {}),
      ...(typeof data.minExpense === "number" ? { min_expense: data.minExpense } : {}),
      ...(typeof data.maxExpense === "number" ? { max_expense: data.maxExpense } : {}),
      ...(startTime ? { start_time: startTime } : {}),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      region_id: data.regionId!,
      marker_playlist,
      ...(reelUrls ? { reel_urls: reelUrls } : {}),
      ...(gallery.length ? { cloudinary_assets: gallery } : {}),
      ...(submit ? { submit: true } : {}),
    };
  };

  // Save/Update quest mutation.
  const questMutation = useMutation({
    mutationFn: async ({ data, status }: { data: CreateQuestFormData; status: QuestStatus }) => {
      const submit = status === "Under Review";

      if (isEditing) {
        // region_id / submit are not part of the update payload; PUT then submit.
        const payload = buildPayload(data, false);
        const { region_id: _region, submit: _submit, ...updatePayload } = payload;
        void _region;
        void _submit;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const updated = await questService.updateQuest(id!, updatePayload);
        if (submit) {
          await questService.submitQuest(updated.id);
        }
        return updated;
      }

      // Create. `submit: true` creates directly in "Under Review", so no
      // separate submit call is needed for new quests.
      const payload = buildPayload(data, submit);
      const quest = await questService.createQuest(payload);

      // Optional quest-level narrative (attach_type: "quest"). Created ONLY here on
      // create (editing/managing narratives is the Narratives page's job), and only
      // AFTER the quest exists since the narrative's attach_id is the quest id. A
      // narrative failure must not fail the create — the quest is already saved.
      const qn = (data as WizardFormData).questNarrative;
      if (qn?.title?.trim()) {
        try {
          await narrativeService.createNarrative({
            title: qn.title.trim(),
            attach_type: "quest",
            attach_id: quest.id,
            ...(qn.content?.trim() ? { content: qn.content.trim() } : {}),
            ...(qn.voice_persona ? { voice_persona: qn.voice_persona as VoicePersona } : {}),
            ...(qn.voice_persona === "custom" && qn.custom_voice_id
                ? { custom_voice_id: qn.custom_voice_id }
                : {}),
            status: "draft",
          });
        } catch (err) {
          console.error("Quest narrative create failed:", err);
          toast.warning(
            "Quest saved, but the narrative couldn't be saved — you can add it later from the Narratives page."
          );
        }
      }
      return quest;
    },
    onSuccess: () => {
      clearSession();
      toast.success(isEditing ? "Quest updated successfully!" : "Quest created successfully!");
      navigate("/creator/quest/success");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save quest");
    },
  });

  const handleStep1Next = (data: LocationStepData) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep(2);
  };
  const handleStep2Next = (data: DetailsStepData) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep(3);
  };
  const handleStep3Next = (data: MarkerPlaylistStepData) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep(4);
  };
  // Step 4 (Marker Details) returns the per-quest things-to-do fields merged onto
  // the playlist items, plus the quest-level gallery images. Both are merged into
  // formData and folded into the V2 payload by buildPayload.
  const handleStep4Next = (data: {
    markerPlaylist: MarkerPlaylistItemData[];
    galleryImages: CloudinaryAsset[];
  }) => {
    setFormData((prev) => ({
      ...prev,
      markerPlaylist: data.markerPlaylist,
      galleryImages: data.galleryImages,
    }));
    setCurrentStep(5);
  };
  const handleStep5Next = (data: Partial<WizardFormData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep(6);
  };
  const handleBack = (data?: Partial<WizardFormData>) => {
    if (data) setFormData((prev) => ({ ...prev, ...data }));
    setCurrentStep((prev) => (prev > 1 ? ((prev - 1) as Step) : prev));
  };
  // Lets the Markers step expand the quest's region to the parent city.
  const handleRegionChange = (region: {
    regionId: string;
    regionName: string;
    regionType: RegionType;
  }) => {
    setFormData((prev) => ({
      ...prev,
      regionId: region.regionId,
      regionName: region.regionName,
      regionType: region.regionType,
      city: region.regionName,
    }));
  };
  const handleSubmit = (status: QuestStatus) => {
    if (!formData.regionId) {
      toast.error("Pick a region in step 1 before saving.");
      setCurrentStep(1);
      return;
    }
    if (!formData.markerPlaylist || formData.markerPlaylist.length < 2) {
      toast.error("Add at least two markers before saving.");
      setCurrentStep(3);
      return;
    }

    // F2: image requirements only enforced on "Submit for Review", never on draft save.
    if (status === "Under Review") {
      const playlist = formData.markerPlaylist ?? [];
      const missingActivity = playlist.some((it) => !it.thingsToDo?.trim());
      const missingStopImage = playlist.some((it) => !it.thingsToDoImage?.secure_url);
      const missingGallery = !formData.galleryImages || formData.galleryImages.length === 0;

      if (missingActivity) {
        toast.error("Add a 'Things to do' description for every stop before submitting for review.");
        setCurrentStep(4);
        return;
      }
      if (missingStopImage) {
        toast.error("Add a 'Things to do' image for every stop before submitting for review.");
        setCurrentStep(4);
        return;
      }
      if (missingGallery) {
        toast.error("Add at least one gallery image before submitting for review.");
        setCurrentStep(4);
        return;
      }
    }

    questMutation.mutate({ data: formData as CreateQuestFormData, status });
  };

  if (isEditing && isLoadingQuest) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-neutral-500">Loading quest details...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {ALL_STEPS.map((step) => {
            const isCompleted = step < currentStep;
            const isCurrent = step === currentStep;
            // F9: completed steps are interactive buttons; current/future are static.
            const StepNode = isCompleted ? "button" : "div";
            return (
              <div key={step} className={`flex items-center ${step < LAST_STEP ? "flex-1" : ""}`}>
                <div className="flex flex-col items-center">
                  <StepNode
                    {...(isCompleted
                      ? {
                          type: "button" as const,
                          onClick: () => setCurrentStep(step),
                          title: `Go back to ${stepLabels[step]}`,
                          className: `w-10 h-10 rounded-full flex items-center justify-center font-medium transition-colors bg-green-500 text-white cursor-pointer hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-1`,
                        }
                      : {
                          className: `w-10 h-10 rounded-full flex items-center justify-center font-medium transition-colors ${isCurrent ? "bg-primary-600 text-white" : "bg-neutral-200 text-neutral-500"}`,
                        })}
                  >
                    {isCompleted ? "✓" : step}
                  </StepNode>
                  <span
                    className={`mt-2 text-xs font-medium ${isCurrent ? "text-primary-600" : isCompleted ? "text-green-600" : "text-neutral-500"}`}
                  >
                    {stepLabels[step]}
                  </span>
                </div>
                {step < LAST_STEP && (
                  <div
                    className={`flex-1 h-1 mx-4 rounded ${isCompleted ? "bg-green-500" : "bg-neutral-200"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Draft save indicator — only shown when creating (not editing) */}
        {!isEditing && draftSaveState !== "idle" && (
          <div className="flex justify-end mt-3">
            <span className="inline-flex items-center gap-1 text-xs text-neutral-400 transition-opacity duration-300">
              {draftSaveState === "saving" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Saving draft…
                </>
              ) : (
                <>
                  <Check className="w-3 h-3 text-green-500" />
                  Draft saved
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Step Content */}
      <Card padding="lg" shadow="md">
        {currentStep === 1 && <LocationStep defaultValues={formData} onNext={handleStep1Next} />}
        {currentStep === 2 && (
          <DetailsStep defaultValues={formData} onNext={handleStep2Next} onBack={handleBack} />
        )}
        {currentStep === 3 && (
          <WaypointsStep
            defaultValues={formData}
            onNext={handleStep3Next}
            onBack={handleBack}
            onRegionChange={handleRegionChange}
          />
        )}
        {currentStep === 4 && (
          <WaypointDetailsStep
            defaultValues={{
              markerPlaylist: formData.markerPlaylist ?? [],
              galleryImages: formData.galleryImages ?? [],
            }}
            onNext={handleStep4Next}
            onBack={handleBack}
          />
        )}
        {currentStep === 5 && (
          <NarrativeStep
            defaultValues={{ questNarrative: formData.questNarrative }}
            onNext={handleStep5Next}
            onBack={handleBack}
          />
        )}
        {currentStep === 6 && (
          <ReviewStep
            formData={formData}
            onBack={handleBack}
            onSubmit={handleSubmit}
            isSubmitting={questMutation.isPending}
          />
        )}
      </Card>
    </div>
  );
}
