/**
 * On or off, as a switch: the one control for anything switched on and off (a set, a list, a person's sign-in…). It
 * submits the form it sits in, which carries what turning it means; its label says what it switches and how it stands.
 */
export function Switch({ on, label, disabled, form }: {
  on: boolean;
  /** What it switches, read by screen readers and shown on hover ("Switch the set off"). */
  label: string;
  disabled?: boolean;
  /** The form it submits, when it does not sit inside it. */
  form?: string;
}) {
  return (
    <button
      type="submit"
      form={form}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="group inline-flex items-center gap-2 rounded-full text-xs font-semibold text-slate-600 outline-none focus-visible:ring-3 focus-visible:ring-link/25 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${on ? "bg-emerald-600" : "bg-slate-300"}`}
      >
        <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </span>
      <span className={on ? "text-emerald-800" : "text-slate-500"}>{on ? "On" : "Off"}</span>
    </button>
  );
}
