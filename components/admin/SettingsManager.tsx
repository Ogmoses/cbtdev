"use client";

/**
 * SettingsManager — school profile (used on report-card letterheads) and
 * the grading scale (`grading_scale` in database/schema.sql) that turns a
 * score into a grade letter across the platform.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Loader2, ImagePlus, X, Save, Check } from "lucide-react";
import type { GradeBand, SchoolProfile } from "./types";
import { uploadImage } from "@/lib/uploadImage";
import ImageCropModal from "@/components/ui/ImageCropModal";
import { RECOMMENDED_COLORS, DEFAULT_THEME_COLOR, themeCssVars, buildRampFromHex, getOnAccentColor, SURFACE_COLORS, DEFAULT_SURFACE_COLOR, surfaceChannels } from "@/lib/themes";

interface SettingsManagerProps {
  profile: SchoolProfile;
  gradingScale: GradeBand[];
  onSaveProfile: (profile: SchoolProfile) => Promise<void>;
  onSaveGradingScale: (bands: GradeBand[]) => Promise<void>;
  onSaveTheme: (themeColor: string) => Promise<void>;
  onSaveSurface: (secondaryColor: string) => Promise<void>;
}

export default function SettingsManager({ profile, gradingScale, onSaveProfile, onSaveGradingScale, onSaveTheme, onSaveSurface }: SettingsManagerProps) {
  return (
    <div className="max-w-2xl space-y-6 pb-10 lg:max-w-4xl">
      <div>
        <h1 className="font-display text-[18px] font-semibold text-ink dark:text-white sm:text-[20px]">Settings</h1>
        <p className="mt-0.5 text-[13px] text-ink/50 dark:text-white/50">School profile and the grading scale used across results and report cards.</p>
      </div>
      <ProfileSection profile={profile} onSave={onSaveProfile} />
      <ThemeSection currentColor={profile.themeColor} onSave={onSaveTheme} />
      <SurfaceSection currentColor={profile.secondaryColor} onSave={onSaveSurface} />
      <GradingScaleSection bands={gradingScale} onSave={onSaveGradingScale} />
    </div>
  );
}

function previewSurface(hex: string) {
  document.documentElement.style.setProperty("--color-secondary-rgb", surfaceChannels(hex));
}

/** Background color for the whole site in light mode — a curated set of light tints so text always stays readable. */
export function SurfaceSection({ currentColor, onSave }: { currentColor?: string; onSave: (color: string) => Promise<void> }) {
  const start = currentColor || DEFAULT_SURFACE_COLOR;
  const [selected, setSelected] = useState(start);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedColor = useRef(start);

  // Leaving the screen without saving puts the real background back.
  useEffect(() => {
    return () => previewSurface(savedColor.current);
  }, []);

  const choose = (hex: string) => {
    setSelected(hex);
    setSaved(false);
    previewSurface(hex); // live preview
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
      savedColor.current = selected;
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the background color.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Background color" subtitle="The page background in light mode, for everyone at your school. Tap one to preview it on this page, then save.">
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
        {SURFACE_COLORS.map((c) => {
          const isSelected = selected.toUpperCase() === c.hex.toUpperCase();
          return (
            <button key={c.key} type="button" onClick={() => choose(c.hex)} className="flex flex-col items-center gap-1.5" title={c.name}>
              <div className={`relative flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors ${isSelected ? "border-crimson-600" : "border-transparent"}`}>
                <div className="h-9 w-9 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20" style={{ backgroundColor: c.hex }} />
                {isSelected && (
                  <div className="absolute -right-0.5 -top-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-crimson-600 text-on-crimson ring-2 ring-white dark:ring-[#1A1C20]">
                    <Check size={10} strokeWidth={3.5} />
                  </div>
                )}
              </div>
              <span className="max-w-[64px] truncate text-[10.5px] font-medium text-ink/60 dark:text-white/60">{c.name}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-[12.5px] text-crimson-600">{error}</p>}
      <div className="mt-5 flex items-center justify-end gap-3 border-t border-black/5 pt-4 dark:border-white/10">
        {saved && <span className="text-[12.5px] text-success">Saved</span>}
        <button type="button" onClick={handleSave} disabled={saving} className="rounded-lg bg-crimson-600 px-4 py-2 text-[13px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60">
          {saving ? "Saving…" : "Save background"}
        </button>
      </div>
    </SectionCard>
  );
}

function applyPreview(color: string) {
  const styleTag =
    document.getElementById("theme-vars-override") ??
    (() => {
      const el = document.createElement("style");
      el.id = "theme-vars-override";
      document.head.appendChild(el);
      return el;
    })();
  styleTag.textContent = `:root { ${themeCssVars(color)} }`;
}

export function ThemeSection({ currentColor, onSave }: { currentColor?: string; onSave: (color: string) => Promise<void> }) {
  const [selected, setSelected] = useState(currentColor || DEFAULT_THEME_COLOR);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const choose = (color: string) => {
    setSelected(color);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(selected);
      // Applies immediately to this tab, so the change is visible without
      // waiting for a reload — every other visitor picks it up on their
      // next page load, since app/layout.tsx reads it fresh server-side
      // each time.
      applyPreview(selected);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const ramp = buildRampFromHex(selected);

  return (
    <SectionCard title="Site theme" subtitle="Sets the accent color used for buttons, links, and highlights across the whole site — for everyone, not just you">
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
        {RECOMMENDED_COLORS.map((c) => {
          const isSelected = selected.toUpperCase() === c.hex.toUpperCase();
          return (
            <button
              key={c.key}
              onClick={() => choose(c.hex)}
              className="flex flex-col items-center gap-1.5"
              title={c.name}
            >
              <div
                className={`relative flex h-11 w-11 items-center justify-center rounded-full border-2 transition-colors ${
                  isSelected ? "border-crimson-600" : "border-transparent"
                }`}
              >
                <div className="h-9 w-9 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15" style={{ backgroundColor: c.hex }} />
                {isSelected && (
                  <div
                    className="absolute -right-0.5 -top-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full ring-2 ring-white dark:ring-[#1A1C20]"
                    style={{ backgroundColor: c.hex, color: getOnAccentColor(c.hex) }}
                  >
                    <Check size={10} strokeWidth={3.5} />
                  </div>
                )}
              </div>
              <span className="max-w-[64px] truncate text-[10.5px] font-medium text-ink/60 dark:text-white/60">{c.name}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 border-t border-black/5 pt-4 dark:border-white/10">
        <p className="mb-2.5 text-[11.5px] font-medium uppercase tracking-wide text-ink/40 dark:text-white/40">Preview</p>
        <div className="flex items-center gap-3 rounded-lg bg-background-muted p-3 dark:bg-white/5">
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3.5 py-2 text-[12.5px] font-semibold dark:border-white/15"
            style={{ backgroundColor: ramp[600], color: getOnAccentColor(ramp[600]) }}
          >
            Sample button
          </button>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: ramp[50], color: ramp[700] }}>
            Sample badge
          </span>
          <div className="ml-auto flex overflow-hidden rounded-md">
            {([50, 100, 300, 500, 700, 900] as const).map((shade) => (
              <div key={shade} className="h-6 w-5" style={{ backgroundColor: ramp[shade] }} />
            ))}
          </div>
        </div>
      </div>

      <SaveButton onClick={handleSave} saving={saving} saved={saved} label="Apply theme" />
    </SectionCard>
  );
}

function ProfileSection({ profile, onSave }: { profile: SchoolProfile; onSave: (p: SchoolProfile) => Promise<void> }) {
  const [schoolName, setSchoolName] = useState(profile.schoolName);
  const [motto, setMotto] = useState(profile.motto ?? "");
  const [address, setAddress] = useState(profile.address ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(profile.logoUrl ?? null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const handleLogo = async (file: File | null) => {
    if (!file) return;
    setLogoError(null);
    setUploadingLogo(true);
    try {
      // Uploaded to Supabase Storage now; it only becomes the school's
      // logo once "Save" is pressed, same as every other field here.
      setLogoUrl(await uploadImage("school-assets", file));
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Couldn't upload that logo.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave({ schoolName, motto, address, logoUrl });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="School profile" subtitle="Appears on the report-card letterhead">
      <div className="flex items-start gap-4">
        {logoUrl ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="School logo" className="h-16 w-16 rounded-full border border-black/10 dark:border-white/15 object-cover" />
            <button onClick={() => setLogoUrl(null)} className="absolute -right-2 -top-2 rounded-full bg-white dark:bg-[#1A1C20] p-1 text-ink/60 dark:text-white/60 shadow-card hover:text-crimson-700 dark:hover:text-crimson-500">
              <X size={12} />
            </button>
          </div>
        ) : (
          <label className="flex h-16 w-16 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-black/15 dark:border-white/20 text-ink/40 dark:text-white/40 hover:border-black/25">
            {uploadingLogo ? <Loader2 size={17} className="animate-spin" /> : <ImagePlus size={17} />}
            <span className="text-[9px] font-medium">{uploadingLogo ? "Uploading" : "Logo"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploadingLogo}
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) setCropFile(picked); // opens the round crop editor first
                e.target.value = "";
              }}
            />
          </label>
        )}
        <div className="flex-1 space-y-3">
          <TextField label="School name" value={schoolName} onChange={setSchoolName} />
          <TextField label="Motto (optional)" value={motto} onChange={setMotto} placeholder="e.g. Knowledge, Character, Excellence" />
        </div>
      </div>
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          shape="circle"
          title="Crop your logo"
          onCancel={() => setCropFile(null)}
          onDone={(cropped) => {
            setCropFile(null);
            handleLogo(cropped);
          }}
        />
      )}
      {logoError && <p className="mt-2 text-[12px] text-crimson-600">{logoError}</p>}
      <label className="mt-3.5 block">
        <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Address</span>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-2.5 text-[13px] outline-none focus:border-crimson-500"
        />
      </label>

      <SaveButton onClick={handleSave} saving={saving} saved={saved} />
    </SectionCard>
  );
}

function GradingScaleSection({ bands: initialBands, onSave }: { bands: GradeBand[]; onSave: (bands: GradeBand[]) => Promise<void> }) {
  const [bands, setBands] = useState(initialBands);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<GradeBand>) => setBands((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const addBand = () => setBands((prev) => [...prev, { id: crypto.randomUUID(), minScore: 0, maxScore: 0, gradeLetter: "", remark: "" }]);
  const removeBand = (id: string) => setBands((prev) => prev.filter((b) => b.id !== id));

  const handleSave = async () => {
    if (bands.some((b) => !b.gradeLetter.trim())) {
      setError("Every band needs a grade letter.");
      return;
    }
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      await onSave(bands);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Grading scale" subtitle="Score ranges map to a letter grade and remark">
      {/* Desktop/tablet: compact grid-table */}
      <div className="hidden space-y-2 sm:block">
        <div className="grid grid-cols-[1fr_1fr_0.7fr_1.4fr_auto] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-ink/40 dark:text-white/40">
          <span>Min</span>
          <span>Max</span>
          <span>Grade</span>
          <span>Remark</span>
          <span />
        </div>
        {bands.map((b) => (
          <div key={b.id} className="grid grid-cols-[1fr_1fr_0.7fr_1.4fr_auto] items-center gap-2">
            <input type="number" value={b.minScore} onChange={(e) => update(b.id, { minScore: Number(e.target.value) })} className="w-full min-w-0 rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-crimson-500" />
            <input type="number" value={b.maxScore} onChange={(e) => update(b.id, { maxScore: Number(e.target.value) })} className="w-full min-w-0 rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-crimson-500" />
            <input value={b.gradeLetter} onChange={(e) => update(b.id, { gradeLetter: e.target.value })} className="w-full min-w-0 rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-crimson-500" />
            <input value={b.remark} onChange={(e) => update(b.id, { remark: e.target.value })} className="w-full min-w-0 rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-crimson-500" />
            <button onClick={() => removeBand(b.id)} className="shrink-0 rounded-md p-2 text-ink/30 dark:text-white/30 hover:bg-crimson-50 dark:hover:bg-crimson-600/15 hover:text-crimson-700 dark:hover:text-crimson-500">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Mobile: one card per band — a 5-column grid never fits a phone width */}
      <div className="space-y-2.5 sm:hidden">
        {bands.map((b) => (
          <div key={b.id} className="rounded-lg border border-black/10 dark:border-white/15 p-3">
            <div className="mb-2 grid grid-cols-3 gap-2">
              <MiniField label="Min" value={b.minScore} onChange={(v) => update(b.id, { minScore: Number(v) })} type="number" />
              <MiniField label="Max" value={b.maxScore} onChange={(v) => update(b.id, { maxScore: Number(v) })} type="number" />
              <MiniField label="Grade" value={b.gradeLetter} onChange={(v) => update(b.id, { gradeLetter: v })} />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <MiniField label="Remark" value={b.remark} onChange={(v) => update(b.id, { remark: v })} />
              </div>
              <button onClick={() => removeBand(b.id)} className="shrink-0 rounded-md border border-black/10 dark:border-white/15 p-2.5 text-ink/40 dark:text-white/40 hover:bg-crimson-50 dark:hover:bg-crimson-600/15 hover:text-crimson-700 dark:hover:text-crimson-500">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addBand} className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-crimson-700 dark:text-crimson-500 hover:text-crimson-800">
        <Plus size={14} /> Add band
      </button>

      {error && <p className="mt-3 rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3 py-2 text-[12.5px] text-crimson-700 dark:text-crimson-500">{error}</p>}
      <SaveButton onClick={handleSave} saving={saving} saved={saved} />
    </SectionCard>
  );
}

function MiniField({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[9.5px] font-medium uppercase tracking-wide text-ink/40 dark:text-white/40">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-lg border border-black/10 dark:border-white/15 px-2 py-2 text-[12.5px] outline-none focus:border-crimson-500"
      />
    </label>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-black/5 dark:border-white/10 bg-white dark:bg-[#1A1C20] p-4.5 shadow-card sm:p-5">
      <div className="mb-4">
        <h2 className="font-display text-[14px] font-semibold text-ink dark:text-white">{title}</h2>
        <p className="text-[12px] text-ink/45 dark:text-white/45">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-2.5 text-[13px] outline-none focus:border-crimson-500" />
    </label>
  );
}

function SaveButton({ onClick, saving, saved, label = "Save changes" }: { onClick: () => void; saving: boolean; saved: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="mt-4 flex items-center gap-1.5 rounded-lg bg-crimson-600 px-4 py-2.5 text-[13px] font-semibold text-on-crimson transition-colors duration-200 hover:bg-crimson-700 disabled:opacity-70"
    >
      {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {saving ? "Saving…" : saved ? "Saved" : label}
    </button>
  );
}
