import { NextResponse } from "next/server";
// DEPRECATED: Voice recording is replaced by iAppTTS AI voice generation.
// The pipeline now goes: AwaitingVideoApproval -> GeneratingVoice -> AwaitingVoiceApproval
export async function POST() {
  return NextResponse.json(
    { error: "Deprecated. Voice is now generated automatically by iAppTTS." },
    { status: 410 }
  );
}
