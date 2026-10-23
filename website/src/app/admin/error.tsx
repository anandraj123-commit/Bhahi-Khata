"use client";
import { ErrorState } from "../../components/admin/shared/ui";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="a-content">
      <ErrorState
        message="The administration service is unavailable. Your existing records have not been changed."
        retry={reset}
      />
    </div>
  );
}
