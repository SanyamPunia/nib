import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Three heights and nothing between them. `default` is every button on the desk surface,
 * `large` is for a single primary action on a screen that has only one thing to do, and `dense`
 * is for chips: a row of choices that has to sit beside a line of text without outweighing it.
 * Height comes from here and never from a class at a call site, so a row of controls cannot end
 * up a pixel out of line with itself.
 */
const SIZES = {
  /*
   * Tighter than the others. A `ghost` chip has no visible box, so its side padding reads as gap and
   * a row of them spreads into unrelated words rather than reading as one set of choices.
   */
  dense: "h-7 px-2.5 text-xs",
  default: "h-9 px-4 text-sm",
  large: "h-11 px-6 text-sm",
} as const;

/**
 * `ghost` keeps the same box as `outline` and spends no ink on it. It is for the unchosen items
 * in a set, where a row of full borders would read as a row of things all equally selected.
 */
const VARIANTS = {
  outline: "border border-desk-edge bg-desk text-ink hover:bg-desk-hover",
  ghost: "border border-transparent text-ink-soft hover:bg-desk-hover hover:text-ink",
} as const;

interface ButtonProps extends ComponentProps<"button"> {
  size?: keyof typeof SIZES;
  variant?: keyof typeof VARIANTS;
}

export function Button({
  className,
  size = "default",
  variant = "outline",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full",
        "transition-all duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
