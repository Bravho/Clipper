"use client";

import { useState } from "react";
import {
  Camera,
  CameraResultType,
  CameraSource,
  CameraDirection,
} from "@capacitor/camera";
import { isNativeMobile } from "@/lib/mobile/platform";
import { Button } from "@/components/ui/Button";

interface NativeMediaPickerProps {
  disabled?: boolean;
  fileInputId: string;
  onFiles: (files: File[]) => void;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function NativeMediaPicker({
  disabled = false,
  fileInputId,
  onFiles,
}: NativeMediaPickerProps) {
  const [busy, setBusy] = useState<"camera" | "library" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isNativeMobile()) return null;

  const takePhoto = async () => {
    setBusy("camera");
    setError(null);
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Base64,
        direction: CameraDirection.Rear,
        quality: 90,
        correctOrientation: true,
        saveToGallery: false,
        allowEditing: false,
      });

      if (!photo.base64String) {
        throw new Error("Camera did not return image data.");
      }
      const mimeType = `image/${photo.format || "jpeg"}`;
      const bytes = Uint8Array.from(atob(photo.base64String), (character) =>
        character.charCodeAt(0)
      );
      const file = new File(
        [bytes],
        `rclipper-${Date.now()}.${extensionForMime(mimeType)}`,
        { type: mimeType, lastModified: Date.now() }
      );
      onFiles([file]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // Capacitor uses platform-specific cancellation messages. Cancellation is
      // not an error and should leave the form unchanged.
      if (!/cancel|canceled|cancelled/i.test(message)) {
        console.error("[native camera]", err);
        setError(
          "ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบสิทธิ์กล้องในการตั้งค่าอุปกรณ์"
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const selectFromLibrary = () => {
    setError(null);
    const input = document.getElementById(fileInputId);
    if (!(input instanceof HTMLInputElement)) {
      setError("ไม่สามารถเปิดคลังรูปภาพและวิดีโอได้ กรุณาลองอีกครั้ง");
      return;
    }
    input.click();
  };

  return (
    <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="mb-3 text-sm font-medium text-slate-800">
        เพิ่มสื่อจากโทรศัพท์
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy !== null}
          loading={busy === "camera"}
          onClick={() => void takePhoto()}
        >
          ถ่ายรูป
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy !== null}
          onClick={selectFromLibrary}
        >
          เลือกรูปหรือวิดีโอจากเครื่อง
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        เลือกได้ทั้งรูปภาพและวิดีโอจากคลังของอุปกรณ์
      </p>
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
