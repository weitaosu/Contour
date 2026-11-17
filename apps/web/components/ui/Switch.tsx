"use client";

import { Switch as RSwitch } from "radix-ui";

export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="text-inkstone">{label}</span>
      <RSwitch.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative h-7 w-12 shrink-0 rounded-full bg-mist data-[state=checked]:bg-signal-violet disabled:opacity-50"
      >
        <RSwitch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-porcelain data-[state=checked]:translate-x-6" />
      </RSwitch.Root>
    </label>
  );
}
