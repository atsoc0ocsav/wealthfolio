import { useController, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { ACTIVITY_SUBTYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";

type StockTradeSide = "buy" | "sell";

interface StockTradeIntentSelectorProps<TFieldValues extends FieldValues = FieldValues> {
  control: Control<TFieldValues>;
  name?: FieldPath<TFieldValues>;
  side: StockTradeSide;
  className?: string;
}

export function StockTradeIntentSelector<TFieldValues extends FieldValues = FieldValues>({
  control,
  name = "subtype" as FieldPath<TFieldValues>,
  side,
  className,
}: StockTradeIntentSelectorProps<TFieldValues>) {
  const { field } = useController({
    name,
    control,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultValue: null as any,
  });

  const intents =
    side === "sell"
      ? [
          { value: null, label: "Sell" },
          { value: ACTIVITY_SUBTYPES.POSITION_OPEN, label: "Sell Short" },
        ]
      : [
          { value: null, label: "Buy" },
          { value: ACTIVITY_SUBTYPES.POSITION_CLOSE, label: "Buy to Cover" },
        ];

  return (
    <div className={cn("space-y-2", className)}>
      <span className="text-sm font-medium">Trade Type</span>
      <div
        role="group"
        aria-label="Trade Type"
        className="bg-muted grid h-10 w-full grid-cols-2 gap-1 rounded-lg p-1"
      >
        {intents.map((intent) => {
          const isSelected =
            intent.value === null
              ? field.value == null || field.value === ""
              : field.value === intent.value;

          return (
            <button
              key={intent.label}
              type="button"
              aria-pressed={isSelected}
              onClick={() => field.onChange(intent.value)}
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-md px-4 text-sm font-medium transition-colors",
                "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                isSelected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {intent.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
