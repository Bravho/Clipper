"use client";

import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import type { PipelineStepInfo } from "@/services/staff/VideoPipelinePresentationService";

interface Props {
  steps: PipelineStepInfo[];
}

export function PipelineStepIndicator({ steps }: Props) {
  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex items-center gap-1 min-w-max px-1">
        {steps.map((step, index) => (
          <li key={step.step} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold",
                  step.isCurrentStep
                    ? "bg-blue-600 text-white ring-2 ring-blue-300"
                    : step.isCompleted
                    ? "bg-green-600 text-white"
                    : "bg-gray-200 text-gray-500",
                ].join(" ")}
              >
                {step.isCompleted ? "✓" : index + 1}
              </div>
              <span
                className={[
                  "text-[10px] text-center w-16 leading-tight",
                  step.isCurrentStep ? "text-blue-700 font-semibold" : "text-gray-400",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={[
                  "h-0.5 w-8 mt-[-14px]",
                  step.isCompleted ? "bg-green-400" : "bg-gray-200",
                ].join(" ")}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
