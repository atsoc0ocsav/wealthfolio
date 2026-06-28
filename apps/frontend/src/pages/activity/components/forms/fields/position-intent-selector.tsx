import { useController, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { ACTIVITY_SUBTYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";

type PositionIntent =
  | typeof ACTIVITY_SUBTYPES.POSITION_OPEN
  | typeof ACTIVITY_SUBTYPES.POSITION_CLOSE;

const positionIntents: { value: PositionIntent; label: string }[] = [
  { value: ACTIVITY_SUBTYPES.POSITION_OPEN, label: "Open" },
  { value: ACTIVITY_SUBTYPES.POSITION_CLOSE, label: "Close" },
];

interface PositionIntentSelectorProps<TFieldValues extends FieldValues = FieldValues> {
  control: Control<TFieldValues>;
  name?: FieldPath<TFieldValues>;
  defaultValue: PositionIntent;
  className?: string;
}

export function PositionIntentSelector<TFieldValues extends FieldValues = FieldValues>({
  control,
  name = "subtype" as FieldPath<TFieldValues>,
  defaultValue,
  className,
}: PositionIntentSelectorProps<TFieldValues>) {
  const { field } = useController({
    name,
    control,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultValue: defaultValue as any,
  });
  const selectedValue =
    field.value === ACTIVITY_SUBTYPES.POSITION_OPEN ||
    field.value === ACTIVITY_SUBTYPES.POSITION_CLOSE
      ? field.value
      : defaultValue;

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2",
        className,
      )}
    >
      <span className="text-muted-foreground text-xs font-medium sm:text-sm">Position</span>
      <div
        role="group"
        aria-label="Position"
        className="bg-muted grid h-10 w-full grid-cols-2 gap-1 rounded-lg p-1 sm:w-56"
      >
        {positionIntents.map((intent) => {
          const isSelected = selectedValue === intent.value;

          return (
            <button
              key={intent.value}
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
