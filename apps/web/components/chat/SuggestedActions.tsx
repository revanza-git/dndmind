import { SuggestedAction } from "../../lib/api";

export function SuggestedActions({
  actions,
  onAction,
  status
}: {
  actions: SuggestedAction[];
  onAction: (action: SuggestedAction) => Promise<void>;
  status?: string | null;
}) {
  if (!actions.length) {
    return null;
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-moss/10 pt-4">
      {actions.map((action, index) => (
        <button
          key={`${action.action}-${index}`}
          type="button"
          onClick={() => onAction(action)}
          className="rounded-full border border-ink bg-ink px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:border-copper hover:bg-moss"
        >
          {action.label}
        </button>
      ))}
      {status && <span className="rounded-full bg-copper/10 px-3 py-1.5 text-xs font-semibold text-copper">{status}</span>}
    </div>
  );
}
