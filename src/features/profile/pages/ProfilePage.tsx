import { useEffect, useRef, useState, type ReactNode, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  BadgeCheck,
  Camera,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Loader2,
  MapPin,
  Sparkles,
  Star,
  Users,
  Wallet,
} from "lucide-react";
import { Badge, Button, Card, Input, Textarea } from "@components/ui";
import { creatorService } from "@services/creator.service";
import { userService } from "@services/user.service";
import { cloudinaryService } from "@services/cloudinary.service";
import { payoutAccountService } from "@services/payoutAccount.service";
import { useAuthStore } from "@store/auth.store";
import { useCreatorStats } from "@hooks/useCreatorStats";
import type { CreatorOnboarding } from "@/types";

/** The signature element: a seal that makes verification status legible at a glance. */
function VerificationSeal({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-primary-600 to-primary-400 text-white text-sm font-semibold shadow-sm">
      <BadgeCheck className="w-4 h-4" />
      Verified Creator
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium">
      <Clock className="w-4 h-4" />
      Not yet verified
    </span>
  );
}

type OnboardingKey = keyof CreatorOnboarding;

interface OnboardingAction {
  onClick?: () => void;
  /** When set, the row is shown disabled with this tooltip instead of a link. */
  disabledHint?: string;
}

function OnboardingChecklist({
  onboarding,
  actions,
}: {
  onboarding: CreatorOnboarding | undefined;
  actions: Partial<Record<OnboardingKey, OnboardingAction>>;
}) {
  const items = [
    { key: "profile_complete", label: "Complete your profile", hint: "Add a tagline and bio" },
    {
      key: "first_quest_created",
      label: "Create your first quest",
      hint: "Build a quest as a draft",
    },
    { key: "payout_account_set", label: "Add a payout account", hint: "So you can get paid" },
    {
      key: "is_verified",
      label: "Get verified",
      hint: "Adds a Verified Creator badge to your published quests",
    },
  ] as const;

  const done = onboarding ? items.filter((i) => onboarding[i.key]).length : 0;
  const pct = Math.round((done / items.length) * 100);

  return (
    <Card padding="md" className="rounded-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-neutral-900">Getting started</h2>
        <span className="text-sm font-medium text-neutral-500">
          {done}/{items.length}
        </span>
      </div>
      <div
        className="h-2 w-full rounded-full bg-neutral-100 overflow-hidden mb-5"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="space-y-1">
        {items.map((item) => {
          const complete = !!onboarding?.[item.key];
          const action = actions[item.key];
          const clickable = !complete && !!action?.onClick && !action?.disabledHint;

          const content = (
            <>
              {complete ? (
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-5 h-5 text-neutral-300 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p
                  className={`text-sm font-medium ${complete ? "text-neutral-400 line-through" : "text-neutral-900"}`}
                >
                  {item.label}
                </p>
                {!complete && <p className="text-xs text-neutral-500">{item.hint}</p>}
              </div>
              {clickable && (
                <ChevronRight className="w-4 h-4 text-neutral-300 flex-shrink-0 ml-auto self-center" />
              )}
            </>
          );

          if (clickable) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const handleClick = action!.onClick;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={handleClick}
                  className="w-full flex items-start gap-3 rounded-xl p-2 -mx-2 text-left hover:bg-neutral-50 transition-colors cursor-pointer"
                >
                  {content}
                </button>
              </li>
            );
          }

          return (
            <li
              key={item.key}
              className="flex items-start gap-3 p-2 -mx-2"
              title={!complete ? action?.disabledHint : undefined}
            >
              {content}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-neutral-50 border border-neutral-100 flex items-center justify-center text-neutral-500 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">{label}</p>
        <p className="text-lg font-bold text-neutral-900 truncate">{value}</p>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const creator = useAuthStore((s) => s.creator);
  const stats = useCreatorStats();

  // Editable fields. Identity (name/avatar) lives on the user; tagline/bio/badge on the creator.
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [tagline, setTagline] = useState(creator?.tagline ?? "");
  const [bio, setBio] = useState(creator?.creator_bio ?? "");
  const [pendingImage, setPendingImage] = useState<{ url: string; public_id?: string } | null>(
    null
  );

  const [onboarding, setOnboarding] = useState<CreatorOnboarding | undefined>(undefined);
  const [hasPayout, setHasPayout] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh creator + onboarding on mount so stats/verification are current.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fresh, ob, payouts] = await Promise.all([
          creatorService.getMe(),
          creatorService.getOnboarding().catch(() => undefined),
          payoutAccountService.listMine().catch(() => []),
        ]);
        if (cancelled) return;
        useAuthStore.setState({ creator: fresh });
        if (ob) setOnboarding(ob);
        setHasPayout(payouts.length > 0);
      } catch {
        /* keep whatever is already in the store */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const savedAvatar = user?.profile_image?.url ?? creator?.avatar_url ?? null;
  const avatarSrc = pendingImage?.url ?? savedAvatar;
  const displayName =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
    creator?.name ||
    "Creator";
  const initials =
    ((user?.first_name?.[0] ?? "") + (user?.last_name?.[0] ?? "")).toUpperCase() ||
    displayName[0]?.toUpperCase() ||
    "C";

  const verified = !!creator?.is_verified;
  const status = creator?.status ?? "active";

  // Supplement the onboarding payout flag: the backend only sets payout_account_id
  // (and thus payout_account_set=true) when a primary account is chosen. If any
  // payout account exists (even pending), treat the step as done.
  const effectiveOnboarding = onboarding
    ? { ...onboarding, payout_account_set: onboarding.payout_account_set || hasPayout }
    : undefined;

  const dirty =
    firstName !== (user?.first_name ?? "") ||
    lastName !== (user?.last_name ?? "") ||
    tagline !== (creator?.tagline ?? "") ||
    bio !== (creator?.creator_bio ?? "") ||
    pendingImage !== null;

  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    // No size cap — cloudinaryService downscales oversized photos before upload.
    setUploading(true);
    try {
      const res = await cloudinaryService.uploadImage(file, { folder: "creator_avatars" });
      setPendingImage({ url: res.secure_url, public_id: res.public_id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload image.");
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFirstName(user?.first_name ?? "");
    setLastName(user?.last_name ?? "");
    setTagline(creator?.tagline ?? "");
    setBio(creator?.creator_bio ?? "");
    setPendingImage(null);
  };

  const scrollToEditForm = () => {
    document.getElementById("edit-profile")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const nameDirty =
        firstName !== (user?.first_name ?? "") || lastName !== (user?.last_name ?? "");
      const avatarDirty = pendingImage !== null;
      const taglineDirty = tagline !== (creator?.tagline ?? "");
      const bioDirty = bio !== (creator?.creator_bio ?? "");

      const userPatch: Record<string, unknown> = {};
      if (nameDirty || avatarDirty) {
        const payload: Parameters<typeof userService.updateMe>[0] = {};
        if (nameDirty) {
          payload.first_name = firstName.trim();
          payload.last_name = lastName.trim();
          userPatch.first_name = firstName.trim();
          userPatch.last_name = lastName.trim();
        }
        if (avatarDirty && pendingImage) {
          payload.profile_image = pendingImage;
          userPatch.profile_image = pendingImage;
        }
        await userService.updateMe(payload);
      }

      if (taglineDirty || bioDirty) {
        await creatorService.updateProfile({
          ...(taglineDirty ? { tagline: tagline.trim() } : {}),
          ...(bioDirty ? { creator_bio: bio.trim() } : {}),
        });
      }

      // Re-sync from source of truth; merge into the store WITHOUT dropping
      // `role` (PUT /users/me returns the role-stripped public dict).
      const freshCreator = await creatorService.getMe();
      useAuthStore.setState((s) => ({
        user: s.user ? { ...s.user, ...userPatch } : s.user,
        creator: freshCreator,
      }));
      setPendingImage(null);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="font-sans max-w-5xl mx-auto space-y-8 animate-fade-in">
      <header>
        <h1 className="text-3xl lg:text-4xl font-display font-bold text-primary-900 tracking-tight">
          Creator Profile
        </h1>
        <p className="text-neutral-500 mt-1">This is how explorers see you across SeekKrr.</p>
      </header>

      {/* Identity banner */}
      <Card padding="lg" className="rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="relative flex-shrink-0">
            <div className="w-20 h-20 rounded-2xl overflow-hidden border border-neutral-200 bg-neutral-100 flex items-center justify-center">
              {avatarSrc ? (
                <img src={avatarSrc} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-neutral-400">{initials}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile photo"
              className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-white border border-neutral-200 shadow-md flex items-center justify-center text-neutral-700 hover:text-primary-600 hover:border-primary-200 transition-colors disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-semibold text-neutral-900 truncate">{displayName}</h2>
              <VerificationSeal verified={verified} />
              {status !== "active" && (
                <Badge
                  status={status === "rejected" ? "rejected" : undefined}
                  variant={status !== "rejected" ? "danger" : undefined}
                >
                  {status}
                </Badge>
              )}
            </div>
            {user?.email && <p className="text-sm text-neutral-500 mt-1">{user.email}</p>}
            {creator?.tagline && (
              <p className="text-neutral-700 mt-2 italic">“{creator.tagline}”</p>
            )}
          </div>
        </div>

        {!verified && (
          <div className="mt-5 flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-100 p-4 text-amber-800">
            <Sparkles className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">
              You're not verified yet, but you can already create and submit quests for review. To
              earn the Verified Creator badge, submit markers and get 10 markers approved by our
              admin team.
            </p>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Edit form */}
        <Card id="edit-profile" padding="lg" className="lg:col-span-2 rounded-2xl scroll-mt-24">
          <h2 className="text-lg font-semibold text-neutral-900 mb-1">Edit profile</h2>
          <p className="text-sm text-neutral-500 mb-6">
            Your name and photo appear across SeekKrr. Tagline and bio introduce you on your public
            creator profile.
          </p>

          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={100}
                placeholder="First name"
              />
              <Input
                label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={100}
                placeholder="Last name"
              />
            </div>

            <Input
              label="Tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              maxLength={200}
              placeholder="e.g. Chasing India's hidden trails, one quest at a time"
              helperText={`${tagline.length}/200 — shown under your name`}
            />

            <Textarea
              label="Bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={5000}
              rows={6}
              placeholder="Tell explorers about yourself — what you love to discover and what makes your quests special."
              helperText={`${bio.length}/5000`}
            />

            <div className="flex items-center gap-3 pt-1">
              <Button onClick={handleSave} isLoading={saving} disabled={!dirty || saving}>
                Save changes
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={handleReset}
                disabled={!dirty || saving}
              >
                Reset
              </Button>
            </div>
          </div>
        </Card>

        {/* Side column */}
        <div className="space-y-6">
          <OnboardingChecklist
            onboarding={effectiveOnboarding}
            actions={{
              profile_complete: { onClick: scrollToEditForm },
              first_quest_created: { onClick: () => navigate("/creator/quest/create") },
              payout_account_set: { onClick: () => navigate("/creator/payout-accounts") },
            }}
          />

          <Card padding="md" className="rounded-2xl">
            <h2 className="text-base font-semibold text-neutral-900 mb-4">Your impact</h2>
            <div className="space-y-4">
              <StatTile
                icon={<MapPin className="w-5 h-5" />}
                label="Quests"
                value={`${stats.total_quests}`}
              />
              <StatTile
                icon={<Users className="w-5 h-5" />}
                label="Travelers served"
                value={`${stats.travelers_served}`}
              />
              <StatTile
                icon={<Wallet className="w-5 h-5" />}
                label="Earnings"
                value={`₹${stats.total_earnings.toLocaleString()}`}
              />
              <StatTile
                icon={<Star className="w-5 h-5" />}
                label="Rating"
                value={
                  stats.rating !== null && stats.rating !== undefined
                    ? `${stats.rating.toFixed(1)} (${stats.review_count})`
                    : "—"
                }
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
