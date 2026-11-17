"use client";

import { Accordion as RAccordion } from "radix-ui";
import { ChevronDown } from "lucide-react";

export function AccordionItem({ value, title, children, right }: { value: string; title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <RAccordion.Item value={value} className="rounded-[16px] bg-cloud">
      <RAccordion.Header>
        <RAccordion.Trigger className="group flex w-full items-center gap-4 px-6 py-5 text-left">
          <span className="flex-1 font-medium text-inkstone">{title}</span>
          {right}
          <ChevronDown size={20} strokeWidth={1.75} className="text-inkstone group-data-[state=open]:rotate-180" />
        </RAccordion.Trigger>
      </RAccordion.Header>
      <RAccordion.Content className="px-6 pb-6 text-slate">{children}</RAccordion.Content>
    </RAccordion.Item>
  );
}

export const Accordion = RAccordion.Root;
