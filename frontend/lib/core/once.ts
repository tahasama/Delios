/**
 * The key that makes an act happen once (owner, "idempotency keys"): every `ActionForm` carries a `formKey` made when it
 * was drawn, so pressing it twice, or the network sending it again, reaches the backend with the same key and gets the
 * first answer back (`IdempotencyFilter`) instead of a second release, verdict, notice or transmittal. `act` names the
 * call, since one form may make several calls and each needs its own key. None when the form carried no key.
 */
export function once(formData: FormData, act: string): string | undefined {
  const key = String(formData.get("formKey") ?? "").trim();
  return key ? `${act}:${key}`.slice(0, 100) : undefined;
}
