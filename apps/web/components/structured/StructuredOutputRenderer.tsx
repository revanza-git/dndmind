"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { SuggestedActions } from "../chat/SuggestedActions";
import {
  generateImage,
  ImageGenerationResponse,
  ImageStylePreset,
  SaveImageMetadata,
  StructuredImageOutputType,
  StructuredOutput,
  SuggestedAction
} from "../../lib/api";

type RendererProps = {
  output: StructuredOutput | null | undefined;
  suggestedActions: SuggestedAction[];
  onAction: (action: SuggestedAction) => Promise<void>;
  status?: string | null;
  campaignId: string | null;
  conversationId?: string | null;
};

const imageStylePresetsByOutputType: Record<StructuredImageOutputType, ImageStylePreset[]> = {
  character: ["cinematic", "parchment sketch", "combat stance", "anime"],
  npc: ["cinematic", "parchment sketch", "anime"],
  encounter: ["cinematic", "anime"]
};

export function StructuredOutputRenderer({ output, suggestedActions, onAction, status, campaignId, conversationId }: RendererProps) {
  const [stylePreset, setStylePreset] = useState<ImageStylePreset>("cinematic");
  const [image, setImage] = useState<ImageGenerationResponse | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const outputType = output?.type;
  const imageOutputType = outputType === "npc" || outputType === "character" || outputType === "encounter" ? outputType : null;
  const acceptedStylePreset = imageOutputType ? acceptedImageStylePreset(imageOutputType, stylePreset) : "cinematic";

  useEffect(() => {
    if (imageOutputType && !imageStylePresetsByOutputType[imageOutputType].includes(stylePreset)) {
      setStylePreset("cinematic");
    }
  }, [imageOutputType, stylePreset]);

  if (!output) {
    return null;
  }

  const actions = mergeActions(suggestedActions, defaultActionsFor(output));
  const imageMetadata = image ? saveImageMetadataFrom(image, acceptedStylePreset) : null;

  async function handleGenerateImage() {
    if (!campaignId || !imageOutputType || isGeneratingImage || !output) {
      return;
    }

    setIsGeneratingImage(true);
    setImageError(null);
    try {
      const generated = await generateImage({
        campaignId,
        conversationId,
        structuredOutputType: imageOutputType,
        structuredOutputData: output.data,
        stylePreset: acceptedStylePreset
      });
      setImage(generated);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "DNDMind could not generate an image. Please try again.");
    } finally {
      setIsGeneratingImage(false);
    }
  }

  async function handleAction(action: SuggestedAction) {
    if (!imageMetadata || !isImageSaveAction(action.action)) {
      await onAction(action);
      return;
    }

    await onAction({
      ...action,
      payload: {
        ...action.payload,
        image: imageMetadata
      }
    });
  }

  return (
    <div className="border-t border-moss/10 pt-4">
      <div className="overflow-hidden rounded-2xl border border-moss/15 bg-white shadow-lg shadow-moss/5">
        <div className="border-b border-moss/10 bg-parchment/70 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copper">{labelFor(output.type)}</p>
              <p className="mt-1 text-sm text-moss/70">Ready to save, adjust, or bring straight to the table.</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-moss">table-ready</span>
          </div>
        </div>
        <div className="p-5 md:p-6">
          {output.type === "npc" && (
            <NpcCard
              data={output.data}
              imagePanel={
                <StructuredImagePanel
                  outputType="npc"
                  image={image}
                  stylePreset={acceptedStylePreset}
                  isLoading={isGeneratingImage}
                  error={imageError}
                  onGenerate={handleGenerateImage}
                  onStyleChange={setStylePreset}
                  disabled={!campaignId}
                />
              }
            />
          )}
          {output.type === "character" && (
            <CharacterCard
              data={output.data}
              imagePanel={
                <StructuredImagePanel
                  outputType="character"
                  image={image}
                  stylePreset={acceptedStylePreset}
                  isLoading={isGeneratingImage}
                  error={imageError}
                  onGenerate={handleGenerateImage}
                  onStyleChange={setStylePreset}
                  disabled={!campaignId}
                />
              }
            />
          )}
          {output.type === "quest" && <QuestCard data={output.data} />}
          {output.type === "location" && <LocationCard data={output.data} />}
          {output.type === "encounter" && (
            <EncounterCard
              data={output.data}
              imagePanel={
                <StructuredImagePanel
                  outputType="encounter"
                  image={image}
                  stylePreset={acceptedStylePreset}
                  isLoading={isGeneratingImage}
                  error={imageError}
                  onGenerate={handleGenerateImage}
                  onStyleChange={setStylePreset}
                  disabled={!campaignId}
                />
              }
            />
          )}
          {output.type === "session_summary" && <SessionSummaryCard data={output.data} />}
          {output.type === "initiative_order" && <InitiativeOrderCard data={output.data} />}
          {output.type === "dice_roll" && <DiceRollCard data={output.data} />}
          <SuggestedActions actions={actions} onAction={handleAction} status={status} />
        </div>
      </div>
    </div>
  );
}

