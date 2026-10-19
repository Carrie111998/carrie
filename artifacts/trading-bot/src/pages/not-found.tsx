import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound({ message = "This page does not exist." }: { message?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <AlertCircle className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link href="/" className="text-sm text-primary underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
