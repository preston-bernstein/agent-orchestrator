import type { ToonSection } from "./toonContext.js";

interface AssemblePromptSectionsInput {
  caveman: string;
  toonSections?: readonly ToonSection[];
  basePrompt: string;
  stackOverlay?: string;
  taskContext?: string;
  xmlBlobs?: readonly { tag: string; body: string }[];
  outputSchema?: string;
}

function appendToonSections(
  sections: string[],
  toonSections: AssemblePromptSectionsInput["toonSections"],
): void {
  if (!toonSections?.length) return;
  for (const s of toonSections) {
    sections.push(`### ${s.label}\n${s.body}`);
  }
}

function appendXmlBlobs(
  sections: string[],
  xmlBlobs: AssemblePromptSectionsInput["xmlBlobs"],
): void {
  if (!xmlBlobs?.length) return;
  for (const b of xmlBlobs) {
    sections.push(`<${b.tag}>\n${b.body}\n</${b.tag}>`);
  }
}

export function collectPromptSections(input: AssemblePromptSectionsInput): string[] {
  const sections: string[] = [];
  if (input.caveman.trim()) sections.push(input.caveman.trim());
  appendToonSections(sections, input.toonSections);
  sections.push(input.basePrompt.trim());
  if (input.stackOverlay?.trim()) sections.push(input.stackOverlay.trim());
  if (input.taskContext?.trim()) sections.push(input.taskContext.trim());
  appendXmlBlobs(sections, input.xmlBlobs);
  if (input.outputSchema?.trim()) {
    sections.push(`<output_schema>\n${input.outputSchema.trim()}\n</output_schema>`);
  }
  return sections;
}