function NpcCard({ data, imagePanel }: { data: Record<string, unknown>; imagePanel?: ReactNode }) {
  const role = [text(data.role), text(data.raceOrSpecies)].filter(Boolean).join(" · ");
  return (
    <div>
      <CardTitle title={text(data.name) || "Generated NPC"} detail={role} badge="NPC" />
      {imagePanel}
      <p className="mt-3 text-base leading-7 text-moss">{text(data.description)}</p>
      <InfoGrid
        items={[
          ["Personality", text(data.personality)],
          ["Motivation", text(data.motivation)],
          ["Secret", text(data.secret)],
          ["Quest Hook", text(data.questHook)],
          ["Party Link", text(data.relationshipToParty)]
        ]}
      />
    </div>
  );
}

function CharacterCard({ data, imagePanel }: { data: Record<string, unknown>; imagePanel?: ReactNode }) {
  const detail = [
    text(data.ancestryOrSpecies) || text(data.species) || text(data.raceOrSpecies),
    text(data.classAndSubclass) || text(data.className),
    text(data.level) ? `Level ${text(data.level)}` : ""
  ].filter(Boolean).join(" · ");
  const abilityScores = object(data.abilityScores);
  const idealsBondsFlaws = object(data.idealsBondsFlaws);

  return (
    <div>
      <CardTitle title={text(data.name) || "Generated Character"} detail={detail} badge="Character" />
      {imagePanel}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Role" value={text(data.role) || "Adventurer"} />
        <Metric label="Background" value={text(data.background) || "Campaign-tied"} />
        <Metric label="Stats" value={formatCharacterStats(abilityScores, text(data.statSummary))} />
      </div>
      <InfoGrid
        items={[
          ["Personality", strings(data.personalityTraits).join(" · ") || text(data.personalityTraits) || text(data.personality)],
          ["Ideals / Bonds / Flaws", formatIdealsBondsFlaws(idealsBondsFlaws, text(data.idealsBondsFlaws))],
          ["Equipment", strings(data.equipment).join(" · ") || text(data.equipment)],
          ["Campaign Tie-In", text(data.campaignTieIn) || text(data.relationshipToParty)],
          ["Secret or Hook", text(data.secretOrHook) || text(data.secret) || text(data.hook)]
        ]}
      />
    </div>
  );
}

function QuestCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <CardTitle title={text(data.title) || "Quest"} detail={text(data.status) || "open"} badge="Quest" />
      <p className="mt-3 text-base leading-7 text-moss">{text(data.description)}</p>
      <ListBlock title="Objectives" items={strings(data.objectives)} />
      <InfoGrid items={[["Reward", text(data.reward)], ["Unresolved", strings(data.unresolvedHooks).join(" · ")]]} />
    </div>
  );
}

function LocationCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <CardTitle title={text(data.name) || "Location"} detail={[text(data.type), text(data.dangerLevel) ? `${text(data.dangerLevel)} danger` : ""].filter(Boolean).join(" · ")} badge="Location" />
      <p className="mt-3 text-base leading-7 text-moss">{text(data.description)}</p>
      <ListBlock title="Secrets" items={strings(data.secrets)} />
      <ListBlock title="Quest Hooks" items={strings(data.questHooks)} />
    </div>
  );
}

