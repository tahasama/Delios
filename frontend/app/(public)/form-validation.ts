/**
 * Native form validation fails quietly when the offending field is below the
 * fold: the browser blocks the submit and shows a tooltip nobody can see, so
 * pressing the button appears to do nothing at all.
 *
 * These helpers turn that into something visible — a list of what is missing,
 * and the first bad field scrolled into view and focused.
 */

type Validatable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isValidatable(el: Element): el is Validatable {
  return "willValidate" in el && (el as Validatable).willValidate;
}

/** The words a person would use for a field, not its `name` attribute. */
function labelFor(el: Validatable): string {
  const id = el.getAttribute("id");
  if (id) {
    const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim().replace(/\s*\*$/, "");
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent?.trim()) {
    // A wrapping label includes the control's own text; keep the first line.
    const text = wrapping.textContent.trim().split("\n")[0].trim();
    if (text) return text.replace(/\s*\*$/, "");
  }
  // Fall back to the field block's own caption, then to anything identifying.
  const field = el.closest("div")?.querySelector("span,label");
  if (field?.textContent?.trim()) return field.textContent.trim().replace(/\s*\*$/, "");
  return el.getAttribute("placeholder") || el.getAttribute("name") || "A required field";
}

export type MissingField = { label: string; message: string };

/**
 * Outline the fields that are missing (CSS `[data-missing]`), until each is changed. `names` are fields the server
 * named (any case); without them, the elements given are marked.
 */
export function markMissing(form: HTMLFormElement, elements: Element[]) {
  form.querySelectorAll("[data-missing]").forEach((el) => el.removeAttribute("data-missing"));
  for (const el of elements) {
    // A picker keeps its value in a hidden input: outline what the person sees, next to it.
    const shown = el instanceof HTMLInputElement && el.type === "hidden" ? el.parentElement?.querySelector("input:not([type=hidden]), select") ?? el.parentElement : el;
    if (!shown) continue;
    shown.setAttribute("data-missing", "true");
    const clear = () => shown.removeAttribute("data-missing");
    shown.addEventListener("input", clear, { once: true });
    shown.addEventListener("change", clear, { once: true });
  }
}

/** The form's fields the server named as missing or refused, matched by name whatever the case. */
export function fieldsNamed(form: HTMLFormElement, names: string[]): Element[] {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return Array.from(form.querySelectorAll("[name]")).filter((el) => wanted.has((el.getAttribute("name") ?? "").toLowerCase()));
}

/**
 * Check a form, and when it fails return what is wrong and put the first
 * offending field where the person can see it.
 */
export function collectInvalid(form: HTMLFormElement): MissingField[] {
  if (form.checkValidity()) return [];

  const bad = Array.from(form.elements).filter(
    (el): el is Validatable => isValidatable(el) && !el.checkValidity(),
  );

  markMissing(form, bad);
  const first = bad[0];
  if (first) {
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    // Focus after the scroll starts, or the browser fights it.
    window.setTimeout(() => first.focus({ preventScroll: true }), 120);
  }

  return bad.map((el) => ({ label: labelFor(el), message: el.validationMessage }));
}
