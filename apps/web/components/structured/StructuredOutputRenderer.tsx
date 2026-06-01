import { SuggestedActions } from "../chat/SuggestedActions";
import { StructuredOutput, SuggestedAction } from "../../lib/api";

type RendererProps = {
  output: StructuredOutput | null | undefined;
  suggestedActions: SuggestedAction[];
  onAction: (action: SuggestedAction) => Promise<void>;
  status?: string | null;
};

export function StructuredOutputRenderer({ output, suggestedActions, onAction, status }: RendererProps) {
  if (!output) {
    return null;
  }

  const actions = mergeActions(suggestedActions, defaultActionsFor(output));

  return (
    <div className="border-t border-moss/10 pt-4">
      <div className="overflow-hidden rounded-2xl border border-moss/15 bg-white shadow-lg shadow-moss/5">
        <div className="border-b border-moss/10 bg-parchment/70 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copper">{labelFor(output.type)}</p>
              <p className="mt-1 text-sm text-moss/70">Structured result ready to save or reuse at the table.</p>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-moss">save-ready</span>
          </div>
        </div>
        <div className="p-5 md:p-6">
          {output.type === "npc" && <NpcCard data={output.data} />}
          {output.type === "quest" && <QuestCard data={output.data} />}
          {output.type === "location" && <LocationCard data={output.data} />}
          {output.type === "encounter" && <EncounterCard data={output.data} />}
          {output.type === "session_summary" && <SessionSummaryCard data={output.data} />}
          {output.type === "initiative_order" && <InitiativeOrderCard data={output.data} />}
          {output.type === "dice_roll" && <DiceRollCard data={output.data} />}
          <SuggestedActions actions={actions} onAction={onAction} status={status} />
        </div>
      </div>
    </div>
  );
}

function NpcCard({ data }: { data: Record<string, unknown> }) {
  const role = [text(data.role), text(data.raceOrSpecies)].filter(Boolean).join(" · ");
  return (
    <div>
      <CardTitle title={text(data.name) || "Generated NPC"} detail={role} badge="NPC" />
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

function EncounterCard({ data }: { data: Record<string, unknown> }) {
  const monsters = Array.isArray(data.monsters) ? data.monsters : [];
  const scaling = object(data.scalingOptions);
  const difficulty = text(data.difficulty) || "Encounter";
  return (
    <div>
      <CardTitle title={text(data.title) || "Encounter"} detail={text(data.environment)} badge={difficulty} badgeClassName={difficultyBadgeClass(difficulty)} />
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

function SessionSummaryCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <CardTitle title="Session Summary" detail={text(data.nextSessionSetup)} badge="Recap" />
      <p className="mt-3 text-base leading-7 text-moss">{text(data.summary)}</p>
      <ListBlock title="Important Events" items={strings(data.importantEvents)} />
      <ListBlock title="NPCs" items={displayItems(data.npcs, "name")} />
      <ListBlock title="Quests" items={displayItems(data.quests, "title")} />
      <ListBlock title="Unresolved Hooks" items={strings(data.unresolvedHooks)} />
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
    <div className="grid gap-3 sm:grid-cols-4">
      <Metric label="Expression" value={text(data.expression)} />
      <Metric label="Rolls" value={strings(data.rolls).join(", ")} />
      <Metric label="Modifier" value={formatModifier(data.modifier)} />
      <Metric label="Total" value={String(number(data.total))} emphasis />
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

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-moss/10 bg-parchment px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">{label}</p>
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

function defaultActionsFor(output: StructuredOutput): SuggestedAction[] {
  if (output.type === "encounter") {
    const title = text(output.data.title) || "this encounter";
    return [
      { label: "Save Encounter", action: "saveEncounter", payload: output.data },
      {
        label: "Roll Initiative",
        action: "prompt",
        payload: { message: `Roll initiative for ${title}.` }
      },
      {
        label: "Make Harder",
        action: "prompt",
        payload: { message: `Make ${title} harder while keeping it fair for this party.` }
      },
      {
        label: "Make Easier",
        action: "prompt",
        payload: { message: `Make ${title} easier without losing the Captain Vey and Ashen Knives tension.` }
      }
    ];
  }

  if (output.type === "npc") {
    const name = text(output.data.name) || "this NPC";
    return [
      { label: "Save NPC", action: "saveNPC", payload: output.data },
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
    ];
  }

  if (output.type === "quest") {
    const title = text(output.data.title) || "this quest";
    return [
      { label: "Save Quest", action: "saveQuest", payload: output.data },
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

  if (output.type === "session_summary") {
    return [{ label: "Summarize Session", action: "saveSessionSummary", payload: output.data }];
  }

  return [];
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