function EncounterCard({ data, imagePanel }: { data: Record<string, unknown>; imagePanel?: ReactNode }) {
  const monsters = Array.isArray(data.monsters) ? data.monsters : [];
  const scaling = object(data.scalingOptions);
  const difficulty = text(data.difficulty) || "Encounter";
  return (
    <div>
      <CardTitle title={text(data.title) || "Encounter"} detail={text(data.environment)} badge={difficulty} badgeClassName={difficultyBadgeClass(difficulty)} />
      {imagePanel}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {monsters.map((monster, index) => {
          const item = object(monster);
          return (
            <div key={index} className="rounded-xl border border-moss/10 bg-parchment px-4 py-3 text-sm text-moss">
              <p className="font-semibold text-ink">
                {text(item.name) || "Creature"} x{number(item.count, 1)}
              </p>
              <p className="mt-1 text-moss/70">{[text(item.role), `${number(item.xp, 0)} XP`].filter(Boolean).join(" · ")}</p>
            </div>
          );
        })}
      </div>
      <InfoGrid
        items={[
          ["Tactics", text(data.tactics)],
          ["Easier", text(scaling.easier)],
          ["Harder", text(scaling.harder)],
          ["Rewards", strings(data.rewards).join(" · ")],
          ["Hooks", strings(data.campaignHooks).join(" · ")]
        ]}
      />
    </div>
  );
}

function StructuredImagePanel({
  outputType,
  image,
  stylePreset,
  isLoading,
  error,
  onGenerate,
  onStyleChange,
  disabled
}: {
  outputType: StructuredImageOutputType;
  image: ImageGenerationResponse | null;
  stylePreset: ImageStylePreset;
  isLoading: boolean;
  error: string | null;
  onGenerate: () => void;
  onStyleChange: (preset: ImageStylePreset) => void;
  disabled: boolean;
}) {
  const imageSrc = image?.imageUrl || image?.imageData || "";
  const imageStylePresets = imageStylePresetsByOutputType[outputType];
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-moss/15 bg-ink">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-[radial-gradient(circle_at_35%_30%,_rgba(216,226,220,0.22),_transparent_18rem)]">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt={`${outputType} generated visual`} className="h-full w-full object-contain" />
          ) : (
            <div className="px-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mist/65">{imagePanelLabel(outputType)}</p>
              <p className="mt-2 text-sm leading-6 text-mist/80">No image generated yet.</p>
            </div>
          )}
        </div>
        <div className="border-t border-white/10 bg-ink p-3 md:border-l md:border-t-0">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-mist/65" htmlFor={`image-style-${outputType}`}>
            Style
          </label>
          <select
            id={`image-style-${outputType}`}
            value={stylePreset}
            onChange={(event) => onStyleChange(event.target.value as ImageStylePreset)}
            disabled={isLoading}
            className="mt-2 w-full rounded-md border border-white/15 bg-white/10 px-2 py-2 text-sm font-semibold text-mist outline-none transition focus:border-copper/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {imageStylePresets.map((preset) => (
              <option key={preset} value={preset} className="bg-ink text-mist">
                {sentenceCase(preset)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onGenerate}
            disabled={disabled || isLoading}
            className="mt-3 w-full rounded-md border border-copper/50 bg-copper px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-copper/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Generating..." : imageSrc ? "Regenerate Image" : "Generate Image"}
          </button>
          {image && (
            <p className="mt-3 text-xs leading-5 text-mist/65">
              {sentenceCase(image.status)} with {image.provider} / {image.model}
            </p>
          )}
          {error && <p className="mt-3 text-xs font-semibold leading-5 text-ember">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function acceptedImageStylePreset(outputType: StructuredImageOutputType, preset: ImageStylePreset): ImageStylePreset {
  return imageStylePresetsByOutputType[outputType].includes(preset) ? preset : "cinematic";
}

function SessionSummaryCard({ data }: { data: Record<string, unknown> }) {
  const importantEvents = recapItems(data.importantEvents, "Event");
  const npcs = recapItems(data.npcs, "NPC", "name");
  const quests = recapItems(data.quests, "Quest", "title");
  const unresolvedHooks = recapItems(data.unresolvedHooks, "Hook");
  const hasSupportingDetails = Boolean(importantEvents.length || npcs.length || quests.length || unresolvedHooks.length);

  return (
    <div>
      <CardTitle title="Session Summary" detail={text(data.nextSessionSetup)} badge="Recap" />
      <div className="mt-4 rounded-xl border border-moss/10 bg-parchment px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">At the table</p>
        <p className="mt-2 text-base leading-7 text-ink">{text(data.summary) || "No session summary was generated."}</p>
      </div>
      {hasSupportingDetails && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <RecapList title="Important Events" items={importantEvents} />
          <div className="grid gap-4">
            <RecapList title="Unresolved Hooks" items={unresolvedHooks} tone="hook" />
            <RecapList title="NPCs" items={npcs} compact />
            <RecapList title="Quests" items={quests} compact />
          </div>
        </div>
      )}
    </div>
  );
}

