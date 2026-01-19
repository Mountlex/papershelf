import { useEffect, useState } from "react";

interface LiveRegionProps {
  message: string;
  politeness?: "polite" | "assertive";
  clearAfterMs?: number;
}

export function LiveRegion({
  message,
  politeness = "polite",
  clearAfterMs,
}: LiveRegionProps) {
  const [displayMessage, setDisplayMessage] = useState(message);

  // Sync display message with prop and handle auto-clear
  // This setState is intentional - we need internal state to support auto-clearing
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayMessage(message);

    if (!clearAfterMs || !message) return;

    const timer = setTimeout(() => {
      setDisplayMessage("");
    }, clearAfterMs);

    return () => clearTimeout(timer);
  }, [message, clearAfterMs]);

  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {displayMessage}
    </div>
  );
}
