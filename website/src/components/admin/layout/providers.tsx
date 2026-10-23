"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const ToastContext = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
export const useToast = () => useContext(ToastContext);
export function AdminProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <QueryClientProvider client={client}>
      <ToastContext.Provider
        value={(message, error = false) => setToast({ message, error })}
      >
        {children}
        {toast && (
          <div
            role={toast.error ? "alert" : "status"}
            className={`a-toast ${toast.error ? "a-toast-error" : ""}`}
          >
            <span>{toast.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </div>
        )}
      </ToastContext.Provider>
    </QueryClientProvider>
  );
}