function InitiativeOrderCard({ data }: { data: Record<string, unknown> }) {
  const order = Array.isArray(data.order) ? data.order : [];
  return (
    <ol className="space-y-2">
      {order.map((entry, index) => {
        const item = object(entry);
        return (
          <li key={index} className="flex items-center justify-between rounded-xl border border-moss/10 bg-parchment px-4 py-3 text-sm">
            <span className="font-semibold">{index + 1}. {text(item.name)}</span>
            <span className="text-moss">{number(item.total)} total ({number(item.roll)} + {number(item.modifier)})</span>
          </li>
        );
      })}
    </ol>
  );
}

function DiceRollCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="rounded-xl border border-moss/10 bg-parchment px-4 py-3">
      <div className="flex items-center justify-between gap-3 border-b border-moss/10 pb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-copper">Total</p>
        <p className="shrink-0 text-2xl font-semibold leading-none text-ink">{number(data.total)}</p>
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-copper">Expression</dt>
          <dd className="min-w-0 break-words text-right text-moss">{text(data.expression) || "-"}</dd>
        </div>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-copper">Rolls</dt>
          <dd className="min-w-0 break-words text-right text-moss">{strings(data.rolls).join(", ") || "-"}</dd>
        </div>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
          <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-copper">Modifier</dt>
          <dd className="min-w-0 break-words text-right text-moss">{formatModifier(data.modifier)}</dd>
        </div>
      </dl>
    </div>
  );
}

