"use client";

import { Accordion as RAccordion } from "radix-ui";
import { ChevronDown } from "lucide-react";

export function AccordionItem({ value, title, children, right }: { value: string; title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <RAccordion.Item value={value} className="rounded-[14px] bg-cloud">
      <RAccordion.Header>
        <RAccordion.Trigger className="group flex w-full items-center gap-3 px-4 py-2.5 text-left">
          <span className="flex-1 text-[14px] font-bold text-inkstone">{title}</span>
          {right}
          <ChevronDown size={17} strokeWidth={2} className="ease shrink-0 text-slate group-data-[state=open]:rotate-180" />
        </RAccordion.Trigger>
      </RAccordion.Header>
      <RAccordion.Content className="px-4 pb-3 text-[13.5px] leading-snug text-slate">{children}</RAccordion.Content>
    </RAccordion.Item>
  );
}

export const Accordion = RAccordion.Root;
