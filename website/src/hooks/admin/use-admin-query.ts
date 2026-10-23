"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { adminRequest, AdminApiError } from "../../lib/admin/api";
export function useAdminQuery<T>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["admin", path],
    queryFn: ({ signal }) => adminRequest<T>(path, { signal }),
    enabled,
    staleTime: 15000,
    retry: (count, error) =>
      count < 1 &&
      (!(error instanceof AdminApiError) ||
        error.status === 0 ||
        error.status >= 500),
  });
}
export function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}
