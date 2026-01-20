import { useRef, useState, useEffect, useCallback } from "react";

interface VerificationCodeInputProps {
  length: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
}

export function VerificationCodeInput({
  length,
  onComplete,
  disabled = false,
}: VerificationCodeInputProps) {
  const [values, setValues] = useState<string[]>(Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = useCallback(
    (index: number, value: string) => {
      // Only allow digits
      const digit = value.replace(/\D/g, "").slice(-1);

      const newValues = [...values];
      newValues[index] = digit;
      setValues(newValues);

      // Auto-advance to next input
      if (digit && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Check if complete
      const code = newValues.join("");
      if (code.length === length && newValues.every((v) => v)) {
        onComplete(code);
      }
    },
    [values, length, onComplete]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      // Handle backspace
      if (e.key === "Backspace") {
        if (!values[index] && index > 0) {
          // Move to previous input if current is empty
          const newValues = [...values];
          newValues[index - 1] = "";
          setValues(newValues);
          inputRefs.current[index - 1]?.focus();
        } else {
          // Clear current input
          const newValues = [...values];
          newValues[index] = "";
          setValues(newValues);
        }
        e.preventDefault();
      }

      // Handle arrow keys
      if (e.key === "ArrowLeft" && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
      if (e.key === "ArrowRight" && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [values, length]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);

      if (pastedData) {
        const newValues = [...values];
        for (let i = 0; i < pastedData.length && i < length; i++) {
          newValues[i] = pastedData[i];
        }
        setValues(newValues);

        // Focus last filled input or next empty one
        const nextIndex = Math.min(pastedData.length, length - 1);
        inputRefs.current[nextIndex]?.focus();

        // Check if complete
        if (pastedData.length === length) {
          onComplete(pastedData);
        }
      }
    },
    [values, length, onComplete]
  );

  return (
    <div className="flex justify-center gap-2">
      {values.map((value, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={value}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className="h-12 w-10 rounded-md border border-gray-300 text-center text-lg font-normal focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:opacity-50"
          maxLength={1}
        />
      ))}
    </div>
  );
}
