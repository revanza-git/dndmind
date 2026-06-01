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
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-moss/10 pt-3">
      {actions.map((action, index) => (
        <button
          key={`${action.action}-${index}`}
          type="button"
          onClick={() => onAction(action)}
          className="rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-moss"
        >
          {action.label}
        </button>
      ))}
      {status && <span className="text-xs font-medium text-copper">{status}</span>}
    </div>
  );
}

