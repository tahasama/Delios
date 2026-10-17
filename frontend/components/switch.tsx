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

/**
 * The same switch as a field of a form: a checkbox drawn as a switch (`role="switch"`), sent with the form like any
 * tick. It sits inside the label that says what it switches (or use `SwitchField`, which brings its own). For a setting
 * that is on or off; a choice among several, or a confirmation, stays a tick.
 */
export function SwitchControl({ name, value, defaultChecked, className }: { name: string; value?: string; defaultChecked?: boolean; className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 ${className ?? ""}`}>
      <input type="checkbox" role="switch" name={name} value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span aria-hidden className="h-5 w-9 rounded-full bg-slate-300 transition-colors duration-200 peer-checked:bg-emerald-600 peer-focus-visible:ring-3 peer-focus-visible:ring-link/25" />
      <span aria-hidden className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out peer-checked:translate-x-4" />
    </span>
  );
}

/** A switch with what it switches beside it, as one label. */
export function SwitchField({ name, value, defaultChecked, children, className }: {
  name: string;
  value?: string;
  defaultChecked?: boolean;
  /** What it switches, beside it. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2.5 text-xs text-slate-700 ${className ?? ""}`}>
      <SwitchControl name={name} value={value} defaultChecked={defaultChecked} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}
