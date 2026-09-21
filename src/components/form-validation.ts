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
export function labelFor(el: Validatable): string {
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
 * Check a form, and when it fails return what is wrong and put the first
 * offending field where the person can see it.
 */
export function collectInvalid(form: HTMLFormElement): MissingField[] {
  if (form.checkValidity()) return [];

  const bad = Array.from(form.elements).filter(
    (el): el is Validatable => isValidatable(el) && !el.checkValidity(),
  );

  const first = bad[0];
  if (first) {
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    // Focus after the scroll starts, or the browser fights it.
    window.setTimeout(() => first.focus({ preventScroll: true }), 120);
  }

  return bad.map((el) => ({ label: labelFor(el), message: el.validationMessage }));
}
