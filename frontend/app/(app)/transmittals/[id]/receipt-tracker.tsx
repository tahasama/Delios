"use client";

import { useEffect } from "react";

export function ReceiptTracker({ transmittalId }: { transmittalId: string }) {
  useEffect(() => {
    void fetch(`/api/transmittals/${transmittalId}/view`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
      keepalive: true,
    });
  }, [transmittalId]);

  return null;
}
