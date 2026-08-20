import {
  ELEVENLABS_VOICES,
  type ElevenLabsVoiceId,
} from "@/config/elevenLabsVoices";

interface VoiceSelectorProps {
  value: ElevenLabsVoiceId;
  onChange: (voiceId: ElevenLabsVoiceId) => void;
  disabled?: boolean;
}

export function VoiceSelector({
  value,
  onChange,
  disabled = false,
}: VoiceSelectorProps) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        เลือกเสียงพากย์
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {ELEVENLABS_VOICES.map((voice) => {
          const selected = value === voice.id;
          return (
            <label
              key={voice.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                selected
                  ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200"
                  : "border-slate-200 bg-white hover:border-blue-300"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="elevenlabs-voice"
                value={voice.id}
                checked={selected}
                onChange={() => onChange(voice.id)}
                className="mt-0.5 h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-800">
                  {voice.label}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {voice.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
