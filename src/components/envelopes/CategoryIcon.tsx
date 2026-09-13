import { categoryIcon } from "@/lib/categories";
import { cn } from "@/lib/utils";

export function CategoryIcon({
  icon,
  className,
  size = "md",
}: {
  icon?: string | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none",
        size === "sm" && "h-6 w-6 text-base",
        size === "md" && "h-8 w-8 text-lg",
        size === "lg" && "h-11 w-11 text-2xl",
        className
      )}
    >
      {categoryIcon({ icon })}
    </span>
  );
}
