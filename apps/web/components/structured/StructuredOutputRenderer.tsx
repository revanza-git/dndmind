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

  return (
    <div className="mt-3 border-t border-moss/10 pt-3">
      <div className="rounded-md border border-moss/15 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-copper">
          {labelFor(output.type)}
        </p>
        {output.type === "npc" && <NpcCard data={output.data} />}
        {output.type === "quest" && <QuestCard data={output.data} />}
        {output.type === "location" && <LocationCard data={output.data} />}
        {output.type === "encounter" && <EncounterCard data={output.data} />}
        {output.type === "session_summary" && <SessionSummaryCard data={output.data} />}
        {output.type === "initiative_order" && <InitiativeOrderCard data={output.data} />}
        {output.type === "dice_roll" && <DiceRollCard data={output.data} />}
        <SuggestedActions actions={suggestedActions} onAction={onAction} status={status} />
      </div>
    </div>
  );
}

function NpcCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <CardTitle title={text(data.name)} detail={[text(data.role), text(data.raceOrSpecies)].filter(Boolean).join(" · ")} />
      <p className="mt-2 text-sm leading-6 text-moss">{text(data.description)}</p>
      <InfoGrid
        items={[
          ["Personality", text(data.personality)],
          ["Motivation", text(data.motivation)],
          ["Secret", text(data.secret)],
          ["Party", text(data.relationshipToParty)],
          ["Hook", text(data.questHook)]
        ]}
      />
    </div>
  );
}

function QuestCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <CardTitle title={text(data.title)} detail={text(data.status) || "open"} />
      <p className="mt-2 text-sm leading-6 text-moss">{text(data.description)}</p>
      <ListBlock title="Objectives" items={strings(data.objectives)} />
      <InfoGrid items={[["Reward", text(data.reward)], ["Unresolved", strings(data.unresolvedHooks).join(" · ")]]} />
    </div>
  );
}

function LocationCard({ data }: { data: Record<string, unknown> }) {
  return (
    <div>
      <CardTitle title={text(data.name)} detail={`${text(data.type)} · ${text(data.dangerLevel)} danger`} />
      <p className="mt-2 text-sm leading-6 text-moss">{text(data.description)}</p>
      <ListBlock title="Secrets" items={strings(data.secrets)} />
      <ListBlock title="Quest Hooks" items={strings(data.questHooks)} />
    </div>
  );
}

function EncounterCard({ data }: { data: Record<string, unknown> }) {
  const monsters = Array.isArray(data.monsters) ? data.monsters : [];
  const scaling = object(data.scalingOptions);
  return (
    <div>
      <CardTitle title={text(data.title)} detail={`${text(data.difficulty)} · ${text(data.environment)}`} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {monsters.map((monster, index) => {
          const item = object(monster);
          return (
            <div key={index} className="rounded-md bg-parchment px-3 py-2 text-xs text-moss">
              <p className="font-semibold text-ink">
                {text(item.name)} x{number(item.count, 1)}
              </p>
              <p>{text(item.role)} · {number(item.xp, 0)} XP</p>
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
      <CardTitle title="Session Summary" detail={text(data.nextSessionSetup)} />
      <p className="mt-2 text-sm leading-6 text-moss">{text(data.summary)}</p>
      <ListBlock title="Important Events" items={strings(data.importantEvents)} />
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
          <li key={index} className="flex items-center justify-between rounded-md bg-parchment px-3 py-2 text-sm">
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

function CardTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {detail && <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-moss/60">{detail}</p>}
    </div>
  );
}

function InfoGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.filter(([, value]) => value).map(([label, value]) => (
        <div key={label} className="rounded-md bg-parchment px-3 py-2 text-xs leading-5 text-moss">
          <p className="font-semibold text-copper">{label}</p>
          <p>{value}</p>
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
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-moss">
        {items.map((item, index) => (
          <li key={index}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-md bg-parchment px-3 py-2">
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

function formatModifier(value: unknown) {
  const numeric = number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric}`;
}

