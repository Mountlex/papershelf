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
  const [currentMessage, setCurrentMessage] = useState(message);

  useEffect(() => {
    setCurrentMessage(message);

    if (clearAfterMs && message) {
      const timer = setTimeout(() => {
        setCurrentMessage("");
      }, clearAfterMs);
      return () => clearTimeout(timer);
    }
  }, [message, clearAfterMs]);

  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {currentMessage}
    </div>
  );
}
