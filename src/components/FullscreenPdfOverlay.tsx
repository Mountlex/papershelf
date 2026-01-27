import { useEffect, useRef, useCallback } from "react";

interface FullscreenPdfOverlayProps {
  url: string;
  title: string;
  onClose: () => void;
}

export function FullscreenPdfOverlay({ url, title, onClose }: FullscreenPdfOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const didEnterFullscreen = useRef(false);

  // Store the previously focused element and focus the close button on mount
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();

    // Restore focus when unmounting
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  // Enter fullscreen immediately when mounted
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const enterFullscreen = async () => {
      try {
        await container.requestFullscreen();
        didEnterFullscreen.current = true;
      } catch {
        // Fullscreen failed, just show the overlay
      }
    };

    enterFullscreen();
  }, []);

  // Handle fullscreen exit
  useEffect(() => {
    const handleFullscreenChange = () => {
      // Only close if we previously entered fullscreen and now exited
      if (didEnterFullscreen.current && !document.fullscreenElement) {
        onClose();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [onClose]);

  // Handle Escape when not in fullscreen mode and Tab key for focus trap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        onClose();
      }

      // Focus trap: keep focus on the close button (the only focusable element)
      if (e.key === "Tab") {
        e.preventDefault();
        closeButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleClose = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      onClose();
    }
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Fullscreen PDF viewer: ${title || "PDF"}`}
      className="fixed inset-0 z-[200] bg-black"
    >
      <iframe
        src={url}
        className="h-full w-full"
        title={title || "PDF viewer"}
        sandbox="allow-same-origin allow-scripts"
        tabIndex={-1}
      />

      {/* Close button */}
      <button
        ref={closeButtonRef}
        onClick={handleClose}
        className="absolute right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow-lg transition-transform hover:scale-110 hover:bg-white focus:outline-none focus:ring-2 focus:ring-white"
        title="Close (Esc)"
        aria-label="Close PDF viewer"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