function CardTitle({
  title,
  detail,
  badge,
  badgeClassName
}: {
  title: string;
  detail?: string;
  badge?: string;
  badgeClassName?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-2xl font-semibold leading-tight text-ink">{title}</h3>
        {detail && <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-moss/60">{detail}</p>}
      </div>
      {badge && (
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${badgeClassName ?? "bg-copper text-white"}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {items.filter(([, value]) => value).map(([label, value]) => (
        <div key={label} className="rounded-xl border border-moss/10 bg-parchment px-4 py-3 text-sm leading-6 text-moss">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">{label}</p>
          <p className="mt-1">{value}</p>
        </div>
      ))}
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) {
    return null;
  }
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">{title}</p>
      <ul className="mt-2 space-y-2 text-sm leading-6 text-moss">
        {items.map((item, index) => (
          <li key={index} className="rounded-lg bg-parchment px-3 py-2">{item}</li>
        ))}
      </ul>
    </div>
  );
}

type RecapItem = {
  title: string;
  detail: string;
};

function RecapList({
  title,
  items,
  compact = false,
  tone = "event"
}: {
  title: string;
  items: RecapItem[];
  compact?: boolean;
  tone?: "event" | "hook";
}) {
  if (!items.length) {
    return null;
  }

  const markerClassName = tone === "hook" ? "border-ember/25 bg-ember/10 text-ember" : "border-copper/25 bg-copper/10 text-copper";

  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">{title}</p>
        <span className="rounded-full bg-mist px-2.5 py-1 text-[11px] font-semibold text-moss">{items.length}</span>
      </div>
      <ol className={compact ? "space-y-2" : "space-y-3"}>
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-xl border border-moss/10 bg-white px-3 py-3 shadow-sm shadow-moss/5">
            <span className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${markerClassName}`}>
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold leading-6 text-ink">{item.title}</p>
              {item.detail && <p className="mt-1 break-words text-sm leading-6 text-moss">{item.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-moss/10 bg-parchment px-4 py-3">
      <p className="break-words text-xs font-semibold uppercase tracking-[0.08em] text-copper">{label}</p>
      <p className={`mt-1 ${emphasis ? "text-xl font-semibold" : "text-sm"} text-ink`}>{value}</p>
    </div>
  );
}

function labelFor(type: string) {
  return type.replaceAll("_", " ");
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function number(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => text(item)).filter(Boolean);
}

function displayItems(value: unknown, preferredKey: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const data = object(item);
      if (Object.keys(data).length) {
        return text(data[preferredKey]) || text(data.name) || text(data.title) || text(data.description);
      }
      return text(item);
    })
    .filter(Boolean);
}

function recapItems(value: unknown, fallbackTitle: string, preferredKey = "event"): RecapItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => recapItem(item, fallbackTitle, preferredKey))
    .filter((item): item is RecapItem => Boolean(item?.title || item?.detail));
}

function recapItem(value: unknown, fallbackTitle: string, preferredKey: string): RecapItem | null {
  const data = object(value);
  if (Object.keys(data).length) {
    const title = text(data[preferredKey]) || text(data.name) || text(data.title) || text(data.event) || fallbackTitle;
    const detail = text(data.details) || text(data.description) || text(data.summary) || text(data.note);
    return { title, detail };
  }

  const raw = text(value).trim();
  if (!raw) {
    return null;
  }

  const parsedTitle = quotedField(raw, preferredKey) || quotedField(raw, "name") || quotedField(raw, "title") || quotedField(raw, "event");
  const parsedDetail = quotedField(raw, "details") || quotedField(raw, "description") || quotedField(raw, "summary") || quotedField(raw, "note");

  if (parsedTitle || parsedDetail) {
    return { title: parsedTitle || fallbackTitle, detail: parsedDetail };
  }

  return { title: raw, detail: "" };
}

function quotedField(value: string, field: string): string {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fieldMatch = new RegExp(`["']${escapedField}["']\\s*:\\s*["']`, "i").exec(value);
  if (!fieldMatch) {
    return "";
  }

  const start = fieldMatch.index + fieldMatch[0].length;
  const remainder = value.slice(start);
  const nextFieldMatch = /["']\s*,\s*["'][A-Za-z0-9_ -]+["']\s*:/i.exec(remainder);
  const end = nextFieldMatch?.index ?? remainder.search(/["']\s*}$/);
  const raw = end >= 0 ? remainder.slice(0, end) : remainder;
  return raw.trim().replace(/["']$/, "").trim();
}

function formatModifier(value: unknown) {
  const numeric = number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric}`;
}

function difficultyBadgeClass(difficulty: string) {
  const normalized = difficulty.toLowerCase();
  if (normalized.includes("easy")) {
    return "bg-mist text-moss";
  }
  if (normalized.includes("medium")) {
    return "bg-copper/15 text-copper";
  }
  if (normalized.includes("hard")) {
    return "bg-ember/15 text-ember";
  }
  if (normalized.includes("deadly")) {
    return "bg-ink text-white";
  }
  return "bg-copper text-white";
}

function saveImageMetadataFrom(image: ImageGenerationResponse, selectedStylePreset: ImageStylePreset): SaveImageMetadata | null {
  const imageUrl = image.imageUrl || null;
  const imagePrompt = image.imagePrompt?.trim();
  if (!imageUrl && !imagePrompt) {
    return null;
  }

  return {
    imageUrl,
    imagePrompt,
    imageProvider: image.provider,
    imageModel: image.model,
    imageGeneratedAt: image.imageGeneratedAt ?? new Date().toISOString(),
    imageStylePreset: image.imageStylePreset ?? selectedStylePreset
  };
}

function isImageSaveAction(action: string) {
  return action === "saveNPC" || action === "saveEncounter";
}

function imagePanelLabel(outputType: StructuredImageOutputType) {
  if (outputType === "npc") {
    return "NPC visual";
  }
  if (outputType === "character") {
    return "Character visual";
  }
  return "Encounter visual";
}

function sentenceCase(value: string) {
  const spaced = value.replaceAll("_", " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "";
}

function defaultActionsFor(output: StructuredOutput): SuggestedAction[] {
  if (output.type === "encounter") {
    const title = text(output.data.title);
    const encounterSubject = title ? (/\bencounter\b/i.test(title) ? title : `${title} encounter`) : "this encounter";
    const hook = strings(output.data.campaignHooks)[0];
    const actions: SuggestedAction[] = [{ label: "Save Encounter", action: "saveEncounter", payload: output.data }];
    if (hook) {
      actions.push({
        label: "Save Hook",
        action: "saveHook",
        payload: {
          status: "open",
          title: hook,
          description: title ? `${title}: ${hook}` : hook,
          relatedEntityType: "encounter",
          relatedEntityName: title
        }
      });
    }
    actions.push(
      {
        label: "Roll Initiative",
        action: "prompt",
        payload: { message: `Roll initiative for ${title}.` }
      },
      {
        label: "Make Harder",
        action: "prompt",
        payload: { message: `Make ${encounterSubject} harder while keeping it fair for this party.` }
      },
      {
        label: "Make Easier",
        action: "prompt",
        payload: { message: `Make ${encounterSubject} easier without losing the Captain Vey and Ashen Knives tension.` }
      }
    );
    return actions;
  }

  if (output.type === "npc") {
    const name = text(output.data.name) || "this NPC";
    const questHook = text(output.data.questHook);
    const actions: SuggestedAction[] = [{ label: "Save NPC", action: "saveNPC", payload: output.data }];
    if (questHook) {
      actions.push({
        label: "Save Hook",
        action: "saveHook",
        payload: {
          status: "open",
          title: questHook,
          description: `${name}: ${questHook}`,
          relatedEntityType: "npc",
          relatedEntityName: name
        }
      });
    }
    actions.push(
      {
        label: "Generate Quest Hook",
        action: "prompt",
        payload: { message: `Generate a quest hook for ${name} that ties back to the party's current campaign memory.` }
      },
      {
        label: "Add Relationship",
        action: "prompt",
        payload: { message: `Add a relationship between ${name} and one existing party member or campaign NPC.` }
      }
    );
    return actions;
  }

  if (output.type === "character") {
    const name = text(output.data.name) || "this character";
    return [
      { label: "Save Character", action: "saveCharacter", payload: output.data },
      {
        label: "Add Campaign Tie",
        action: "prompt",
        payload: { message: `Deepen ${name}'s tie to one existing party member, faction, or unresolved hook.` }
      },
      {
        label: "Make Hireling",
        action: "prompt",
        payload: { message: `Revise ${name} as a hireling with a clear price, limit, and complication.` }
      }
    ];
  }

  if (output.type === "quest") {
    const title = text(output.data.title) || "this quest";
    const hook = strings(output.data.unresolvedHooks)[0] || text(output.data.description) || title;
    return [
      { label: "Save Quest", action: "saveQuest", payload: output.data },
      {
        label: "Save Hook",
        action: "saveHook",
        payload: {
          status: "open",
          title,
          description: hook,
          relatedEntityType: "quest",
          relatedEntityName: title
        }
      },
      {
        label: "Add NPC",
        action: "prompt",
        payload: { message: `Add a memorable NPC connected to ${title}.` }
      },
      {
        label: "Mark Open",
        action: "prompt",
        payload: { message: `Keep ${title} open and suggest the next unresolved step for the party.` }
      }
    ];
  }

  if (output.type === "location") {
    const name = text(output.data.name) || "this location";
    const hook = strings(output.data.questHooks)[0];
    const actions: SuggestedAction[] = [{ label: "Save Location", action: "saveLocation", payload: output.data }];
    if (hook) {
      actions.push({
        label: "Save Hook",
        action: "saveHook",
        payload: {
          status: "open",
          title: hook,
          description: `${name}: ${hook}`,
          relatedEntityType: "location",
          relatedEntityName: name
        }
      });
    }
    return actions;
  }

  if (output.type === "session_summary") {
    return [{ label: "Summarize Session", action: "saveSessionSummary", payload: output.data }];
  }

  return [];
}

function formatCharacterStats(abilityScores: Record<string, unknown>, fallback: string) {
  const entries = ["str", "dex", "con", "int", "wis", "cha"]
    .map((key) => {
      const value = abilityScores[key] ?? abilityScores[key.toUpperCase()];
      return value === undefined || value === null || value === "" ? "" : `${key.toUpperCase()} ${value}`;
    })
    .filter(Boolean);
  return entries.length ? entries.join(" · ") : fallback || "Table-ready stat summary";
}

function formatIdealsBondsFlaws(value: Record<string, unknown>, fallback: string) {
  const entries = ["ideal", "bond", "flaw"]
    .map((key) => {
      const textValue = text(value[key]);
      return textValue ? `${sentenceCase(key)}: ${textValue}` : "";
    })
    .filter(Boolean);
  return entries.length ? entries.join(" · ") : fallback;
}

function mergeActions(primary: SuggestedAction[], fallback: SuggestedAction[]) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((action) => {
    const key = `${action.action}:${action.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
